const { makeApi, test, assert } = require('../test_core.js');

function raw(as, name, unit, cost) {
  return as('ingredients.save', { item: { name, unit, costPerUnit: cost, minLevel: 0 } });
}
function stock(as, id, qty) {
  as('movements.add', { date: '2026-11-13', type: 'adjustment', lines: [{ ingredientId: id, qty }], reason: 'seed' });
}
function setup(as, seed) {
  const oil = raw(as, 'Oil', 'L', 50);
  const chili = raw(as, 'Chili', 'kg', 90);
  const prep = as('ingredients.save', {
    item: { name: 'Chilli oil', unit: 'L', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 2, trackStock: true },
    prepRecipe: [{ ingredientId: oil.id, qty: 1, unit: 'L' }, { ingredientId: chili.id, qty: 200, unit: 'g' }],
  });
  if (seed !== false) { stock(as, oil.id, 10); stock(as, chili.id, 5); }
  return { oil, chili, prep };
}
const onHand = (as, id) => as('stock.levels', {}).filter((x) => x.id === id)[0];
function moves(db, refId) { return db.read('StockMovements').filter((m) => m.refId === refId); }

test('production run deducts inputs, adds output, records cost and yield', () => {
  const { as, db } = makeApi();
  const { oil, chili, prep } = setup(as);
  const before = onHand(as, prep.id).costPerUnit;
  const r = as('production.add', { date: '2026-11-13', prepId: prep.id, batches: 2, producedQty: 3.8 });
  const run = r.run;
  assert.strictEqual(run.runNo, 'PR-0001');
  assert.strictEqual(run.inputCost, 136);
  assert.ok(Math.abs(run.unitCost - 35.7895) < 1e-4);
  assert.strictEqual(run.yieldPct, 95);
  assert.strictEqual(run.expectedQty, 4);
  const m = moves(db, run.id);
  const q = (id) => m.filter((x) => x.ingredientId === id)[0];
  assert.strictEqual(Number(q(oil.id).qty), -2);
  assert.strictEqual(Number(q(chili.id).qty), -0.4);
  assert.strictEqual(Number(q(prep.id).qty), 3.8);
  assert.strictEqual(q(oil.id).type, 'production');
  assert.strictEqual(q(prep.id).type, 'produce');
  assert.strictEqual(q(oil.id).reason, 'PR-0001');
  assert.strictEqual(Number(q(oil.id).value), -100);
  assert.strictEqual(r.warnings.length, 0);
  const lv = onHand(as, prep.id);
  assert.strictEqual(lv.costPerUnit, before);
  assert.strictEqual(lv.costPerUnit, 34);
  assert.ok(Math.abs(lv.actualUnitCost - 35.7895) < 1e-4);
  assert.strictEqual(lv.costVariancePct, 5.3);
  assert.strictEqual(lv.onHand, 3.8);
});

test('by-products reduce run cost and add stock', () => {
  const { as, db } = makeApi();
  const { prep } = setup(as);
  const fat = raw(as, 'Chicken fat', 'kg', 40);
  const r = as('production.add', { date: '2026-11-13', prepId: prep.id, batches: 2, producedQty: 4,
    byproducts: [{ ingredientId: fat.id, qty: 0.5, unit: 'kg' }] });
  assert.strictEqual(r.run.byproductValue, 20);
  assert.strictEqual(r.run.totalCost, r.run.inputCost - 20);
  assert.strictEqual(onHand(as, fat.id).onHand, 0.5);
  const bm = moves(db, r.run.id).filter((x) => x.type === 'byproduct')[0];
  assert.strictEqual(Number(bm.value), 20);
  assert.throws(() => as('production.add', { date: '2026-11-13', prepId: prep.id, batches: 1, producedQty: 1,
    byproducts: [{ ingredientId: prep.id, qty: 1, unit: 'L' }] }), /can't be the item being produced/);
});

test('explicit inputs convert units', () => {
  const { as, db } = makeApi();
  const { chili, oil, prep } = setup(as);
  const r = as('production.add', { date: '2026-11-13', prepId: prep.id, batches: 1, producedQty: 2,
    inputs: [{ ingredientId: chili.id, qty: 500, unit: 'g' }, { ingredientId: oil.id, qty: 1, unit: 'L' }] });
  const m = moves(db, r.run.id).filter((x) => x.ingredientId === chili.id)[0];
  assert.strictEqual(Number(m.qty), -0.5);
});

test('run numbers increment', () => {
  const { as } = makeApi();
  const { prep } = setup(as);
  as('production.add', { date: '2026-11-13', prepId: prep.id, batches: 1, producedQty: 2 });
  const r2 = as('production.add', { date: '2026-11-13', prepId: prep.id, batches: 1, producedQty: 2 });
  assert.strictEqual(r2.run.runNo, 'PR-0002');
  const list = as('production.list', {});
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].prepName, 'Chilli oil');
});

test('staff can add but not void; manager void reverses everything', () => {
  const { as, asStaff, db } = makeApi();
  const { prep } = setup(as);
  const r = asStaff('production.add', { date: '2026-11-13', prepId: prep.id, batches: 2, producedQty: 3.8 });
  assert.strictEqual(r.run.producedBy, 'staff');
  assert.strictEqual(as('production.list', {})[0].producedByName, 'Staff');
  assert.throws(() => asStaff('production.void', { id: r.run.id }), (e) => e.code === 'FORBIDDEN');
  as('production.void', { id: r.run.id });
  moves(db, r.run.id).forEach((m) => assert.ok(m.voided === true || m.voided === 'TRUE'));
  assert.strictEqual(onHand(as, prep.id).onHand, 0);
  assert.strictEqual(onHand(as, prep.id).actualUnitCost, null);
  assert.throws(() => as('production.void', { id: r.run.id }), /already voided/);
});

test('movements.void refuses production rows', () => {
  const { as, db } = makeApi();
  const { prep } = setup(as);
  const r = as('production.add', { date: '2026-11-13', prepId: prep.id, batches: 1, producedQty: 2 });
  const mv = moves(db, r.run.id).filter((x) => x.type === 'produce')[0];
  assert.throws(() => as('movements.void', { id: mv.id }), (e) => e.code === 'VALIDATION' && /voiding the production run/.test(e.message));
});

test('inputs above on hand are saved with a warning', () => {
  const { as } = makeApi();
  const { prep } = setup(as, false);
  const r = as('production.add', { date: '2026-11-13', prepId: prep.id, batches: 1, producedQty: 2 });
  assert.strictEqual(r.warnings.length, 2);
  assert.ok(r.run.id);
});

test('validation', () => {
  const { as } = makeApi();
  const { oil, prep } = setup(as);
  assert.throws(() => as('production.add', { date: '2026-11-13', prepId: oil.id, batches: 1, producedQty: 1 }), /Choose a prep item/);
  assert.throws(() => as('production.add', { date: '2026-11-13', prepId: prep.id, batches: 0, producedQty: 1 }), /Batches/);
  assert.throws(() => as('production.add', { date: '2026-11-13', prepId: prep.id, batches: 1, producedQty: 0 }), /Quantity made/);
  assert.throws(() => as('production.add', { date: '2026-11-13', prepId: prep.id, batches: 1, producedQty: 1, producedBy: 'nobody' }), /Choose who made it/);
});

test('production messages have Thai translations', () => {
  const th = (m) => RestoCore.translate(m, 'th');
  [
    'Input 1: choose an ingredient.',
    'By-product 2: choose an ingredient.',
    'Batches must be greater than 0.',
    'Quantity made must be greater than 0.',
    'Production run is already voided.',
    'Input 1 quantity must be greater than 0.',
    'By-product 1 quantity must be a number.',
  ].forEach((m) => {
    const out = th(m);
    assert.ok(!/Input|By-product|Batches|Quantity made|Production run/.test(out), m + ' -> ' + out);
    assert.notStrictEqual(out, m);
  });
});

test('bootstrap gives every role the active team (username + name only) for "made by"', () => {
  const { as, asStaff } = makeApi();
  as('users.save', { item: { username: 'gone', displayName: 'Gone', role: 'staff', password: 'test1234', active: false } });
  const team = asStaff('bootstrap').team;
  const names = team.map((u) => u.username);
  assert.ok(names.indexOf('owner') >= 0 && names.indexOf('staff') >= 0);
  assert.ok(names.indexOf('gone') < 0);
  team.forEach((u) => assert.deepStrictEqual(Object.keys(u).sort(), ['displayName', 'username']));
  assert.deepStrictEqual(asStaff('bootstrap').users, []);
});

test('a prep not kept in stock is never flagged out or low', () => {
  const { as } = makeApi();
  const { oil } = setup(as);
  const cream = as('ingredients.save', {
    item: { name: 'Sweet cream', unit: 'L', costPerUnit: 0, minLevel: 1, kind: 'prep', batchQty: 1, trackStock: false },
    prepRecipe: [{ ingredientId: oil.id, qty: 1, unit: 'L' }],
  });
  assert.strictEqual(onHand(as, cream.id).status, 'ok');
  const tracked = as('ingredients.save', {
    item: { name: 'Kept sauce', unit: 'L', costPerUnit: 0, minLevel: 1, kind: 'prep', batchQty: 1, trackStock: true },
    prepRecipe: [{ ingredientId: oil.id, qty: 1, unit: 'L' }],
  });
  assert.strictEqual(onHand(as, tracked.id).status, 'out');
});
