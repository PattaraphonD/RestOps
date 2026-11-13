'use strict';
// Fixes from the Layer 2 whole-branch review.
const { makeApi, test, assert } = require('../test_core.js');
const P = global.RestoPricing || require('../../app/js/pricing.js');

function base() {
  const api = makeApi();
  const { as } = api;
  const ch = as('bootstrap', {}).channels;
  const grab = as('channels.save', { item: { name: 'Grab', type: 'delivery', commissionPct: 30, packagingCost: 5 } });
  const lm = as('channels.save', { item: { name: 'LINE MAN', type: 'delivery', commissionPct: 30, packagingCost: 5 } });
  const rice = as('ingredients.save', { item: { name: 'Rice', unit: 'kg', costPerUnit: 40, minLevel: 0 } });
  const dish = as('menu.save', { item: { name: 'Fried rice', price: 100 }, recipe: [{ ingredientId: rice.id, qty: 0.2, unit: 'kg' }],
    prices: [{ channelId: grab.id, price: 120 }, { channelId: lm.id, price: 125 }] });
  return Object.assign(api, { ch, grab, lm, rice, dish });
}

test('saving a dish keeps its price on a turned-off channel', () => {
  const { as, grab, lm, dish } = base();
  const l = as('bootstrap', {}).channels.find((c) => c.id === lm.id);
  as('channels.save', { item: Object.assign({}, l, { active: false }) });
  // The editor only lists active channels, so only Grab is sent.
  as('menu.save', { item: { id: dish.id, version: dish.version, name: 'Fried rice', price: 100 }, prices: [{ channelId: grab.id, price: 130 }] });
  const prices = as('bootstrap', {}).menu.find((m) => m.id === dish.id).prices;
  assert.equal(prices[grab.id], 130);
  assert.equal(prices[lm.id], 125, 'LINE MAN price survives');
});

test('channel migration inside a write does not nest the write lock', () => {
  const { as, db } = makeApi();
  let depth = 0;
  db.lock = (fn) => {
    if (depth) throw new Error('nested lock');
    depth++;
    try { return fn(); } finally { depth--; }
  };
  const rice = as('ingredients.save', { item: { name: 'Rice', unit: 'kg', costPerUnit: 40, minLevel: 0 } });
  const dish = as('menu.save', { item: { name: 'Fried rice', price: 100 }, recipe: [{ ingredientId: rice.id, qty: 0.2, unit: 'kg' }] });
  // No bootstrap yet: the Channels tab is still empty, so this write has to migrate it.
  as('sales.add', { date: '2026-11-13', lines: [{ menuItemId: dish.id, qty: 1 }] });
  assert.equal(as('bootstrap', {}).channels.length, 3);
});

test('packaging counts toward meeting the target, matching the suggested price', () => {
  const e = P.channelEconomics({ price: 100, foodCost: 25, packaging: 10, commissionPct: 0, targetPct: 30, rounding: '5' });
  assert.equal(e.foodCostPctNet, 25, 'display stays food cost only');
  assert.equal(e.meetsTarget, false, '(25 + 10) / 100 = 35 % is above 30 %');
  assert.equal(e.suggested, 120);
  const ok = P.channelEconomics({ price: 120, foodCost: 25, packaging: 10, commissionPct: 0, targetPct: 30, rounding: '5' });
  assert.equal(ok.meetsTarget, true);
});

test('sales channel conflict and not-found messages translate fully to Thai', () => {
  [
    'Sales channel "Grab" was changed by owner while you were editing. Your changes were not saved — reload to see the latest version.',
    'Sales channel "Grab" not found. It may have been removed — reload and try again.',
    'Sales channel not found. It may have been removed — reload and try again.',
  ].forEach((m) => {
    const out = RestoCore.translate(m, 'th');
    const left = out.replace(/Grab|owner/g, '').replace(/[^A-Za-z]+/g, ' ').trim();
    assert.strictEqual(left, '', m + ' -> ' + out);
  });
});
