'use strict';
const { makeApi, test, assert } = require('../test_core.js');

const TODAY = '2026-11-13'; // a Friday
function code(fn) { try { fn(); } catch (e) { return e.code + ': ' + e.message; } return 'OK'; }

function seed(db) {
  const sale = (id, date, total, qty, cost, extra) => Object.assign({ id, date, menuItemId: 'M1', itemName: 'Pad thai', qty, total, costTotal: cost, commission: 0, voided: false }, extra || {});
  db.append('Sales', [
    sale('a', '2026-11-09', 1000, 10, 300),            // Mon this week
    sale('b', '2026-11-13', 2000, 20, 600),            // Fri (today)
    sale('c', '2026-11-13', 500, 5, 150, { menuItemId: 'M2', itemName: 'Tea' }),
    sale('d', '2026-11-06', 1500, 15, 450),            // Fri last week
    sale('e', '2026-11-02', 800, 8, 240),              // Mon last week
    sale('f', '2026-11-07', 9999, 1, 1),               // Sat last week: outside the like-for-like range
    sale('v', '2026-11-13', 7777, 7, 7, { voided: true }),
  ]);
  db.append('Expenses', [{ id: 'x', date: '2026-11-13', category: 'Gas', amount: 200, voided: false }]);
  db.append('StockMovements', [{ id: 'w', date: '2026-11-13', ingredientId: 'I1', type: 'waste', qty: -1, unitCost: 50, value: -50, voided: false }]);
  db.append('Ingredients', [{ id: 'I1', name: 'Shrimp', unit: 'kg', costPerUnit: 50, minLevel: 0, active: true, version: 1 }]);
  db.append('DayCloses', [{ id: 'DAY-1', date: '2026-11-09', closedBy: 'pim', closedAt: '2026-11-09T15:00:00Z', salesTotal: 1000, wasteValue: 0, countLines: 3, note: 'Gas low' }]);
}

test('weekly summary: Monday to today, like-for-like with last week', () => {
  const { as, db } = makeApi();
  seed(db);
  const r = as('reports.period', { period: 'week', date: TODAY, today: TODAY });
  assert.equal(r.from, '2026-11-09');
  assert.equal(r.to, '2026-11-15');
  assert.equal(r.toCap, '2026-11-13');
  assert.equal(r.partial, true);
  assert.equal(r.totals.revenue, 3500);
  assert.equal(r.totals.orders, 35);
  assert.equal(r.previous.from, '2026-11-02');
  assert.equal(r.previous.to, '2026-11-06');
  assert.equal(r.previous.revenue, 2300);
  assert.equal(r.days.length, 7);
  assert.deepEqual(r.days.map((d) => d.date), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  const mon = r.days[0], fri = r.days[4], sat = r.days[5];
  assert.equal(mon.revenue, 1000);
  assert.equal(mon.prevRevenue, 800);
  assert.equal(mon.closed, true);
  assert.equal(fri.revenue, 2500);
  assert.equal(fri.dishes, 25);
  assert.equal(fri.future, false);
  assert.equal(sat.future, true);
  assert.equal(sat.prevRevenue, 9999);
  assert.equal(r.best.date, '2026-11-13');
  assert.equal(r.topItems[0].name, 'Pad thai');
  assert.equal(r.topItems[0].qty, 30);
  assert.equal(r.expenseCategories[0].category, 'Gas');
});

test('daily summary: against the same weekday last week, with close and waste', () => {
  const { as, db } = makeApi();
  seed(db);
  const r = as('reports.period', { period: 'day', date: TODAY, today: TODAY });
  assert.equal(r.from, TODAY);
  assert.equal(r.to, TODAY);
  assert.equal(r.totals.revenue, 2500);
  assert.equal(r.totals.wasteAndVariance, 50);
  assert.equal(r.totals.expenses, 200);
  assert.equal(r.previous.from, '2026-11-06');
  assert.equal(r.previous.revenue, 1500);
  assert.equal(r.close, null);
  assert.deepEqual(r.waste, [{ ingredientId: 'I1', name: 'Shrimp', unit: 'kg', qty: 1, value: 50 }]);
  const mon = as('reports.period', { period: 'day', date: '2026-11-09', today: TODAY });
  assert.equal(mon.close.closedBy, 'pim');
  assert.equal(mon.close.note, 'Gas low');
  assert.equal(mon.partial, false);
});

test('period summary rejects bad input and future dates; staff cannot read it', () => {
  const { as, asStaff } = makeApi();
  assert.match(code(() => as('reports.period', { period: 'year', date: TODAY, today: TODAY })), /VALIDATION/);
  const f = as('reports.period', { period: 'day', date: '2026-12-01', today: TODAY });
  assert.equal(f.from, TODAY, 'a future day is clamped to today');
  assert.match(code(() => asStaff('reports.period', { period: 'day', date: TODAY, today: TODAY })), /FORBIDDEN/);
});
