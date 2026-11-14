'use strict';
const { testAsync, pglite, assert } = require('../test_core.js');
const S = require('../pg_schema.js');
const H = require('../../server/handler.js');

const SCHEMA = global.RestoCore.SCHEMA;
const NOW = new Date('2026-11-13T05:00:00Z');

/** A migrated PGlite database with an owner (password test1234) and handler deps. */
async function server(opts = {}) {
  const pg = await pglite();
  await pg.db.exec(S.buildSql(SCHEMA, global.RestoCore.TEXT_COLUMNS));
  let n = 0;
  const deps = {
    transaction: opts.transaction ? opts.transaction(pg) : pg.transaction,
    uuid: () => { n++; return ('00000000' + n.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; },
    now: () => NOW,
  };
  await H.setupDatabase(deps, { ownerUsername: 'owner', ownerPassword: 'test1234', lang: 'th' });
  const call = (action, payload, extra) => H.handleRequest(Object.assign({ action, payload }, extra || {}), deps);
  const login = async () => (await call('auth.login', { username: 'owner', password: 'test1234' })).data.token;
  const count = async (table) => (await pg.query(`select count(*)::int as n from "${table}"`))[0].n;
  return Object.assign(pg, { deps, call, login, count });
}

testAsync('handler: sign in and read', async () => {
  const s = await server();
  const login = await s.call('auth.login', { username: 'owner', password: 'test1234' });
  assert.equal(login.ok, true);
  const boot = await s.call('bootstrap', {}, { token: login.data.token });
  assert.equal(boot.ok, true);
  assert.ok(boot.data.settings.restaurantName);
  const wrong = await s.call('auth.login', { username: 'owner', password: 'nope' });
  assert.equal(wrong.error.code, 'AUTH');
  await s.db.close();
});

testAsync('handler: a save persists', async () => {
  const s = await server();
  const token = await s.login();
  const r = await s.call('suppliers.save', { item: { name: 'Fresh Co' } }, { token });
  assert.equal(r.ok, true);
  const rows = await s.query('select "id", "name", "version" from "Suppliers"');
  assert.deepEqual(rows.map((x) => [x.id, x.name, Number(x.version)]), [[r.data.id, 'Fresh Co', 1]]);
  await s.db.close();
});

testAsync('handler: a failed save writes nothing', async () => {
  const s = await server();
  const token = await s.login();
  const before = [await s.count('Purchases'), await s.count('StockMovements')];
  const r = await s.call('po.receive', { poId: 'PO-NOPE', lines: [] }, { token });
  assert.equal(r.ok, false);
  assert.deepEqual([await s.count('Purchases'), await s.count('StockMovements')], before);
  await s.db.close();
});

testAsync('handler: a database error part-way through saves nothing', async () => {
  // Fail the second table write of a purchase order (its lines) after the header was written.
  const s = await server({
    transaction: (pg) => (fn) => pg.transaction((query) => fn((t, p) => {
      if (/^insert into "PurchaseOrderLines"/.test(t)) return Promise.reject(new Error('disk full'));
      return query(t, p);
    })),
  });
  const token = await s.login();
  const sup = await s.call('suppliers.save', { item: { name: 'Fresh Co' } }, { token });
  const ing = await s.call('ingredients.save', { item: { name: 'Rice', unit: 'kg', costPerUnit: 30, minLevel: 1, supplierId: sup.data.id } }, { token });
  const r = await s.call('po.save', { item: { supplierId: sup.data.id, orderDate: '2026-11-13' }, lines: [{ ingredientId: ing.data.id, qtyOrdered: 5, unitPrice: 30 }] }, { token });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'SERVER');
  assert.equal(await s.count('PurchaseOrders'), 0);
  await s.db.close();
});

testAsync('handler: a retry with the same requestId saves once', async () => {
  const s = await server();
  const token = await s.login();
  const body = { date: '2026-11-13', category: 'Gas', amount: 200 };
  const a = await s.call('expenses.add', body, { token, requestId: 'r1' });
  const b = await s.call('expenses.add', body, { token, requestId: 'r1' });
  assert.equal(a.ok, true);
  assert.deepEqual(b, a);
  assert.equal(await s.count('Expenses'), 1);
  await s.db.close();
});

testAsync('handler: two saves at the same time both land', async () => {
  const s = await server();
  const token = await s.login();
  await Promise.all(['A', 'B'].map((name) => s.call('suppliers.save', { item: { name } }, { token })));
  const names = (await s.query('select "name" from "Suppliers" order by "name"')).map((r) => r.name);
  assert.deepEqual(names, ['A', 'B']);
  await s.db.close();
});

testAsync('handler: an expired session is refused and purged', async () => {
  const s = await server();
  await s.query(`insert into "sessions" ("key", "value", "expires_at") values ('s:old', 'USR-X', '2026-11-12T00:00:00Z')`);
  const r = await s.call('bootstrap', {}, { token: 'old' });
  assert.equal(r.error.code, 'AUTH');
  assert.equal((await s.query(`select count(*)::int as n from "sessions" where "key" = 's:old'`))[0].n, 0);
  await s.db.close();
});

testAsync('handler: errors come back in Thai', async () => {
  const s = await server();
  const token = await s.login();
  const r = await s.call('suppliers.save', { item: { name: '' } }, { token, lang: 'th' });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /[฀-๿]/);
  await s.db.close();
});

testAsync('handler: setup is safe to run twice', async () => {
  const s = await server();
  const again = await H.setupDatabase(s.deps, { ownerUsername: 'owner', ownerPassword: 'other', lang: 'th' });
  assert.equal(again.ownerCreated, null);
  assert.equal(await s.count('Users'), 1);
  const keys = (await s.query('select "key" from "Settings"')).map((r) => r.key);
  assert.ok(keys.includes('targetFoodCostPct') && keys.includes('foodBudget'));
  await s.db.close();
});
