'use strict';
const { makeApi, test, assert } = require('../test_core.js');

const TODAY = '2026-11-13'; // day 13 of 30
function code(fn) { try { fn(); } catch (e) { return e.code + ': ' + e.message; } return 'OK'; }

function seed(db) {
  // 28 days of history: 2026-10-17 … 2026-11-13, ฿1,000 a day.
  const rows = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(Date.UTC(2026, 10, 13 - i)).toISOString().slice(0, 10);
    rows.push({ id: 'S' + i, date: d, menuItemId: 'M', qty: 1, total: 1000, voided: false });
  }
  rows.push({ id: 'SV', date: '2026-11-12', menuItemId: 'M', qty: 1, total: 99999, voided: true });
  db.append('Sales', rows);
  db.append('Purchases', [
    { id: 'P1', date: '2026-11-02', ingredientId: 'I', qty: 1, total: 2500, voided: false },
    { id: 'P2', date: '2026-11-10', ingredientId: 'I', qty: 1, total: 1500, voided: false },
    { id: 'P3', date: '2026-11-11', ingredientId: 'I', qty: 1, total: 900, voided: true },
    { id: 'P4', date: '2026-10-30', ingredientId: 'I', qty: 1, total: 7000, voided: false },
  ]);
}

test('stock budget from expected revenue and the food cost target', () => {
  const { as, db } = makeApi();
  seed(db);
  const b = as('stock.budget', { today: TODAY });
  assert.equal(b.month, '2026-11');
  assert.equal(b.dayOfMonth, 13);
  assert.equal(b.daysInMonth, 30);
  assert.equal(b.mtdRevenue, 13000);
  assert.equal(b.avgDaily, 1000);
  assert.equal(b.forecastRevenue, 30000);       // 13,000 + 1,000 × 17 days left
  assert.equal(b.targetPct, 30);
  assert.equal(b.source, 'auto');
  assert.equal(b.budget, 9000);
  assert.equal(b.spent, 4000);
  assert.equal(b.remaining, 5000);
  assert.equal(b.usedPct, 44.4);
  assert.equal(b.elapsedPct, 43.3);
  assert.equal(b.pace, 'ok');
});

test('a set budget overrides the automatic one, and pace flags fast spending', () => {
  const { as, db } = makeApi();
  seed(db);
  as('settings.save', { values: { foodBudget: '6000' } });
  const b = as('stock.budget', { today: TODAY });
  assert.equal(b.source, 'set');
  assert.equal(b.budget, 6000);
  assert.equal(b.usedPct, 66.7);
  assert.equal(b.pace, 'ahead');
  as('settings.save', { values: { foodBudget: '3000' } });
  assert.equal(as('stock.budget', { today: TODAY }).pace, 'over');
  assert.match(code(() => as('settings.save', { values: { foodBudget: 'abc' } })), /VALIDATION/);
  as('settings.save', { values: { foodBudget: '' } });
  assert.equal(as('stock.budget', { today: TODAY }).source, 'auto');
});

test('a new restaurant averages over the days it has traded; empty is safe', () => {
  const { as, asStaff, db } = makeApi();
  db.append('Sales', [{ id: 'A', date: '2026-11-12', menuItemId: 'M', qty: 1, total: 400, voided: false },
    { id: 'B', date: '2026-11-13', menuItemId: 'M', qty: 1, total: 600, voided: false }]);
  const b = as('stock.budget', { today: TODAY });
  assert.equal(b.avgDaily, 500);
  assert.equal(b.forecastRevenue, 1000 + 500 * 17);
  const e = makeApi().as('stock.budget', { today: TODAY });
  assert.equal(e.forecastRevenue, 0);
  assert.equal(e.budget, 0);
  assert.equal(e.usedPct, null);
  assert.equal(e.pace, 'ok');
  assert.match(code(() => asStaff('stock.budget', { today: TODAY })), /FORBIDDEN/);
});

test('ingredient code is optional, unique, and returned in boot', () => {
  const { as } = makeApi();
  const a = as('ingredients.save', { item: { name: 'Pork', code: 'MT-001', unit: 'kg', costPerUnit: 120, minLevel: 1 } });
  as('ingredients.save', { item: { name: 'Rice', unit: 'kg', costPerUnit: 30, minLevel: 1 } });
  assert.match(code(() => as('ingredients.save', { item: { name: 'Chicken', code: 'mt-001', unit: 'kg', costPerUnit: 80, minLevel: 1 } })), /VALIDATION: Ingredient code "mt-001" already exists\./);
  const boot = as('bootstrap', {});
  const pork = boot.ingredients.find((i) => i.id === a.id);
  assert.equal(pork.code, 'MT-001');
  assert.equal(boot.ingredients.find((i) => i.name === 'Rice').code, '');
});
