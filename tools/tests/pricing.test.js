'use strict';
const { test, assert } = require('../test_core.js');
const P = global.RestoPricing || require('../../app/js/pricing.js');

test('roundPrice never rounds down', () => {
  assert.equal(P.roundPrice(83.2, '5'), 85);
  assert.equal(P.roundPrice(85, '5'), 85);
  assert.equal(P.roundPrice(12.3, '0.99'), 12.99);
  assert.equal(P.roundPrice(12.995, '0.99'), 13.99);
  assert.equal(P.roundPrice(83, '9-ending'), 89);
  assert.equal(P.roundPrice(90, '9-ending'), 99);
  assert.equal(P.roundPrice(7.001, 'none'), 7.01);
  assert.equal(P.roundPrice(41.5, '1'), 42);
  assert.equal(P.roundPrice(101, '10'), 110);
});
test('roundPrice rejects empty or invalid prices', () => {
  assert.equal(P.roundPrice(0, '5'), null);
  assert.equal(P.roundPrice(Infinity, '5'), null);
  assert.equal(P.roundPrice(null, '5'), null);
  assert.equal(P.roundPrice(-3, '5'), null);
});
test('effectiveRounding by setting and currency', () => {
  assert.equal(P.effectiveRounding('', 'THB'), '5');
  assert.equal(P.effectiveRounding('', 'USD'), '0.99');
  assert.equal(P.effectiveRounding('10', 'USD'), '10');
  assert.equal(P.effectiveRounding('bogus', 'JPY'), '10');
  assert.deepEqual(P.ROUNDING_RULES, ['none', '1', '5', '10', '0.99', '9-ending']);
});
test('channelEconomics on a delivery app', () => {
  const e = P.channelEconomics({ price: 100, foodCost: 30, packaging: 5, commissionPct: 30, targetPct: 30, rounding: '5' });
  assert.equal(e.netRevenue, 70);
  assert.equal(e.cm, 35);
  assert.equal(e.foodCostPctNet, 42.9);
  assert.equal(e.suggested, 170);
  assert.equal(e.meetsTarget, false);
});
test('channelEconomics on dine-in meets target', () => {
  const e = P.channelEconomics({ price: 100, foodCost: 30, packaging: 0, commissionPct: 0, targetPct: 30, rounding: '5' });
  assert.equal(e.suggested, 100);
  assert.equal(e.meetsTarget, true);
});
test('channelEconomics degenerate inputs give null, never Infinity', () => {
  const base = { price: 100, foodCost: 30, packaging: 0, commissionPct: 30, targetPct: 30, rounding: '5' };
  assert.equal(P.channelEconomics(Object.assign({}, base, { commissionPct: 100 })).suggested, null);
  assert.equal(P.channelEconomics(Object.assign({}, base, { targetPct: 0 })).suggested, null);
  assert.equal(P.channelEconomics(Object.assign({}, base, { foodCost: 0 })).suggested, null);
  const free = P.channelEconomics(Object.assign({}, base, { price: 0 }));
  assert.equal(free.foodCostPctNet, null);
  assert.equal(free.netRevenue, 0);
  assert.equal(free.cm, -30);
  assert.equal(free.meetsTarget, false);
});
test('menuEngineering classifies the four quadrants', () => {
  const r = P.menuEngineering([
    { id: 'A', qty: 50, cm: 2500 }, { id: 'B', qty: 50, cm: 500 },
    { id: 'C', qty: 5, cm: 400 }, { id: 'D', qty: 5, cm: 25 },
  ]);
  assert.equal(r.threshold, 17.5);
  assert.equal(r.avgCm, 31.14);
  const cls = {};
  r.items.forEach((i) => { cls[i.id] = i.cls; });
  assert.deepEqual(cls, { A: 'star', B: 'plowhorse', C: 'puzzle', D: 'dog' });
  const a = r.items.find((i) => i.id === 'A');
  assert.equal(a.mixPct, 45.5);
  assert.equal(a.cmPerDish, 50);
});
test('menuEngineering with nothing or one dish sold', () => {
  const none = P.menuEngineering([]);
  assert.deepEqual(none.items, []);
  assert.equal(none.avgCm, 0);
  const zeroQty = P.menuEngineering([{ id: 'Z', qty: 0, cm: 0 }]);
  assert.deepEqual(zeroQty.items, []);
  const one = P.menuEngineering([{ id: 'X', qty: 3, cm: -6 }]);
  assert.equal(one.threshold, 70);
  assert.equal(one.items[0].popular, true);
  assert.equal(one.items[0].highMargin, true);
});
