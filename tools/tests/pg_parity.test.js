'use strict';
const { memDb, testAsync, pglite, assert } = require('../test_core.js');
const S = require('../pg_schema.js');
const H = require('../../server/handler.js');
const Types = require('../../server/types.js');
const { runScriptedDay } = require('./script_day.js');

const SCHEMA = global.RestoCore.SCHEMA;
const NOW = new Date('2026-11-13T05:00:00Z');
// The same id sequence makeApi() uses, continuing after its owner + staff setup.
const ids = () => { let n = 0; return () => { n++; return ('00000000' + n.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; }; };

/** Rows as a spreadsheet would hold them: typed columns as numbers/booleans, blanks as ''. */
function normalize(table, rows) {
  const key = Types.keyOf(table);
  return rows.map((r) => {
    const o = {};
    SCHEMA[table].forEach((c) => {
      const t = Types.typeOf(table, c), v = r[c];
      if (v === undefined || v === null || v === '') o[c] = '';
      else if (t === 'numeric') o[c] = Number(v);
      else if (t === 'boolean') o[c] = v === true || v === 'TRUE' || v === 'true';
      else o[c] = String(v);
    });
    return o;
  }).sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

testAsync('parity: memory and Postgres end the day identically', async () => {
  // 1. In memory (the store the demo and the tests use), through the same API calls as step 2.
  const memdb = memDb();
  const memApi = global.RestoCore.createApi({ db: memdb, sessions: memdb.sessions, uuid: ids(), now: () => NOW });
  memApi.initialize({ ownerUsername: 'owner', ownerPassword: 'test1234' });
  const memSend = (action, payload, token) => {
    const r = memApi.handle({ action, payload, token });
    if (!r.ok) throw new Error(action + ': ' + r.error.code + ' ' + r.error.message);
    return r.data;
  };
  const memToken = memSend('auth.login', { username: 'owner', password: 'test1234' }).token;
  memSend('users.save', { item: { username: 'staff', displayName: 'Staff', role: 'staff', password: 'test1234' } }, memToken);
  await runScriptedDay((a, p) => memSend(a, p, memToken));

  // 2. On Postgres, through the server's request handler, with the same ids and clock.
  const pg = await pglite();
  await pg.db.exec(S.buildSql(SCHEMA, global.RestoCore.TEXT_COLUMNS));
  // As in production: each action loads only the tables in server/manifest.json.
  const manifest = require('../../server/manifest.json');
  const deps = { transaction: pg.transaction, uuid: ids(), now: () => NOW, tablesFor: (action) => manifest[action] || null,
    onFallback: (action, msg) => fallbacks.push(action + ': ' + msg) };
  const fallbacks = [];
  await H.setupDatabase(deps, { ownerUsername: 'owner', ownerPassword: 'test1234' });
  const send = async (action, payload, token) => {
    const r = await H.handleRequest({ action, payload, token }, deps);
    if (!r.ok) throw new Error(action + ': ' + r.error.code + ' ' + r.error.message);
    return r.data;
  };
  const token = (await send('auth.login', { username: 'owner', password: 'test1234' })).token;
  await send('users.save', { item: { username: 'staff', displayName: 'Staff', role: 'staff', password: 'test1234' } }, token);
  await runScriptedDay((a, p) => send(a, p, token));

  // The day really happened (so the comparison below isn't of empty tables).
  const n = (t) => memdb.read(t).length;
  assert.ok(n('Sales') >= 4 && n('Purchases') >= 3 && n('StockMovements') >= 10, 'sales, purchases and movements recorded');
  ['SupplierInvoices', 'ProductionRuns', 'Promotions', 'DayCloses', 'Expenses', 'MenuPrices'].forEach((t) => assert.ok(n(t) >= 1, t));

  assert.deepEqual(fallbacks, [], 'the manifest covered every action of the day');

  // 3. Every table matches (sessions aside: tokens are random by design).
  for (const table of Object.keys(SCHEMA)) {
    const fromPg = await pg.query(`select * from "${table}"`);
    const a = normalize(table, memdb.read(table));
    const b = normalize(table, fromPg);
    assert.equal(b.length, a.length, `${table}: row count`);
    assert.deepEqual(b, a, `${table}: rows`);
  }
  await pg.db.close();
});
