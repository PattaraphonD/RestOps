'use strict';
const { makeApi, test, assert } = require('../test_core.js');

function code(fn) { try { fn(); } catch (e) { return e.code + ': ' + e.message; } return 'OK'; }

/* ------------------------------------------------ Task 2: channels as records */

test('first bootstrap migrates the sales channel list into channel records', () => {
  const { as } = makeApi();
  const ch = as('bootstrap', {}).channels;
  assert.deepEqual(ch.map((c) => c.name), ['Dine-in', 'Takeaway', 'Delivery']);
  assert.deepEqual(ch.map((c) => c.type), ['dineIn', 'takeaway', 'delivery']);
  assert.ok(ch.every((c) => c.commissionPct === 0 && c.packagingCost === 0 && c.active && c.commissionOnDiscounted === true));
  assert.equal(as('bootstrap', {}).channels.length, 3, 'no duplicates on second bootstrap');
});

test('Thai channel names migrate with guessed types', () => {
  const { as } = makeApi();
  as('settings.save', { values: { salesChannels: 'ทานที่ร้าน, กลับบ้าน, เดลิเวอรี่' } });
  const ch = as('bootstrap', {}).channels;
  assert.deepEqual(ch.map((c) => c.type), ['dineIn', 'takeaway', 'delivery']);
});

test('channels.save creates and versions a delivery channel', () => {
  const { as } = makeApi();
  as('bootstrap', {});
  const g = as('channels.save', { item: { name: 'Grab', type: 'delivery', commissionPct: 30, packagingCost: 5, commissionOnDiscounted: true } });
  assert.equal(g.version, 1);
  const ch = as('bootstrap', {}).channels.find((c) => c.id === g.id);
  assert.equal(ch.commissionPct, 30);
  assert.equal(ch.packagingCost, 5);
  const g2 = as('channels.save', { item: { id: g.id, version: g.version, name: 'Grab', type: 'delivery', commissionPct: 32, packagingCost: 5 } });
  assert.equal(g2.version, 2);
});

test('channels.save validation', () => {
  const { as, asStaff } = makeApi();
  as('bootstrap', {});
  assert.match(code(() => as('channels.save', { item: { name: 'X', type: 'delivery', commissionPct: 100 } })), /^VALIDATION: Commission must be between 0 and 99\.9 %\./);
  assert.match(code(() => as('channels.save', { item: { name: 'X', type: 'boat', commissionPct: 0 } })), /^VALIDATION: Unknown channel type\./);
  assert.match(code(() => as('channels.save', { item: { name: 'Takeaway', type: 'takeaway', commissionPct: 0 } })), /^VALIDATION: .*already exists/);
  assert.match(code(() => as('channels.save', { item: { name: 'X', type: 'other', commissionPct: 0, packagingCost: -1 } })), /^VALIDATION: Packaging cost/);
  assert.match(code(() => asStaff('channels.save', { item: { name: 'X', type: 'other', commissionPct: 0 } })), /^FORBIDDEN/);
});

test('the last active channel cannot be turned off', () => {
  const { as } = makeApi();
  const ch = as('bootstrap', {}).channels;
  as('channels.save', { item: Object.assign({}, ch[0], { active: false }) });
  as('channels.save', { item: Object.assign({}, ch[1], { active: false }) });
  assert.match(code(() => as('channels.save', { item: Object.assign({}, ch[2], { active: false }) })), /Keep at least one active sales channel\./);
});

test('priceRounding setting is validated', () => {
  const { as } = makeApi();
  assert.equal(as('settings.save', { values: { priceRounding: '9-ending' } }).priceRounding, '9-ending');
  assert.equal(as('settings.save', { values: { priceRounding: '' } }).priceRounding, '');
  assert.match(code(() => as('settings.save', { values: { priceRounding: '7' } })), /Unknown price rounding\./);
});

test('channel messages translate fully to Thai', () => {
  [
    'Commission must be between 0 and 99.9 %.',
    'Unknown channel type.',
    'Keep at least one active sales channel.',
    'Unknown price rounding.',
    'Packaging cost must be at least 0.',
    'Sales channel "Grab" already exists.',
  ].forEach((m) => {
    const out = RestoCore.translate(m, 'th');
    const stripped = out.replace(/Grab/g, '').replace(/[^A-Za-z]+/g, ' ').trim();
    assert.strictEqual(stripped, '', m + ' -> ' + out);
  });
});

/* ------------------------------------------- Task 3: channel prices and commission */

function setup() {
  const api = makeApi();
  const { as } = api;
  const ch = as('bootstrap', {}).channels;
  const grab = as('channels.save', { item: { name: 'Grab', type: 'delivery', commissionPct: 30, packagingCost: 5 } });
  const rice = as('ingredients.save', { item: { name: 'Rice', unit: 'kg', costPerUnit: 40, minLevel: 0 } });
  const dish = as('menu.save', { item: { name: 'Fried rice', price: 100 }, recipe: [{ ingredientId: rice.id, qty: 0.2, unit: 'kg' }],
    prices: [{ channelId: grab.id, price: 120 }] });
  return Object.assign(api, { ch, grab, rice, dish, dine: ch[0], delivery: ch[2] });
}

test('menu.save stores and clears channel prices', () => {
  const { as, grab, dish } = setup();
  assert.equal(as('bootstrap', {}).menu.find((m) => m.id === dish.id).prices[grab.id], 120);
  as('menu.save', { item: { id: dish.id, version: dish.version, name: 'Fried rice', price: 100 }, recipe: [], prices: [{ channelId: grab.id, price: '' }] });
  assert.deepEqual(as('bootstrap', {}).menu.find((m) => m.id === dish.id).prices, {});
});

test('menu.save refuses an unknown channel', () => {
  const { as, dish } = setup();
  assert.match(code(() => as('menu.save', { item: { id: dish.id, version: dish.version, name: 'Fried rice', price: 100 },
    prices: [{ channelId: 'CHN-NOPE', price: 90 }] })), /^NOT_FOUND|^VALIDATION/);
});

test('a sale on a delivery channel stores its price and commission', () => {
  const { as, grab, dish } = setup();
  as('sales.add', { date: '2026-11-13', channelId: grab.id, lines: [{ menuItemId: dish.id, qty: 2 }] });
  const row = as('sales.list', { from: '2026-11-13', to: '2026-11-13' }).rows[0];
  assert.equal(row.unitPrice, 120);
  assert.equal(row.total, 240);
  assert.equal(row.listPrice, 120);
  assert.equal(row.commission, 72);
  assert.equal(row.channel, 'Grab');
  assert.equal(row.channelId, grab.id);
});

test('a blank channel price falls back to the menu price', () => {
  const { as, dine, dish } = setup();
  as('sales.add', { date: '2026-11-13', channelId: dine.id, lines: [{ menuItemId: dish.id, qty: 1 }] });
  const row = as('sales.list', { from: '2026-11-13', to: '2026-11-13' }).rows[0];
  assert.equal(row.unitPrice, 100);
  assert.equal(row.commission, 0);
});

test('commission base follows commissionOnDiscounted', () => {
  const { as, grab, dish } = setup();
  as('sales.add', { date: '2026-11-13', channelId: grab.id, lines: [{ menuItemId: dish.id, qty: 1, unitPrice: 100 }] });
  let row = as('sales.list', { from: '2026-11-13', to: '2026-11-13' }).rows[0];
  assert.equal(row.commission, 30, 'charged on the price actually received');
  const g = as('bootstrap', {}).channels.find((c) => c.id === grab.id);
  as('channels.save', { item: Object.assign({}, g, { commissionOnDiscounted: false }) });
  as('sales.add', { date: '2026-11-12', channelId: grab.id, lines: [{ menuItemId: dish.id, qty: 1, unitPrice: 100 }] });
  row = as('sales.list', { from: '2026-11-12', to: '2026-11-12' }).rows[0];
  assert.equal(row.commission, 36, 'charged on the list price');
});

test('legacy sales.add with a channel name resolves the channel', () => {
  const { as, delivery, dish } = setup();
  as('sales.add', { date: '2026-11-13', channel: 'Delivery', lines: [{ menuItemId: dish.id, qty: 1 }] });
  assert.equal(as('sales.list', { from: '2026-11-13', to: '2026-11-13' }).rows[0].channelId, delivery.id);
});

test('a turned-off channel cannot take sales', () => {
  const { as, grab, dish } = setup();
  const g = as('bootstrap', {}).channels.find((c) => c.id === grab.id);
  as('channels.save', { item: Object.assign({}, g, { active: false }) });
  assert.match(code(() => as('sales.add', { date: '2026-11-13', channelId: grab.id, lines: [{ menuItemId: dish.id, qty: 1 }] })),
    /This sales channel is turned off\./);
});

test('menu.applyPrices upserts prices for one channel', () => {
  const { as, asStaff, grab, rice, dish } = setup();
  const d2 = as('menu.save', { item: { name: 'Rice bowl', price: 50 }, recipe: [{ ingredientId: rice.id, qty: 0.1, unit: 'kg' }] });
  assert.equal(as('menu.applyPrices', { channelId: grab.id, items: [{ menuItemId: dish.id, price: 130 }, { menuItemId: d2.id, price: 65 }] }).count, 2);
  const menu = as('bootstrap', {}).menu;
  assert.equal(menu.find((m) => m.id === dish.id).prices[grab.id], 130);
  assert.equal(menu.find((m) => m.id === d2.id).prices[grab.id], 65);
  assert.match(code(() => as('menu.applyPrices', { channelId: grab.id, items: [{ menuItemId: dish.id, price: 0 }] })), /^VALIDATION/);
  assert.match(code(() => asStaff('menu.applyPrices', { channelId: grab.id, items: [] })), /^FORBIDDEN/);
});

test('turned-off channel message translates to Thai', () => {
  const out = RestoCore.translate('This sales channel is turned off.', 'th');
  assert.equal(out.replace(/[^A-Za-z]+/g, ' ').trim(), '', out);
});
