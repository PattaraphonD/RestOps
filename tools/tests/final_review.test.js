const { makeApi, test, assert } = require('../test_core.js');
const RestoCore = require('../../app/js/core.js');

function raw(as, name, unit, cost, extra) {
  return as('ingredients.save', { item: Object.assign({ name, unit, costPerUnit: cost, minLevel: 0 }, extra || {}) });
}
function fails(fn, re) {
  assert.throws(fn, (e) => e && e.code === 'VALIDATION' && re.test(e.message));
}

test('removing a conversion used by a dish recipe is refused', () => {
  const { as } = makeApi();
  const e = raw(as, 'Eggs', 'pcs', 5);
  const e2 = as('ingredients.save', { item: { id: e.id, version: e.version, name: 'Eggs', unit: 'pcs', costPerUnit: 5, minLevel: 0 },
    units: [{ unit: 'g', factor: 1 / 55 }] });
  as('menu.save', { item: { name: 'Omelette', price: 100 }, recipe: [{ ingredientId: e.id, qty: 110, unit: 'g' }] });
  fails(() => as('ingredients.save', { item: { id: e.id, version: e2.version, name: 'Eggs', unit: 'pcs', costPerUnit: 5, minLevel: 0 }, units: [] }),
    /Can't convert g to pcs for Eggs\. Add a conversion on the ingredient\. Used in Omelette\./);
});

test('changing a stock unit used by a dish recipe is refused', () => {
  const { as } = makeApi();
  const p = raw(as, 'Pork', 'kg', 200);
  as('menu.save', { item: { name: 'Pork rice', price: 100 }, recipe: [{ ingredientId: p.id, qty: 150, unit: 'g' }] });
  fails(() => as('ingredients.save', { item: { id: p.id, version: p.version, name: 'Pork', unit: 'pack', costPerUnit: 200, minLevel: 0 } }),
    /Can't convert g to pack for Pork.*Used in Pork rice\./);
});

test('prep line failure names the prep and translates to Thai', () => {
  const { as } = makeApi();
  const e = raw(as, 'Eggs', 'pcs', 5);
  const e2 = as('ingredients.save', { item: { id: e.id, version: e.version, name: 'Eggs', unit: 'pcs', costPerUnit: 5, minLevel: 0 },
    units: [{ unit: 'g', factor: 1 / 55 }] });
  as('ingredients.save', { item: { name: 'Egg mix', unit: 'kg', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 1 },
    prepRecipe: [{ ingredientId: e.id, qty: 550, unit: 'g' }] });
  let msg = '';
  try { as('ingredients.save', { item: { id: e.id, version: e2.version, name: 'Eggs', unit: 'pcs', costPerUnit: 5, minLevel: 0 }, units: [] }); } catch (x) { msg = x.message; }
  assert.ok(/Used in Egg mix\./.test(msg), msg);
  const th = RestoCore.translate(msg, 'th');
  assert.ok(!/Can't|Add a|Used in/.test(th), th);
  assert.ok(th.indexOf('Egg mix') >= 0);
});

test('new validation messages translate fully to Thai', () => {
  const th = (m) => RestoCore.translate(m, 'th');
  [
    'Batch quantity must be greater than 0.',
    'Conversion factor must be greater than 0.',
    'Conversion unit is required.',
    'Shelf life (days) must be a whole number.',
    'Yield must be between 1 and 1000 %.',
    'A prep needs at least one recipe line.',
    'Recipe line 2: choose an ingredient.',
    "Can't convert cup to kg for Rice. Add a conversion on the ingredient.",
    "Can't convert cup to kg for Rice. Add a conversion on the ingredient. Used in Fried rice.",
    "Chilli oil can't contain itself (via Oil).",
    'Preps can be nested at most 4 levels deep.',
    'Eggs is in the recipe twice.',
    "A conversion can't use the stock unit itself.",
    'Choose a prep item to produce.',
    'Choose who made it.',
    "A by-product can't be the item being produced.",
    'Production entries are removed by voiding the production run.',
    'Line 1: Chilli oil is made in the kitchen. Record a production run instead.',
    "Chilli oil is made to order and isn't kept in stock.",
  ].forEach((m) => {
    const out = th(m);
    assert.notStrictEqual(out, m);
    const stripped = out.replace(/Rice|Fried rice|Eggs|Chilli oil|Oil|Egg mix|cup|kg/g, '').replace(/[^A-Za-z]+/g, ' ').trim();
    assert.strictEqual(stripped, '', m + ' -> ' + out);
  });
});

test('run numbers only pad short numbers', () => {
  assert.strictEqual(RestoCore.formatRunNo(7), 'PR-0007');
  assert.strictEqual(RestoCore.formatRunNo(9999), 'PR-9999');
  assert.strictEqual(RestoCore.formatRunNo(10000), 'PR-10000');
});

test('made-to-order preps cannot be produced or be by-products', () => {
  const { as } = makeApi();
  const oil = raw(as, 'Oil', 'L', 50);
  const mto = as('ingredients.save', { item: { name: 'Fresh sauce', unit: 'L', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 1, trackStock: false },
    prepRecipe: [{ ingredientId: oil.id, qty: 1, unit: 'L' }] });
  const tracked = as('ingredients.save', { item: { name: 'Stock sauce', unit: 'L', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 1, trackStock: true },
    prepRecipe: [{ ingredientId: oil.id, qty: 1, unit: 'L' }] });
  fails(() => as('production.add', { date: '2026-11-13', prepId: mto.id, batches: 1, producedQty: 1 }), /Fresh sauce is made to order and isn't kept in stock\./);
  fails(() => as('production.add', { date: '2026-11-13', prepId: tracked.id, batches: 1, producedQty: 1,
    byproducts: [{ ingredientId: mto.id, qty: 1, unit: 'L' }] }), /Fresh sauce is made to order/);
});

test('switching raw to prep logs a cost change', () => {
  const { as, db } = makeApi();
  const oil = raw(as, 'Oil', 'L', 50);
  const x = raw(as, 'Thing', 'L', 80);
  const before = db.read('CostChanges').length;
  as('ingredients.save', { item: { id: x.id, version: x.version, name: 'Thing', unit: 'L', costPerUnit: 80, minLevel: 0, kind: 'prep', batchQty: 1 },
    prepRecipe: [{ ingredientId: oil.id, qty: 1, unit: 'L' }] });
  const rows = db.read('CostChanges').filter((r) => r.ingredientId === x.id);
  assert.ok(db.read('CostChanges').length > before);
  assert.ok(rows.some((r) => r.oldCost === 80 && r.newCost === 50), JSON.stringify(rows));
});
