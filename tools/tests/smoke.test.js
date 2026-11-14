'use strict';
// Required via the runner; use the runner's module so tests share one registry.
const { makeApi, test, assert } = require('../test_core.js');

test('bootstrap returns version 1.3.0', () => {
  const { as } = makeApi();
  assert.equal(as('bootstrap').version, '2.0.5');
});

test('purchase of 2 kg gives onHand 2', () => {
  const { as } = makeApi();
  const ing = as('ingredients.save', { item: { name: 'Flour', category: 'Dry', unit: 'kg', costPerUnit: 100, minLevel: 1, parLevel: 5 } });
  as('purchases.add', { date: '2026-11-13', lines: [{ ingredientId: ing.id, qty: 2, unitCost: 100 }] });
  const lvl = as('stock.levels').filter((s) => s.id === ing.id)[0];
  assert.equal(lvl.onHand, 2);
});

test('every release changes index.html and the offline cache (so browsers pick up new security headers)', () => {
  const fs = require('fs');
  const path = require('path');
  const v = global.RestoCore.VERSION;
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
  assert.match(read('app/index.html'), new RegExp(`<meta name="app-version" content="${v.replace(/\./g, '\.')}">`), 'bump app-version in app/index.html');
  assert.match(read('app/sw.js'), new RegExp(`resto-ops-v${v.replace(/\./g, '\.')}'`), 'bump CACHE in app/sw.js');
});
