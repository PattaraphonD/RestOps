'use strict';
const { makeApi, test, assert } = require('../test_core.js');
const P = global.RestoPricing || require('../../app/js/pricing.js');

const TODAY = '2026-11-13'; // a Friday (weekday 5)
function code(fn) { try { fn(); } catch (e) { return e.code + ': ' + e.message; } return 'OK'; }

function setup() {
  const api = makeApi();
  const { as } = api;
  const ch = as('bootstrap', {}).channels;
  const grab = as('channels.save', { item: { name: 'Grab', type: 'delivery', commissionPct: 30, packagingCost: 5 } });
  const noodle = as('ingredients.save', { item: { name: 'Noodles', unit: 'kg', costPerUnit: 150, minLevel: 0 } });
  const curryI = as('ingredients.save', { item: { name: 'Curry base', unit: 'kg', costPerUnit: 480, minLevel: 0 } });
  const teaI = as('ingredients.save', { item: { name: 'Tea leaves', unit: 'kg', costPerUnit: 1200, minLevel: 0 } });
  const pad = as('menu.save', { item: { name: 'Pad Thai', price: 100 }, recipe: [{ ingredientId: noodle.id, qty: 0.2, unit: 'kg' }],
    prices: [{ channelId: grab.id, price: 120 }] });
  const curry = as('menu.save', { item: { name: 'Green Curry', price: 139 }, recipe: [{ ingredientId: curryI.id, qty: 0.1, unit: 'kg' }] });
  const tea = as('menu.save', { item: { name: 'Thai Tea', price: 55 }, recipe: [{ ingredientId: teaI.id, qty: 0.01, unit: 'kg' }] });
  const promo = (item, items) => as('promotions.save', { item: Object.assign({ name: 'Grab 20', type: 'percentOff', value: 20,
    channelIds: [grab.id], startDate: '2026-11-10', endDate: '2026-11-20', weekdays: [], platformFundedPct: 50, draft: false }, item),
    items: items || [{ menuItemId: pad.id }] });
  return Object.assign(api, { dine: ch[0], grab, pad, curry, tea, promo });
}
module.exports = { setup, TODAY, code };

/* ------------------------------------------------------------ Task 2 */

test('a saved promotion gets its status from the dates', () => {
  const { as, promo } = setup();
  const a = promo({});
  assert.equal(a.version, 1);
  const list = () => as('promotions.list', { today: TODAY });
  assert.equal(list().find((x) => x.id === a.id).status, 'active');
  const f = promo({ name: 'Future', startDate: '2026-11-20', endDate: '' });
  const e = promo({ name: 'Past', startDate: '2026-11-01', endDate: '2026-11-12' });
  const d = promo({ name: 'Draft', draft: true });
  const s = Object.fromEntries(list().map((x) => [x.id, x.status]));
  assert.equal(s[f.id], 'scheduled');
  assert.equal(s[e.id], 'ended');
  assert.equal(s[d.id], 'draft');
  const row = list().find((x) => x.id === a.id);
  assert.deepEqual(row.channelIds.length, 1);
  assert.equal(row.items[0].name, 'Pad Thai');
  assert.ok(row.economics.length === 1 && ['profitable', 'thin', 'loss'].includes(row.economics[0].verdict));
});

test('cancelling a promotion', () => {
  const { as, promo } = setup();
  const a = promo({});
  as('promotions.cancel', { id: a.id });
  assert.equal(as('promotions.list', { today: TODAY }).find((x) => x.id === a.id).status, 'cancelled');
  assert.match(code(() => as('promotions.cancel', { id: a.id })), /This promotion is already cancelled\./);
});

test('promotion validation', () => {
  const { as, asStaff, pad, curry, promo } = setup();
  assert.match(code(() => promo({ type: 'boat' })), /Unknown promotion type\./);
  assert.match(code(() => promo({ value: 0 })), /Discount must be between 0 and 100 %\./);
  assert.match(code(() => promo({ value: 120 })), /Discount must be between 0 and 100 %\./);
  assert.match(code(() => promo({ type: 'amountOff', value: 0 })), /Amount must be greater than 0\./);
  assert.match(code(() => promo({ type: 'buyXGetY', value: '2' })), /Buy-X-get-Y must look like 2\+1\./);
  assert.match(code(() => promo({}, [])), /Choose at least one dish\./);
  assert.match(code(() => promo({ type: 'bundle', value: 150 }, [{ menuItemId: curry.id, qty: 1 }])), /A bundle needs at least two dishes\./);
  assert.match(code(() => promo({ endDate: '2026-11-01' })), /End date can't be before the start date\./);
  assert.match(code(() => promo({ platformFundedPct: 150 })), /Platform share must be between 0 and 100 %\./);
  assert.match(code(() => promo({ campaignCommissionPct: 120 })), /Commission must be between 0 and 99\.9 %\./);
  assert.match(code(() => promo({ weekdays: [9] })), /Unknown weekday\./);
  assert.match(code(() => promo({}, [{ menuItemId: pad.id }, { menuItemId: pad.id }])), /Pad Thai is in the promotion twice\./);
  promo({ name: 'Same' });
  assert.match(code(() => promo({ name: 'Same' })), /Promotion "Same" already exists\./);
  assert.match(code(() => asStaff('promotions.save', { item: { name: 'X' }, items: [] })), /^FORBIDDEN/);
  // a fixed price of 0 (a free dish) is allowed; a 2-dish bundle is fine
  assert.equal(code(() => promo({ name: 'Free', type: 'fixedPrice', value: 0 })), 'OK');
  assert.equal(code(() => promo({ name: 'Set', type: 'bundle', value: 150 }, [{ menuItemId: curry.id, qty: 2 }])), 'OK');
  void as;
});

test('promotions.get economics match the engine', () => {
  const { as, grab, pad, promo } = setup();
  const a = promo({});
  const g = as('promotions.get', { id: a.id, today: TODAY });
  const ch = g.channels.find((c) => c.channelId === grab.id);
  const direct = P.promoEconomics({ type: 'percentOff', value: 20, platformFundedPct: 50, campaignCommissionPct: null, targetPct: 30,
    channel: { commissionPct: 30, packagingCost: 5, commissionOnDiscounted: true },
    items: [{ id: pad.id, name: 'Pad Thai', listPrice: 120, foodCost: 30, qty: 1 }] });
  assert.deepEqual(ch.overall, direct.overall);
  assert.equal(ch.rows[0].credited, 108);
});

test('promotions.check works on an unsaved offer and returns a counter-offer', () => {
  const { as, grab, pad } = setup();
  const r = as('promotions.check', { channelId: grab.id, item: { type: 'percentOff', value: 20, platformFundedPct: 0 }, items: [{ menuItemId: pad.id }] });
  assert.ok(r.economics.overall);
  assert.ok(r.counterOffer && r.counterOffer.breakEven);
  const b = as('promotions.check', { channelId: grab.id, item: { type: 'amountOff', value: 10 }, items: [{ menuItemId: pad.id }] });
  assert.equal(b.counterOffer, null);
});

test('bootstrap lists running and upcoming promotions for sales entry', () => {
  const { as, promo } = setup();
  const a = promo({});
  promo({ name: 'Past', startDate: '2026-11-01', endDate: '2026-11-05' });
  promo({ name: 'Draft', draft: true });
  const names = as('bootstrap', { today: TODAY }).promotions.map((x) => x.name);
  assert.deepEqual(names, ['Grab 20']);
  void a;
});

test('promotion messages translate fully to Thai', () => {
  [
    'Unknown promotion type.', 'Discount must be between 0 and 100 %.', 'Amount must be greater than 0.',
    'Buy-X-get-Y must look like 2+1.', 'Choose at least one dish.', 'A bundle needs at least two dishes.',
    "End date can't be before the start date.", 'Platform share must be between 0 and 100 %.', 'Unknown weekday.',
    'Pad Thai is in the promotion twice.', 'Promotion "Same" already exists.', 'This promotion is already cancelled.',
    'Promotion name is required.', 'Start date must be in YYYY-MM-DD format.', 'Promotion price must be at least 0.',
    'Promotion "Same" was changed by owner while you were editing. Your changes were not saved — reload to see the latest version.',
  ].forEach((m) => {
    const out = RestoCore.translate(m, 'th');
    const left = out.replace(/Pad Thai|Same|owner|YYYY-MM-DD/g, '').replace(/[^A-Za-z]+/g, ' ').trim();
    assert.strictEqual(left, '', m + ' -> ' + out);
  });
});

/* ------------------------------------------------------------ Task 3: promo sales */

const rowsOn = (as, date) => as('sales.list', { from: date, to: date }).rows;

test('a percent-off promo sale stores what the restaurant is credited', () => {
  const { as, grab, pad, promo } = setup();
  const a = promo({});
  as('sales.add', { date: TODAY, channelId: grab.id, lines: [{ menuItemId: pad.id, qty: 2, promoId: a.id, unitPrice: 1 }] });
  const r = rowsOn(as, TODAY)[0];
  assert.equal(r.promoId, a.id);
  assert.equal(r.listPrice, 120);
  assert.equal(r.unitPrice, 108, 'client price ignored on promo lines');
  assert.equal(r.total, 216);
  assert.equal(r.discount, 12);
  assert.equal(r.platformDiscount, 12);
  assert.equal(r.commission, 57.6);
});

test('a bundle line writes one row per component', () => {
  const { as, dine, curry, tea, promo } = setup();
  const b = promo({ name: 'Set', type: 'bundle', value: 179, channelIds: [dine.id], platformFundedPct: 0 },
    [{ menuItemId: curry.id, qty: 1 }, { menuItemId: tea.id, qty: 1 }]);
  as('sales.add', { date: TODAY, channelId: dine.id, lines: [{ promoId: b.id, qty: 2 }] });
  const rows = rowsOn(as, TODAY);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.qty === 2 && r.promoId === b.id));
  assert.equal(Math.round(rows.reduce((a, r) => a + r.total, 0) * 100) / 100, 358);
  const c = rows.find((r) => r.menuItemId === curry.id);
  assert.equal(c.listPrice, 139);
  assert.equal(c.unitPrice, 128.25);
  const lv = as('stock.levels', {}).find((i) => i.name === 'Curry base');
  assert.equal(lv.onHand, -0.2, 'stock deducted for bundle components');
});

test('buy 2 get 1 is priced at two thirds of the list price', () => {
  const { as, grab, pad, promo } = setup();
  const x = promo({ name: '2+1', type: 'buyXGetY', value: '2+1', platformFundedPct: 0 });
  as('sales.add', { date: TODAY, channelId: grab.id, lines: [{ menuItemId: pad.id, qty: 3, promoId: x.id }] });
  assert.equal(rowsOn(as, TODAY)[0].unitPrice, 80);
});

test('promo sales outside the promotion are refused', () => {
  const { as, dine, grab, pad, curry, promo } = setup();
  const a = promo({});
  const mon = promo({ name: 'Mondays', weekdays: [1] });
  const sale = (o) => code(() => as('sales.add', Object.assign({ date: TODAY, channelId: grab.id }, o)));
  assert.match(sale({ date: '2026-11-25', lines: [{ menuItemId: pad.id, qty: 1, promoId: a.id }] }), /Promotion "Grab 20" isn't running on this date and channel\./);
  assert.match(sale({ lines: [{ menuItemId: pad.id, qty: 1, promoId: mon.id }] }), /isn't running/);
  assert.match(sale({ channelId: dine.id, lines: [{ menuItemId: pad.id, qty: 1, promoId: a.id }] }), /isn't running/);
  assert.match(sale({ lines: [{ menuItemId: curry.id, qty: 1, promoId: a.id }] }), /Dish isn't in this promotion\./);
  assert.match(sale({ lines: [{ menuItemId: pad.id, qty: 1, promoId: 'PRM-NOPE' }] }), /^NOT_FOUND/);
  ['Promotion "Grab 20" isn\'t running on this date and channel.', "Dish isn't in this promotion."].forEach((m) => {
    const out = RestoCore.translate(m, 'th');
    assert.equal(out.replace(/Grab/g, '').replace(/[^A-Za-z]+/g, ' ').trim(), '', out);
  });
});

/* ------------------------------------------------------------ Task 4: results */

function addDaysT(d, n) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); }

test('results compare per-day figures with the 4 weeks before', () => {
  const { as, db, grab, pad, promo } = setup();
  const a = promo({ startDate: '2026-11-06', endDate: '2026-11-12' });
  const rows = [];
  let n = 0;
  const row = (date, qty, unitPrice, commission, promoId) => rows.push({ id: 'SAL-T' + (++n), date, menuItemId: pad.id, itemName: 'Pad Thai', qty,
    unitPrice, total: qty * unitPrice, unitCost: 30, costTotal: qty * 30, channel: 'Grab', channelId: grab.id, commission, promoId: promoId || '',
    note: '', voided: false, createdAt: date + 'T01:00:00Z', createdBy: 'owner' });
  for (let i = 1; i <= 28; i++) row(addDaysT('2026-11-06', -i), 10, 120, 360);
  for (let i = 0; i < 7; i++) row(addDaysT('2026-11-06', i), 15, 108, 432, a.id);
  db.append('Sales', rows);
  const r = as('promotions.results', { id: a.id, today: TODAY });
  assert.deepEqual(r.baseline, { from: '2026-10-09', to: '2026-11-05', daysWithSales: 28 });
  assert.deepEqual(r.period, { from: '2026-11-06', to: '2026-11-12', days: 7 });
  assert.equal(r.weak, false);
  assert.deepEqual(r.promoted.before, { units: 10, revenue: 1200, cm: 540 });
  assert.deepEqual(r.promoted.during, { units: 15, revenue: 1620, cm: 738 });
  assert.equal(r.promoted.change.units, 50);
  assert.equal(r.promoted.change.cm, 36.7);
  assert.equal(r.restaurant.change.cm, 36.7);
  assert.equal(r.verdict, 'worked');
  assert.equal(r.daily.length, 35);
  assert.equal(r.daily.filter((d) => d.inPromo).length, 7);
});

test('results count complete days only: a promotion starting today is too early to judge', () => {
  const { as, promo } = setup();
  const today = promo({ name: 'Today', startDate: TODAY, endDate: '' });
  assert.equal(as('promotions.results', { id: today.id, today: TODAY }).verdict, 'tooEarly');
  const running = promo({ name: 'Running', startDate: '2026-11-10', endDate: '' });
  assert.deepEqual(as('promotions.results', { id: running.id, today: TODAY }).period, { from: '2026-11-10', to: '2026-11-12', days: 3 });
});

test('results for a promotion with no history', () => {
  const { as, promo } = setup();
  const a = promo({ startDate: '2026-11-12', endDate: '' });
  const r = as('promotions.results', { id: a.id, today: TODAY });
  assert.equal(r.period.days, 1);
  assert.equal(r.promoted.change.units, null);
  assert.equal(r.restaurant.change.cm, null);
  assert.equal(r.weak, true);
  assert.equal(r.verdict, 'noBaseline');
});

test('results for a promotion that has not started', () => {
  const { as, promo } = setup();
  const a = promo({ startDate: '2026-11-20', endDate: '' });
  assert.equal(as('promotions.results', { id: a.id, today: TODAY }).verdict, 'tooEarly');
});

/* ------------------------------------------------------------ final review fixes */

test('a set priced above its dishes credits what the customer pays', () => {
  const e = P.promoEconomics({ type: 'bundle', value: 100, platformFundedPct: 0, targetPct: 30,
    channel: { commissionPct: 30, packagingCost: 0, commissionOnDiscounted: true },
    items: [{ id: 'a', name: 'A', listPrice: 0, foodCost: 5, qty: 1 }, { id: 'b', name: 'B', listPrice: 0, foodCost: 5, qty: 1 }] });
  assert.equal(e.rows[0].credited, 100);
  assert.equal(e.rows[0].commission, 30);
  assert.equal(e.rows[0].cmDuring, 60);
  const { as, dine, curry, tea, promo } = setup();
  const b = promo({ name: 'Pricey set', type: 'bundle', value: 250, channelIds: [dine.id], platformFundedPct: 0 },
    [{ menuItemId: curry.id, qty: 1 }, { menuItemId: tea.id, qty: 1 }]);
  as('sales.add', { date: TODAY, channelId: dine.id, lines: [{ promoId: b.id, qty: 1 }] });
  const total = as('sales.list', { from: TODAY, to: TODAY }).rows.reduce((a, r) => a + r.total, 0);
  assert.equal(Math.round(total * 100) / 100, 250);
});

test('sales entry still offers a promotion that ended yesterday', () => {
  const { as, promo } = setup();
  promo({ name: 'Ended yesterday', startDate: '2026-11-01', endDate: '2026-11-12' });
  promo({ name: 'Ended earlier', startDate: '2026-11-01', endDate: '2026-11-11' });
  const names = as('bootstrap', { today: TODAY }).promotions.map((x) => x.name);
  assert.ok(names.includes('Ended yesterday'), JSON.stringify(names));
  assert.ok(!names.includes('Ended earlier'));
});

test('results with no sales before the promotion have no verdict to give', () => {
  const { as, promo } = setup();
  const a = promo({ startDate: '2026-11-12', endDate: '' });
  const r = as('promotions.results', { id: a.id, today: TODAY });
  assert.equal(r.verdict, 'noBaseline');
});
