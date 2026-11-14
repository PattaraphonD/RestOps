'use strict';
const { makeApi, test, assert } = require('../test_core.js');
const P = global.RestoPricing || require('../../app/js/pricing.js');

const channels = [
  { id: 'DINE', commissionPct: 0, packagingCost: 0 },
  { id: 'TAKE', commissionPct: 0, packagingCost: 3 },
  { id: 'GRAB', commissionPct: 30, packagingCost: 3 },
];

test('profit board: margin, real profit, food cost and flags per dish', () => {
  const b = P.profitBoard({
    dishes: [
      { id: 'A', price: 55, foodCost: 24, prices: { GRAB: 79 }, hasRecipe: true },
      { id: 'B', price: 65, foodCost: 22, prices: {}, hasRecipe: true },
      { id: 'C', price: 40, foodCost: 0, prices: {}, hasRecipe: false },
    ],
    channels, targetPct: 35, rounding: '1', overheadPerDish: 20,
  });
  const a = b.rows.find((r) => r.id === 'A');
  assert.equal(a.foodCostPct, 43.6);
  assert.equal(a.overTarget, true);
  assert.equal(a.cells.DINE.cm, 31);
  assert.equal(a.cells.DINE.realProfit, 11);
  assert.equal(a.cells.TAKE.cm, 28);
  assert.equal(a.cells.GRAB.price, 79);
  assert.equal(a.cells.GRAB.own, true);
  assert.equal(a.cells.GRAB.cm, 28.3);            // 79 × 0.7 − 24 − 3
  assert.equal(a.cells.GRAB.realProfit, 8.3);
  // Dine-in misses the 35 % target: target price 24 ÷ 0.35 = 68.57 → 69 (break-even 44 is lower).
  assert.equal(a.cells.DINE.suggested, 69);
  const bRow = b.rows.find((r) => r.id === 'B');
  assert.equal(bRow.overTarget, false);
  // Grab on menu price 65: net 45.5 − 22 − 3 = 20.5; real 0.5. Break-even (22+3+20)/0.7 = 64.3; target 25/(0.35×0.7)=102.04 → 103.
  assert.equal(bRow.cells.GRAB.cm, 20.5);
  assert.equal(bRow.cells.GRAB.suggested, 103);
  const c = b.rows.find((r) => r.id === 'C');
  assert.equal(c.noRecipe, true);
  assert.equal(c.cells.DINE, undefined);
  assert.deepEqual(b.counts, { all: 3, loss: 0, overTarget: 1, noRecipe: 1 });
});

test('profit board: losses and break-even suggested price', () => {
  const b = P.profitBoard({
    dishes: [{ id: 'X', price: 69, foodCost: 30, prices: {}, hasRecipe: true }],
    channels: [{ id: 'GRAB', commissionPct: 30, packagingCost: 3 }], targetPct: 60, rounding: '1', overheadPerDish: 20,
  });
  const x = b.rows[0].cells.GRAB;
  assert.equal(x.cm, 15.3);                      // 48.3 − 30 − 3
  assert.equal(x.realProfit, -4.7);
  assert.equal(x.meetsTarget, false);             // 33 ÷ 48.3 = 68 % > 60 %
  assert.equal(b.rows[0].loss, true);
  assert.deepEqual(b.rows[0].lossChannels, ['GRAB']);
  // Break-even (30 + 3 + 20) ÷ 0.7 = 75.7 → 76; target price 33 ÷ (0.6 × 0.7) = 78.6 → 79. Higher wins.
  assert.equal(x.suggested, 79);
  assert.equal(b.counts.loss, 1);
});

test('profit board without running costs shows margin only', () => {
  const b = P.profitBoard({ dishes: [{ id: 'A', price: 100, foodCost: 20, prices: {}, hasRecipe: true }],
    channels: [{ id: 'DINE', commissionPct: 0, packagingCost: 0 }], targetPct: 30, rounding: '1', overheadPerDish: null });
  assert.equal(b.rows[0].cells.DINE.cm, 80);
  assert.equal(b.rows[0].cells.DINE.realProfit, null);
  assert.equal(b.rows[0].cells.DINE.suggested, null);
  assert.equal(b.rows[0].loss, false);
});

test('costs.overhead: last 30 days of expenses per dish sold', () => {
  const { as, asStaff, db } = makeApi();
  db.append('Expenses', [
    { id: 'E1', date: '2026-11-10', category: 'Rent', amount: 9000, voided: false },
    { id: 'E2', date: '2026-10-20', category: 'Staff', amount: 3000, voided: false },
    { id: 'E3', date: '2026-11-11', category: 'Gas', amount: 500, voided: true },
    { id: 'E4', date: '2026-09-01', category: 'Old', amount: 7000, voided: false },
  ]);
  db.append('Sales', [
    { id: 'S1', date: '2026-11-12', menuItemId: 'M', qty: 400, total: 1, voided: false },
    { id: 'S2', date: '2026-10-25', menuItemId: 'M', qty: 200, total: 1, voided: false },
    { id: 'S3', date: '2026-11-12', menuItemId: 'M', qty: 999, total: 1, voided: true },
  ]);
  const o = as('costs.overhead', { today: '2026-11-13' });
  assert.equal(o.from, '2026-10-15');
  assert.equal(o.to, '2026-11-13');
  assert.equal(o.expenses, 12000);
  assert.equal(o.dishes, 600);
  assert.equal(o.perDish, 20);
  assert.throws(() => asStaff('costs.overhead', { today: '2026-11-13' }));
  const empty = makeApi().as('costs.overhead', { today: '2026-11-13' });
  assert.equal(empty.perDish, null);
});
