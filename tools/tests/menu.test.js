const { makeApi, test, assert } = require('../test_core.js');

function raw(as, name, unit, cost, extra) {
  return as('ingredients.save', { item: Object.assign({ name, unit, costPerUnit: cost, minLevel: 0 }, extra || {}) });
}
function level(as, id) { return as('stock.levels').filter((s) => s.id === id)[0]; }
function stockUp(as, id, qty) {
  as('movements.add', { date: '2026-01-01', type: 'adjustment', reason: 'seed', lines: [{ ingredientId: id, qty }] });
}
function prepOil(as, trackStock) {
  const oil = raw(as, 'Oil', 'L', 50);
  const chili = raw(as, 'Chili', 'kg', 90);
  const prep = as('ingredients.save', {
    item: { name: 'Chilli oil', unit: 'L', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 2, trackStock },
    prepRecipe: [{ ingredientId: oil.id, qty: 1, unit: 'L' }, { ingredientId: chili.id, qty: 200, unit: 'g' }],
  });
  return { oil, chili, prep };
}
function dish(as, name, recipe) {
  return as('menu.save', { item: { name, price: 100 }, recipe });
}

test('dish cost with unit and yield', () => {
  const { as } = makeApi();
  const fish = raw(as, 'Fish', 'kg', 200, { yieldPct: 45 });
  const d = dish(as, 'Fish dish', [{ ingredientId: fish.id, qty: 180, unit: 'g' }]);
  assert.strictEqual(d.foodCost, 80);
  assert.strictEqual(d.recipe[0].grossQty, 0.4);
  assert.strictEqual(d.recipe[0].share, 100);
  assert.strictEqual(d.recipe[0].unit, 'g');
  assert.strictEqual(d.recipe[0].stockUnit, 'kg');
  assert.strictEqual(d.recipe[0].yieldPct, 45);
});

test('dish using tracked prep and sale deduction', () => {
  const { as } = makeApi();
  const { prep } = prepOil(as, true);
  stockUp(as, prep.id, 5);
  const fish = raw(as, 'Fish', 'kg', 200, { yieldPct: 45 });
  stockUp(as, fish.id, 5);
  const d = dish(as, 'Combo', [{ ingredientId: fish.id, qty: 180, unit: 'g' }, { ingredientId: prep.id, qty: 50, unit: 'ml' }]);
  assert.strictEqual(d.recipe[1].cost, 1.7);
  as('sales.add', { date: '2026-01-02', lines: [{ menuItemId: d.id, qty: 2 }] });
  assert.strictEqual(level(as, fish.id).onHand, 4.2);
  assert.strictEqual(level(as, prep.id).onHand, 4.9);
});

test('untracked prep deducts raw ingredients', () => {
  const { as } = makeApi();
  const { oil, chili, prep } = prepOil(as, false);
  stockUp(as, oil.id, 10);
  stockUp(as, chili.id, 10);
  const d = dish(as, 'Spicy', [{ ingredientId: prep.id, qty: 100, unit: 'ml' }]);
  as('sales.add', { date: '2026-01-02', lines: [{ menuItemId: d.id, qty: 1 }] });
  assert.strictEqual(level(as, oil.id).onHand, 9.95);
  assert.strictEqual(level(as, chili.id).onHand, 9.99);
  assert.strictEqual(level(as, prep.id).onHand, 0);
});

test('recipe line unit must convert', () => {
  const { as } = makeApi();
  const eggs = raw(as, 'Eggs', 'pcs', 5);
  assert.throws(() => dish(as, 'Omelette', [{ ingredientId: eggs.id, qty: 1, unit: 'tbsp' }]),
    (e) => e.code === 'VALIDATION' && /Can't convert/.test(e.message));
  assert.throws(() => dish(as, 'Omelette', [{ ingredientId: eggs.id, qty: 1, yieldPct: 0 }]),
    (e) => e.code === 'VALIDATION' && /Yield must be between/.test(e.message));
});

test('legacy line without unit or yield', () => {
  const { as } = makeApi();
  const beef = raw(as, 'Beef', 'kg', 300);
  stockUp(as, beef.id, 5);
  const d = dish(as, 'Beef plate', [{ ingredientId: beef.id, qty: 0.15 }]);
  assert.strictEqual(d.recipe[0].cost, 45);
  assert.strictEqual(d.recipe[0].unit, 'kg');
  as('sales.add', { date: '2026-01-02', lines: [{ menuItemId: d.id, qty: 2 }] });
  assert.strictEqual(level(as, beef.id).onHand, 4.7);
});
