const { makeApi, test, assert } = require('../test_core.js');

function raw(as, name, unit, cost, extra) {
  return as('ingredients.save', { item: Object.assign({ name, unit, costPerUnit: cost, minLevel: 0 }, extra || {}) });
}
function level(as, id) { return as('stock.levels').filter((s) => s.id === id)[0]; }
function fails(fn, re) {
  assert.throws(fn, (e) => e && e.code === 'VALIDATION' && re.test(e.message));
}
function seedOil(as) {
  const oil = raw(as, 'Oil', 'L', 50);
  const chili = raw(as, 'Chili', 'kg', 90);
  const prep = as('ingredients.save', {
    item: { name: 'Chilli oil', unit: 'L', costPerUnit: 999, minLevel: 0, kind: 'prep', batchQty: 2 },
    prepRecipe: [{ ingredientId: oil.id, qty: 1, unit: 'L' }, { ingredientId: chili.id, qty: 200, unit: 'g' }],
  });
  return { oil, chili, prep };
}

test('ingredient yield validation and storage', () => {
  const { as } = makeApi();
  fails(() => raw(as, 'Fish', 'kg', 200, { yieldPct: 0 }), /Yield must be between 1 and 1000/);
  fails(() => raw(as, 'Fish', 'kg', 200, { yieldPct: 1001 }), /Yield must be between/);
  const f = raw(as, 'Fish', 'kg', 200, { yieldPct: 72 });
  assert.strictEqual(level(as, f.id).yieldPct, 72);
});

test('conversions saved and validated', () => {
  const { as } = makeApi();
  const e = raw(as, 'Eggs', 'pcs', 5, { }); 
  const saved = as('ingredients.save', { item: { id: e.id, version: e.version, name: 'Eggs', unit: 'pcs', costPerUnit: 5, minLevel: 0 },
    units: [{ unit: 'g', factor: 1 / 55 }] });
  assert.strictEqual(level(as, saved.id).conversions.length, 1);
  const bad = (units) => as('ingredients.save', { item: { id: e.id, version: saved.version, name: 'Eggs', unit: 'pcs', costPerUnit: 5, minLevel: 0 }, units });
  fails(() => bad([{ unit: 'g', factor: 0 }]), /Conversion factor must be greater than 0/);
  fails(() => bad([{ unit: '', factor: 1 }]), /required/);
  fails(() => bad([{ unit: 'pcs', factor: 1 }]), /can't use the stock unit itself/);
});

test('prep item cost from recipe', () => {
  const { as } = makeApi();
  const { prep } = seedOil(as);
  const l = level(as, prep.id);
  assert.strictEqual(l.kind, 'prep');
  assert.strictEqual(l.costPerUnit, 34);
  assert.strictEqual(l.prepLines.length, 2);
});

test('prep validation', () => {
  const { as } = makeApi();
  const { chili, oil } = seedOil(as);
  const mk = (extra, lines) => as('ingredients.save', { item: Object.assign({ name: 'P', unit: 'L', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 1 }, extra), prepRecipe: lines });
  fails(() => mk({}, [{ ingredientId: chili.id, qty: 1, unit: 'pcs' }]), /Can't convert/);
  fails(() => mk({ batchQty: 0 }, [{ ingredientId: oil.id, qty: 1, unit: 'L' }]), /Batch quantity must be greater than 0/);
  fails(() => mk({}, []), /A prep needs at least one recipe line/);
  fails(() => mk({}, [{ ingredientId: '', qty: 1, unit: 'L' }]), /Recipe line 1: choose an ingredient/);
  fails(() => mk({}, [{ ingredientId: oil.id, qty: 1, unit: 'L' }, { ingredientId: oil.id, qty: 1, unit: 'L' }]), /is in the recipe twice/);
  fails(() => mk({}, [{ ingredientId: oil.id, qty: 1, unit: 'L', yieldPct: 5000 }]), /Yield must be between/);
});

test('prep cycles rejected', () => {
  const { as } = makeApi();
  const { oil } = seedOil(as);
  const a = as('ingredients.save', { item: { name: 'A', unit: 'L', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 1 },
    prepRecipe: [{ ingredientId: oil.id, qty: 1, unit: 'L' }] });
  const b = as('ingredients.save', { item: { name: 'B', unit: 'L', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 1 },
    prepRecipe: [{ ingredientId: a.id, qty: 1, unit: 'L' }] });
  const a2 = as('stock.levels').filter((s) => s.id === a.id)[0];
  fails(() => as('ingredients.save', { item: { id: a.id, version: a2.version, name: 'A', unit: 'L', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 1 },
    prepRecipe: [{ ingredientId: b.id, qty: 1, unit: 'L' }] }), /can't contain itself/);
});

test('purchase updates prep cost and history', () => {
  const { as } = makeApi();
  const { chili, prep } = seedOil(as);
  as('purchases.add', { date: '2026-11-13', lines: [{ ingredientId: chili.id, qty: 1, unitCost: 120 }] });
  assert.strictEqual(level(as, prep.id).costPerUnit, 37);
  const h = as('ingredients.costHistory', { id: prep.id });
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].oldCost, 34);
  assert.strictEqual(h[0].newCost, 37);
  assert.strictEqual(h[0].source, 'prep');
  assert.strictEqual(h[0].changePct, 8.8);
  const hc = as('ingredients.costHistory', { id: chili.id });
  assert.strictEqual(hc[0].source, 'purchase');
});

test('purchase of a prep is rejected', () => {
  const { as } = makeApi();
  const { prep } = seedOil(as);
  fails(() => as('purchases.add', { date: '2026-11-13', lines: [{ ingredientId: prep.id, qty: 1, unitCost: 5 }] }), /made in the kitchen/);
});

test('manual raw cost change is logged; legacy rows default', () => {
  const { as, db } = makeApi();
  const r = raw(as, 'Salt', 'kg', 10);
  as('ingredients.save', { item: { id: r.id, version: r.version, name: 'Salt', unit: 'kg', costPerUnit: 12, minLevel: 0 } });
  const h = as('ingredients.costHistory', { id: r.id });
  assert.strictEqual(h[0].source, 'manual');
  db.updateWhere('Ingredients', (x) => x.id === r.id, { yieldPct: '', kind: '', trackStock: '' });
  const l = level(as, r.id);
  assert.strictEqual(l.yieldPct, 100);
  assert.strictEqual(l.kind, 'raw');
  assert.strictEqual(l.trackStock, true);
});

test('po suggestions skip preps', () => {
  const { as } = makeApi();
  const { prep } = seedOil(as);
  as('ingredients.save', { item: { id: prep.id, version: level(as, prep.id).version, name: 'Chilli oil', unit: 'L', costPerUnit: 0, minLevel: 5, kind: 'prep', batchQty: 2 },
    prepRecipe: level(as, prep.id).prepLines });
  const names = [].concat.apply([], as('po.suggestions').map((g) => g.items.map((i) => i.name)));
  assert.ok(names.indexOf('Chilli oil') < 0);
});

test('stock unit stored as entered', () => {
  const { as } = makeApi();
  const r = raw(as, 'Rice', 'กก.', 30);
  assert.strictEqual(level(as, r.id).unit, 'กก.');
  const r2 = as('ingredients.save', { item: { id: r.id, version: r.version, name: 'Rice', unit: 'กก.', costPerUnit: 30, minLevel: 0 } });
  assert.strictEqual(level(as, r2.id).unit, 'กก.');
});

test('editing a child cannot break parent prep lines', () => {
  const { as } = makeApi();
  const { chili } = seedOil(as);
  fails(() => as('ingredients.save', { item: { id: chili.id, version: chili.version, name: 'Chili', unit: 'pcs', costPerUnit: 90, minLevel: 0 } }), /Can't convert/);
  // removing a conversion that a prep line relies on
  const eggs = raw(as, 'Eggs', 'pcs', 5);
  const e2 = as('ingredients.save', { item: { id: eggs.id, version: eggs.version, name: 'Eggs', unit: 'pcs', costPerUnit: 5, minLevel: 0 }, units: [{ unit: 'g', factor: 1 / 55 }] });
  as('ingredients.save', { item: { name: 'Egg mix', unit: 'kg', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 1 },
    prepRecipe: [{ ingredientId: eggs.id, qty: 110, unit: 'g' }] });
  fails(() => as('ingredients.save', { item: { id: eggs.id, version: e2.version, name: 'Eggs', unit: 'pcs', costPerUnit: 5, minLevel: 0 }, units: [] }), /Can't convert/);
});

test('po.save rejects prep lines', () => {
  const { as } = makeApi();
  const { prep } = seedOil(as);
  const sup = as('suppliers.save', { item: { name: 'S' } });
  fails(() => as('po.save', { item: { supplierId: sup.id, orderDate: '2026-11-13' }, lines: [{ ingredientId: prep.id, qtyOrdered: 1, unitPrice: 5 }] }), /made in the kitchen/);
});
