'use strict';
const { makeApi, test, assert } = require('../test_core.js');

const TODAY = '2026-11-13';
function code(fn) { try { fn(); } catch (e) { return e.code + ': ' + e.message; } return 'OK'; }
const task = (s, kind) => s.tasks.find((t) => t.kind === kind);

test('today summary on an empty restaurant', () => {
  const { as } = makeApi();
  const s = as('today.summary', { today: TODAY });
  assert.deepEqual(s.tasks, []);
  assert.equal(s.day.closed, false);
  assert.equal(s.setup.total, 6);
  const steps = Object.fromEntries(s.setup.steps.map((x) => [x.key, x.done]));
  assert.deepEqual(Object.keys(steps), ['restaurant', 'channels', 'suppliers', 'ingredients', 'dishes', 'team']);
  assert.equal(steps.dishes, false);
  assert.equal(steps.ingredients, false);
  assert.equal(steps.team, true, 'makeApi creates a staff user');
});

test('deliveries due and preps to make become tasks', () => {
  const { as, db } = makeApi();
  db.append('PurchaseOrders', [{ id: 'PO-1', poNumber: 'PO-0001', supplierId: '', status: 'sent', orderDate: '2026-11-11', expectedDate: '2026-11-12', total: 100, version: 1 }]);
  const oil = as('ingredients.save', { item: { name: 'Oil', unit: 'l', costPerUnit: 50, minLevel: 0 } });
  as('ingredients.save', { item: { name: 'Chilli oil', unit: 'l', costPerUnit: 0, minLevel: 2, kind: 'prep', batchQty: 1 },
    prepRecipe: [{ ingredientId: oil.id, qty: 1, unit: 'l' }] });
  const s = as('today.summary', { today: TODAY });
  assert.equal(task(s, 'deliveries').n, 1);
  const p = task(s, 'preps');
  assert.equal(p.n, 1);
  assert.equal(p.items[0].name, 'Chilli oil');
  assert.equal(p.items[0].minLevel, 2);
  assert.equal(task(s, 'lowStock').n, 1, 'oil is out of stock (preps are counted separately)');
});

test('staff see no invoice tasks and no setup checklist', () => {
  const { as, asStaff, db } = makeApi();
  db.append('SupplierInvoices', [{ id: 'INV-1', invoiceNo: 'A1', supplierId: '', status: 'exception', total: 10, version: 1 }]);
  assert.equal(task(as('today.summary', { today: TODAY }), 'invoices').n, 1);
  const s = asStaff('today.summary', { today: TODAY });
  assert.ok(!task(s, 'invoices'));
  assert.equal(s.setup, null);
});

test('closing a day records totals once and can be redone', () => {
  const { as, db } = makeApi();
  const rice = as('ingredients.save', { item: { name: 'Rice', unit: 'kg', costPerUnit: 40, minLevel: 0 } });
  const dish = as('menu.save', { item: { name: 'Fried rice', price: 100 }, recipe: [{ ingredientId: rice.id, qty: 0.2, unit: 'kg' }] });
  as('sales.add', { date: TODAY, lines: [{ menuItemId: dish.id, qty: 3 }] });
  as('movements.add', { date: TODAY, type: 'waste', reason: 'Spoiled', lines: [{ ingredientId: rice.id, qty: 0.5 }] });
  const a = as('day.close', { date: TODAY, note: 'Quiet night' });
  assert.equal(a.salesTotal, 300);
  assert.equal(a.wasteValue, 20);
  const b = as('day.close', { date: TODAY });
  assert.equal(db.read('DayCloses').length, 1);
  assert.equal(b.id, a.id);
  const s = as('today.summary', { today: TODAY });
  assert.equal(s.day.closed, true);
  assert.equal(s.day.closedBy, 'owner');
  assert.match(code(() => as('day.close', { date: '2026-11-14' })), /You can't close a day that hasn't happened yet\./);
  // The client's "today" may be a few hours ahead (UTC+7), never days ahead.
  assert.match(code(() => as('day.close', { date: '2026-11-20', today: '2026-11-20' })), /You can't close a day that hasn't happened yet\./);
});

test('an unclosed yesterday with sales asks to be closed', () => {
  const { as } = makeApi();
  const rice = as('ingredients.save', { item: { name: 'Rice', unit: 'kg', costPerUnit: 40, minLevel: 0 } });
  const dish = as('menu.save', { item: { name: 'Fried rice', price: 100 }, recipe: [{ ingredientId: rice.id, qty: 0.2, unit: 'kg' }] });
  as('sales.add', { date: '2026-11-12', lines: [{ menuItemId: dish.id, qty: 1 }] });
  let s = as('today.summary', { today: TODAY });
  assert.equal(s.yesterdayClosed, false);
  assert.ok(task(s, 'closeYesterday'));
  as('day.close', { date: '2026-11-12' });
  s = as('today.summary', { today: TODAY });
  assert.ok(!task(s, 'closeYesterday'));
});

test('day close message is Thai', () => {
  const out = RestoCore.translate("You can't close a day that hasn't happened yet.", 'th');
  assert.equal(out.replace(/[^A-Za-z]+/g, ' ').trim(), '', out);
});

test('day.status reports whether a given day is closed', () => {
  const { as, asStaff } = makeApi();
  assert.equal(asStaff('day.status', { date: '2026-11-12' }).closed, false);
  as('day.close', { date: '2026-11-12', note: 'ok' });
  const s = asStaff('day.status', { date: '2026-11-12' });
  assert.equal(s.closed, true);
  assert.equal(s.closedBy, 'owner');
  assert.equal(s.note, 'ok');
});
