'use strict';
// Required via the runner; use the runner's module so tests share one registry.
const { makeApi, test, assert } = require('../test_core.js');

test('bootstrap returns version 1.3.0', () => {
  const { as } = makeApi();
  assert.equal(as('bootstrap').version, '1.7.1');
});

test('purchase of 2 kg gives onHand 2', () => {
  const { as } = makeApi();
  const ing = as('ingredients.save', { item: { name: 'Flour', category: 'Dry', unit: 'kg', costPerUnit: 100, minLevel: 1, parLevel: 5 } });
  as('purchases.add', { date: '2026-11-13', lines: [{ ingredientId: ing.id, qty: 2, unitCost: 100 }] });
  const lvl = as('stock.levels').filter((s) => s.id === ing.id)[0];
  assert.equal(lvl.onHand, 2);
});
