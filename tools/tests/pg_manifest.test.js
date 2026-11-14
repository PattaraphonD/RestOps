'use strict';
const fs = require('fs');
const path = require('path');
const { test, testAsync, pglite, assert } = require('../test_core.js');
const S = require('../pg_schema.js');
const H = require('../../server/handler.js');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'manifest.json'), 'utf8'));
const coreSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'js', 'core.js'), 'utf8');
const actions = [...coreSrc.matchAll(/A\['([a-zA-Z.]+)'\] = \{/g)].map((m) => m[1]);

test('manifest: covers every action', () => {
  assert.ok(actions.length >= 50, 'found the action table');
  const missing = actions.filter((a) => !manifest[a]);
  assert.deepEqual(missing, [], 'run node tools/trace_tables.js');
  assert.ok(manifest['auth.login'], 'sign-in is listed');
});

test('manifest: lists real tables, and the report reads what it needs', () => {
  const tables = Object.keys(global.RestoCore.SCHEMA);
  Object.entries(manifest).forEach(([a, list]) => list.forEach((t) => assert.ok(tables.includes(t), `${a}: ${t}`)));
  ['Sales', 'Purchases', 'Expenses', 'StockMovements', 'Users', 'Settings'].forEach((t) => assert.ok(manifest['reports.summary'].includes(t), t));
  assert.ok(manifest['day.status'].length < 5, 'a simple read loads only a few tables');
});

testAsync('manifest: an incomplete table list falls back to every table', async () => {
  const pg = await pglite();
  await pg.db.exec(S.buildSql(global.RestoCore.SCHEMA, global.RestoCore.TEXT_COLUMNS));
  const deps = { transaction: pg.transaction, uuid: () => require('crypto').randomUUID(), now: () => new Date(),
    tablesFor: (a) => (a === 'bootstrap' ? ['Users'] : manifest[a] || null), onFallback: (a) => fell.push(a) };
  const fell = [];
  await H.setupDatabase(deps, { ownerUsername: 'owner', ownerPassword: 'test1234' });
  const login = await H.handleRequest({ action: 'auth.login', payload: { username: 'owner', password: 'test1234' } }, deps);
  assert.equal(login.ok, true);
  const boot = await H.handleRequest({ action: 'bootstrap', token: login.data.token }, deps);
  assert.equal(boot.ok, true);
  assert.ok(boot.data.settings.restaurantName);
  assert.deepEqual(fell, ['bootstrap']);
  await pg.db.close();
});
