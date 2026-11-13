'use strict';
const { makeApi, test, assert } = require('../test_core.js');

const TODAY = '2026-11-13';

function setup(opts) {
  const api = makeApi();
  const { as } = api;
  if (opts && opts.thai) as('settings.save', { values: { salesChannels: 'ทานที่ร้าน, กลับบ้าน, เดลิเวอรี่' } });
  const ch = as('bootstrap', {}).channels;
  const grab = as('channels.save', { item: { name: 'Grab', type: 'delivery', commissionPct: 30, packagingCost: 5 } });
  const rice = as('ingredients.save', { item: { name: 'Rice', unit: 'kg', costPerUnit: 40, minLevel: 0 } });
  const prawn = as('ingredients.save', { item: { name: 'Prawn', unit: 'kg', costPerUnit: 400, minLevel: 0 } });
  const fried = as('menu.save', { item: { name: 'Fried rice', price: 100 }, recipe: [{ ingredientId: rice.id, qty: 0.2, unit: 'kg' }],
    prices: [{ channelId: grab.id, price: 120 }] });
  const prawnDish = as('menu.save', { item: { name: 'Prawn salad', price: 100 }, recipe: [{ ingredientId: prawn.id, qty: 0.1, unit: 'kg' }] });
  const sell = (channelId, menuItemId, qty, date) => as('sales.add', { date: date || TODAY, channelId, lines: [{ menuItemId, qty }] });
  const summary = () => as('reports.summary', { month: '2026-11', today: TODAY });
  return Object.assign(api, { ch, grab, fried, prawnDish, sell, summary, dine: ch[0], delivery: ch[2] });
}

test('commissions get their own P&L line; food cost % is unchanged', () => {
  const { grab, fried, sell, summary } = setup();
  sell(grab.id, fried.id, 2);
  const t = summary().totals;
  assert.equal(t.revenue, 240);
  assert.equal(t.cogs, 16);
  assert.equal(t.commissions, 72);
  assert.equal(t.grossProfit, 240 - 16 - 72);
  assert.equal(t.netProfit, 240 - 16 - 72);
  assert.equal(t.foodCostPct, Math.round(16 / 240 * 1000) / 10);
});

test('revenue by channel, including older rows that only stored a Thai channel name', () => {
  const { as, db, delivery, fried, grab, sell, summary } = setup({ thai: true });
  sell(grab.id, fried.id, 1);
  db.append('Sales', [{ id: 'SAL-LEGACY01', date: TODAY, menuItemId: fried.id, itemName: 'Fried rice', qty: 2, unitPrice: 100,
    total: 200, unitCost: 8, costTotal: 16, channel: 'เดลิเวอรี่', note: '', voided: false, createdAt: TODAY + 'T01:00:00Z', createdBy: 'owner' }]);
  const by = summary().byChannel;
  const d = by.find((b) => b.channelId === delivery.id);
  assert.ok(d, JSON.stringify(by));
  assert.equal(d.name, 'เดลิเวอรี่');
  assert.equal(d.revenue, 200);
  assert.equal(d.commission, 0);
  assert.ok(!by.some((b) => b.channelId === ''), 'nothing falls into Other');
  const g = by.find((b) => b.channelId === grab.id);
  assert.equal(g.revenue, 120);
  assert.equal(g.commission, 36);
  assert.equal(g.cm, 120 - 8 - 36);
  assert.equal(by[0].channelId, delivery.id, 'sorted by revenue');
  void as;
});

test('a renamed channel keeps its history under the new name', () => {
  const { as, grab, fried, sell, summary } = setup();
  sell(grab.id, fried.id, 1);
  const g = as('bootstrap', {}).channels.find((c) => c.id === grab.id);
  as('channels.save', { item: Object.assign({}, g, { name: 'Grab Food' }) });
  assert.equal(summary().byChannel.find((b) => b.channelId === grab.id).name, 'Grab Food');
});

test('a turned-off channel still shows its sales in reports and analysis', () => {
  const { as, grab, fried, sell, summary } = setup();
  sell(grab.id, fried.id, 3);
  const g = as('bootstrap', {}).channels.find((c) => c.id === grab.id);
  as('channels.save', { item: Object.assign({}, g, { active: false }) });
  assert.equal(summary().byChannel.find((b) => b.channelId === grab.id).qty, 3);
  const a = as('menu.analysis', { from: '2026-11-01', to: TODAY, channelId: grab.id });
  assert.equal(a.items.length, 1);
  assert.equal(a.items[0].qty, 3);
});

test('menu.analysis classifies dishes and flags a short period as indicative', () => {
  const { as, dine, grab, fried, prawnDish, sell } = setup();
  sell(dine.id, fried.id, 10);
  sell(grab.id, prawnDish.id, 2);
  const a = as('menu.analysis', { from: TODAY, to: TODAY });
  assert.equal(a.days, 1);
  assert.equal(a.dishesSold, 12);
  assert.equal(a.indicative, true);
  assert.equal(a.items.length, 2);
  a.items.forEach((i) => assert.ok(['star', 'plowhorse', 'puzzle', 'dog'].indexOf(i.cls) >= 0));
  const f = a.items.find((i) => i.menuItemId === fried.id);
  assert.equal(f.qty, 10);
  assert.equal(f.revenue, 1000);
  assert.equal(f.cost, 80);
  assert.equal(f.cm, 920);
  assert.equal(f.cmPerDish, 92);
  assert.equal(f.foodCostPct, 8);
  const p = a.items.find((i) => i.menuItemId === prawnDish.id);
  assert.equal(p.commission, 60);
  assert.equal(p.overTarget, true);
  assert.equal(a.items[0].cls === 'star' || a.items[0].cls === 'plowhorse', true, 'sorted by class');
});

test('menu.analysis with no sales', () => {
  const { as } = setup();
  const a = as('menu.analysis', { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(a.items, []);
  assert.equal(a.avgCm, 0);
  assert.equal(a.indicative, true);
  assert.equal(a.days, 31);
});

test('menu.analysis leaves out promotion sales unless asked', () => {
  const { as, db, dine, fried, sell } = setup();
  sell(dine.id, fried.id, 1);
  db.append('Sales', [{ id: 'SAL-PROMO001', date: TODAY, menuItemId: fried.id, itemName: 'Fried rice', qty: 5, unitPrice: 80,
    total: 400, unitCost: 8, costTotal: 40, channel: 'Dine-in', channelId: dine.id, commission: 0, promoId: 'PRM-X',
    note: '', voided: false, createdAt: TODAY + 'T02:00:00Z', createdBy: 'owner' }]);
  assert.equal(as('menu.analysis', { from: TODAY, to: TODAY }).items[0].qty, 1);
  assert.equal(as('menu.analysis', { from: TODAY, to: TODAY, includePromo: true }).items[0].qty, 6);
});

test('needs attention lists dishes losing margin on a channel', () => {
  const { dine, grab, fried, prawnDish, sell, summary } = setup();
  sell(grab.id, prawnDish.id, 3, '2026-11-01');
  sell(dine.id, fried.id, 5);
  sell(grab.id, fried.id, 5);
  const att = summary().attention;
  assert.equal(att.length, 1, JSON.stringify(att));
  const a = att[0];
  assert.equal(a.menuItemId, prawnDish.id);
  assert.equal(a.channelId, grab.id);
  assert.equal(a.channelName, 'Grab');
  assert.equal(a.price, 100);
  assert.equal(a.suggested, 215);
  assert.equal(a.qty28, 3);
  assert.equal(a.lostMargin, 345);
  assert.equal(a.foodCostPctNet, 57.1);
});

test('menu.analysis is for managers and needs dates', () => {
  const { as, asStaff } = setup();
  assert.throws(() => asStaff('menu.analysis', { from: TODAY, to: TODAY }), (e) => e.code === 'FORBIDDEN');
  assert.throws(() => as('menu.analysis', { from: '', to: TODAY }), (e) => e.code === 'VALIDATION');
});
