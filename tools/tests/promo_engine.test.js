'use strict';
const { test, assert } = require('../test_core.js');
const P = global.RestoPricing || require('../../app/js/pricing.js');

const GRAB = { commissionPct: 30, packagingCost: 5, commissionOnDiscounted: true };
const DISH = { id: 'A', name: 'Pad Thai', listPrice: 120, foodCost: 30, qty: 1 };
const econ = (o) => P.promoEconomics(Object.assign({ type: 'percentOff', value: 20, platformFundedPct: 0, campaignCommissionPct: null,
  targetPct: 30, channel: GRAB, items: [DISH] }, o));
const allFinite = (row) => Object.keys(row).forEach((k) => {
  const v = row[k];
  if (typeof v === 'number') assert.ok(Number.isFinite(v), k + ' = ' + v);
});

test('promoPrice for each per-dish type', () => {
  assert.equal(P.promoPrice('percentOff', 20, 120), 96);
  assert.equal(P.promoPrice('amountOff', 200, 120), 0);
  assert.equal(P.promoPrice('fixedPrice', 99, 120), 99);
  assert.equal(P.promoPrice('buyXGetY', '2+1', 120), 80);
  assert.deepEqual(P.PROMO_TYPES, ['percentOff', 'amountOff', 'fixedPrice', 'bundle', 'buyXGetY']);
});

test('parseBxgy accepts X+Y with both at least 1', () => {
  assert.deepEqual(P.parseBxgy('2+1'), { x: 2, y: 1 });
  assert.deepEqual(P.parseBxgy(' 3 + 1 '), { x: 3, y: 1 });
  ['2', '0+1', '2+0', 'a+b', '', null, '1.5+1'].forEach((v) => assert.equal(P.parseBxgy(v), null, String(v)));
});

test('percent off on a delivery app, half funded by the app', () => {
  const r = econ({ platformFundedPct: 50 }).rows[0];
  assert.equal(r.promoPrice, 96);
  assert.equal(r.discount, 12);
  assert.equal(r.platformDiscount, 12);
  assert.equal(r.credited, 108);
  assert.equal(r.commission, 28.8);
  assert.equal(r.cmBefore, 49);
  assert.equal(r.cmDuring, 44.2);
  assert.equal(r.uplift.toFixed(3), '0.109');
  // (30 + 5) / (108 − 28.8) = 44.2 % > target 30 + 5 → thin
  assert.equal(r.costPctDuring, 44.2);
  assert.equal(r.verdict, 'thin');
});

test('campaign commission and commission base', () => {
  assert.equal(econ({ campaignCommissionPct: 35 }).rows[0].commission, 33.6);
  const onList = econ({ channel: Object.assign({}, GRAB, { commissionOnDiscounted: false }) }).rows[0];
  assert.equal(onList.commission, 36);
});

test('100 % off is a loss with no NaN or Infinity', () => {
  const r = econ({ value: 100 }).rows[0];
  assert.equal(r.promoPrice, 0);
  assert.equal(r.credited, 0);
  assert.equal(r.commission, 0);
  assert.equal(r.cmDuring, -35);
  assert.equal(r.verdict, 'loss');
  assert.equal(r.uplift, null);
  assert.equal(r.costPctDuring, null);
  allFinite(r);
  const amt = econ({ type: 'amountOff', value: 500 }).rows[0];
  assert.equal(amt.promoPrice, 0);
  assert.equal(amt.verdict, 'loss');
  const free = econ({ type: 'fixedPrice', value: 0 }).rows[0];
  assert.equal(free.verdict, 'loss');
});

test('thin verdict between target + 5 and a loss', () => {
  // 30 % off: promo 84, credited 84, commission 25.2, net 58.8, cost 35 → 59.5 % → thin, CM 23.8
  const r = econ({ value: 30 }).rows[0];
  assert.equal(r.cmDuring, 23.8);
  assert.equal(r.costPctDuring, 59.5);
  assert.equal(r.verdict, 'thin');
});

test('bundle is one row and splits its price by list share', () => {
  const items = [{ id: 'curry', name: 'Curry', listPrice: 139, foodCost: 48, qty: 1 }, { id: 'tea', name: 'Tea', listPrice: 55, foodCost: 12, qty: 1 }];
  const e = P.promoEconomics({ type: 'bundle', value: 179, platformFundedPct: 0, campaignCommissionPct: null, targetPct: 30, channel: GRAB, items });
  assert.equal(e.rows.length, 1);
  const r = e.rows[0];
  assert.equal(r.listPrice, 194);
  assert.equal(r.promoPrice, 179);
  assert.equal(r.discount, 15);
  // packaging = 2 dishes × 5
  assert.equal(r.cmBefore, Math.round((194 * 0.7 - 60 - 10) * 100) / 100);
  const split = P.bundleSplit(items, 179);
  assert.equal(split.reduce((a, x) => a + x.unitPrice, 0).toFixed(2), '179.00');
  assert.equal(split.find((x) => x.id === 'curry').unitPrice.toFixed(2), '128.25');
  const zero = P.bundleSplit([{ id: 'a', listPrice: 0, qty: 1 }, { id: 'b', listPrice: 0, qty: 3 }], 100);
  assert.deepEqual(zero.map((x) => x.unitPrice), [25, 25]);
  const one = P.promoEconomics({ type: 'bundle', value: 50, platformFundedPct: 0, targetPct: 30, channel: GRAB,
    items: [{ id: 'x', name: 'X', listPrice: 30, foodCost: 5, qty: 2 }] });
  assert.equal(one.rows[0].listPrice, 60);
});

test('overall sums rows and worst lists the weakest non-profitable dishes', () => {
  const items = [DISH, { id: 'B', name: 'Cheap', listPrice: 40, foodCost: 25, qty: 1 }];
  const e = econ({ items, value: 20 });
  assert.equal(e.overall.cmBefore, Math.round((e.rows[0].cmBefore + e.rows[1].cmBefore) * 100) / 100);
  assert.deepEqual(e.worst, ['B', 'A'], 'B loses money, A is thin');
  assert.equal(econ({ value: 0 }).worst.length, 1, 'only the thin dish at no discount');
});

test('counter-offer finds the largest discount that stays on target', () => {
  const dish = { id: 'D', name: 'D', listPrice: 200, foodCost: 40, qty: 1 };
  const lossy = { id: 'L', name: 'L', listPrice: 50, foodCost: 45, qty: 1 };
  const co = P.counterOffer({ type: 'percentOff', platformFundedPct: 0, campaignCommissionPct: null, targetPct: 30, channel: GRAB, items: [dish, lossy] });
  // Independent brute force for D: cost % = (40 + 5) / (0.7 × price) ≤ 35
  let best = null;
  for (let p = 0; p <= 90; p += 0.5) { const price = 200 * (1 - p / 100); if (45 / (0.7 * price) * 100 <= 35 + 1e-9) best = p; }
  assert.equal(co.onTarget.maxPct, best);
  assert.ok(co.onTarget.excluded.includes('L'));
  assert.ok(co.breakEven.excluded.includes('L'));
  assert.ok(co.breakEven.maxPct > co.onTarget.maxPct);
  const none = P.counterOffer({ type: 'percentOff', platformFundedPct: 0, targetPct: 30, channel: GRAB, items: [lossy] });
  assert.equal(none.onTarget.maxPct, null);
});
