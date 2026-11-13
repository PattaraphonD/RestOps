const { makeApi, test, assert } = require('../test_core.js');

function raw(as, name, unit, cost) {
  return as('ingredients.save', { item: { name, unit, costPerUnit: cost, minLevel: 0 } });
}
function setup(as) {
  const oil = raw(as, 'Oil', 'L', 50);
  const chili = raw(as, 'Chili', 'kg', 90);
  const prep = as('ingredients.save', {
    item: { name: 'Chilli oil', unit: 'L', costPerUnit: 0, minLevel: 0, kind: 'prep', batchQty: 2, trackStock: true },
    prepRecipe: [{ ingredientId: oil.id, qty: 1, unit: 'L' }, { ingredientId: chili.id, qty: 200, unit: 'g' }],
  });
  const d = as('menu.save', { item: { name: 'Spicy noodles', price: 100 }, recipe: [{ ingredientId: prep.id, qty: 1000, unit: 'ml' }] });
  return { oil, chili, prep, d };
}
function buy(as, id, unitCost) {
  return as('purchases.add', { date: '2026-11-13', lines: [{ ingredientId: id, qty: 1, unitCost }] });
}

test('purchase impact lists raw item, prep and dish', () => {
  const { as } = makeApi();
  const { chili, prep, d } = setup(as);
  const r = buy(as, chili.id, 120);
  const c = r.impact.ingredients.filter((x) => x.id === chili.id)[0];
  assert.strictEqual(c.oldCost, 90);
  assert.strictEqual(c.newCost, 120);
  assert.strictEqual(c.changePct, 33.3);
  const p = r.impact.ingredients.filter((x) => x.id === prep.id)[0];
  assert.ok(p && p.newCost > p.oldCost);
  const dish = r.impact.dishes.filter((x) => x.id === d.id)[0];
  assert.ok(dish);
  assert.ok(dish.newCost > dish.oldCost);
  assert.strictEqual(dish.overTarget, dish.foodCostPct > 30);
});

test('same price purchase has empty impact', () => {
  const { as } = makeApi();
  const { chili } = setup(as);
  const r = buy(as, chili.id, 90);
  assert.deepStrictEqual(r.impact, { ingredients: [], dishes: [] });
});
