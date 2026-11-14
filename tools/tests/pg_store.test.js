'use strict';
const path = require('path');
const { test, testAsync, pglite, assert } = require('../test_core.js');
const S = require('../pg_schema.js');
const { memStore, memSessions } = require('../../server/store.js');
const Pg = require('../../server/pg.js');

const SCHEMA = global.RestoCore.SCHEMA;
const migrate = async () => {
  const pg = await pglite();
  await pg.db.exec(S.buildSql(SCHEMA, global.RestoCore.TEXT_COLUMNS));
  return pg;
};

test('store: records inserts, updates and removals', () => {
  const s = memStore({ Suppliers: [{ id: 'S1', name: 'A', version: 1 }] });
  s.append('Suppliers', [{ id: 'S2', name: 'B', version: 1 }]);
  assert.equal(s.updateWhere('Suppliers', (r) => r.id === 'S1', { name: 'B2' }), 1);
  assert.equal(s.removeWhere('Suppliers', (r) => r.id === 'S2'), 1);
  assert.deepEqual(s.changes(), { Suppliers: { inserted: [], updated: [{ id: 'S1', name: 'B2', version: 1 }], removed: [] } });
  assert.deepEqual(s.read('Suppliers'), [{ id: 'S1', name: 'B2', version: 1 }]);
});

test('store: an inserted row updated later is one insert with the final values', () => {
  const s = memStore({});
  s.append('Expenses', [{ id: 'E1', amount: 10 }]);
  s.updateWhere('Expenses', (r) => r.id === 'E1', { amount: 12 });
  s.append('Settings', [{ key: 'vatRate', value: '7' }]);
  s.removeWhere('Expenses', () => false);
  assert.deepEqual(s.changes(), {
    Expenses: { inserted: [{ id: 'E1', amount: 12 }], updated: [], removed: [] },
    Settings: { inserted: [{ key: 'vatRate', value: '7' }], updated: [], removed: [] },
  });
});

test('store: reads are copies, and a strict store refuses tables it did not load', () => {
  const s = memStore({ Users: [{ id: 'U1', name: 'x' }] }, { strict: true });
  s.read('Users')[0].name = 'changed';
  assert.equal(s.read('Users')[0].name, 'x');
  assert.throws(() => s.read('Sales'), (e) => e.code === 'TABLE_NOT_LOADED' && e.table === 'Sales');
});

test('sessions: expire, and report what changed', () => {
  let t = Date.parse('2026-11-14T00:00:00Z');
  const s = memSessions([{ key: 'old', value: 'U1', exp: t + 1000 }], () => new Date(t));
  assert.equal(s.get('old'), 'U1');
  s.put('s:abc', 'U2', 60);
  s.remove('old');
  t += 5000;
  assert.equal(s.get('old'), null);
  assert.equal(s.get('s:abc'), 'U2');
  const c = s.changes();
  assert.deepEqual(c.removed, ['old']);
  assert.equal(c.upserts[0].key, 's:abc');
  assert.equal(c.upserts[0].expires_at, new Date(Date.parse('2026-11-14T00:00:00Z') + 60000).toISOString());
});

testAsync('pg: round trip keeps numbers, booleans and blank cells', async () => {
  const { db, query } = await migrate();
  const s = memStore({});
  s.append('Ingredients', [{ id: 'I1', name: 'Rice', costPerUnit: 30, minLevel: 0, parLevel: '', active: true, version: 1, code: '', kind: 'raw' }]);
  s.append('Settings', [{ key: 'targetFoodCostPct', value: '30' }]);
  s.append('StockMovements', [{ id: 'M1', date: '2026-11-13', ingredientId: 'I1', type: 'waste', qty: -1.5, value: -45, voided: false }]);
  await Pg.flush(query, s.changes());
  const snap = await Pg.snapshot(query, ['Ingredients', 'Settings', 'StockMovements']);
  const i = snap.Ingredients[0];
  assert.equal(i.costPerUnit, 30);
  assert.equal(i.minLevel, 0);
  assert.equal(i.parLevel, '');
  assert.equal(i.active, true);
  assert.equal(i.code, '');
  assert.equal(i.yieldPct, '');
  assert.equal(snap.Settings[0].value, '30');
  assert.equal(snap.StockMovements[0].qty, -1.5);
  assert.equal(snap.StockMovements[0].value, -45);
  assert.equal(snap.StockMovements[0].voided, false);
  assert.deepEqual(Object.keys(i), SCHEMA.Ingredients);
  await db.close();
});

testAsync('pg: rows come back in the order they were written; updates and removals land', async () => {
  const { db, query } = await migrate();
  const s = memStore({});
  s.append('Sales', ['c', 'a', 'b'].map((id) => ({ id, date: '2026-11-13', qty: 1, total: 10 })));
  await Pg.flush(query, s.changes());
  const s2 = memStore(await Pg.snapshot(query, ['Sales']));
  assert.deepEqual(s2.read('Sales').map((r) => r.id), ['c', 'a', 'b']);
  s2.updateWhere('Sales', (r) => r.id === 'a', { voided: true });
  s2.removeWhere('Sales', (r) => r.id === 'b');
  await Pg.flush(query, s2.changes());
  const snap = await Pg.snapshot(query, ['Sales']);
  assert.deepEqual(snap.Sales.map((r) => [r.id, r.voided]), [['c', ''], ['a', true]]);
  await db.close();
});

testAsync('pg: sessions load unexpired only, and expired rows are purged', async () => {
  const { db, query } = await migrate();
  const t0 = new Date('2026-11-14T00:00:00Z');
  const s = memSessions([], () => t0);
  s.put('short', 'U1', 1);
  s.put('long', 'U2', 3600);
  await Pg.flushSessions(query, s.changes(), t0);
  const later = new Date(t0.getTime() + 2000);
  const rows = await Pg.loadSessions(query, later);
  assert.deepEqual(rows.map((r) => r.key), ['long']);
  await Pg.flushSessions(query, memSessions(rows, () => later).changes(), later);
  assert.equal((await query('select count(*)::int as n from "sessions"'))[0].n, 1);
  await db.close();
});

test('core: actionInfo says which actions save', () => {
  const { makeApi } = require('../test_core.js');
  const { api } = makeApi();
  assert.deepEqual(api.actionInfo('sales.add'), { write: true, role: 'staff' });
  assert.equal(api.actionInfo('reports.summary').write, false);
  assert.deepEqual(api.actionInfo('auth.login'), { write: true, role: 'staff' });
  assert.equal(api.actionInfo('nope'), null);
});
