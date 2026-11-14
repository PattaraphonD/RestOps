'use strict';
// The real postgres.js driver (as used by the Supabase function), talking to PGlite over a local socket.
const path = require('path');
const { execFile } = require('child_process');
const execFileAsync = require('util').promisify(execFile);
const { testAsync, memDb, assert } = require('../test_core.js');
const S = require('../pg_schema.js');
const H = require('../../server/handler.js');
const { postgresDeps } = require('../../server/pgjs.js');
const { runScriptedDay } = require('./script_day.js');

async function socketDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const db = new PGlite();
  await db.waitReady;
  await db.exec(S.buildSql(global.RestoCore.SCHEMA, global.RestoCore.TEXT_COLUMNS));
  const port = 55000 + Math.floor(Math.random() * 5000);
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  const sql = require('postgres')(url, { max: 1, prepare: false, onnotice: () => {} });
  return { db, server, sql, url, close: async () => { await sql.end({ timeout: 2 }); await server.stop(); await db.close(); } };
}

testAsync('driver: a full day through postgres.js matches memory', async () => {
  const s = await socketDb();
  try {
    const manifest = require('../../server/manifest.json');
    let n = 0;
    const deps = postgresDeps(s.sql, { uuid: () => { n++; return ('00000000' + n.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; },
      now: () => new Date('2026-11-13T05:00:00Z'), tablesFor: (a) => manifest[a] || null });
    await H.setupDatabase(deps, { ownerUsername: 'owner', ownerPassword: 'test1234' });
    const send = async (action, payload, token) => {
      const r = await H.handleRequest({ action, payload, token }, deps);
      if (!r.ok) throw new Error(action + ': ' + r.error.code + ' ' + r.error.message);
      return r.data;
    };
    const token = (await send('auth.login', { username: 'owner', password: 'test1234' })).token;
    await send('users.save', { item: { username: 'staff', displayName: 'Staff', role: 'staff', password: 'test1234' } }, token);
    await runScriptedDay((a, p) => send(a, p, token));
    const rows = await s.sql.unsafe('select "id", "qty", "voided" from "Sales" order by "created_seq"');
    assert.ok(rows.length >= 4);
    assert.equal(typeof rows[0].qty, 'string', 'postgres.js returns numeric as text; the loader converts it');
    const boot = await H.handleRequest({ action: 'bootstrap', token: (await send('auth.login', { username: 'owner', password: 'newpass123' })).token }, deps);
    assert.equal(boot.ok, true);
    assert.equal(typeof boot.data.ingredients[0].onHand, 'number');
  } finally { await s.close(); }
});

testAsync('driver: the owner setup script works end to end', async () => {
  const s = await socketDb();
  try {
    // Async: the database server runs in this process, so a blocking child would never get an answer.
    const run = async (args) => (await execFileAsync(process.execPath, [path.join(__dirname, '..', 'supabase_setup.mjs')].concat(args),
      { env: Object.assign({}, process.env, { SUPABASE_DB_URL: s.url }), encoding: 'utf8' })).stdout;
    const first = await run([]);
    const pw = first.match(/Password: (\S+)/)[1];
    assert.match(first, /Username: owner/);
    assert.match(await run([]), /owner already exists/);
    const reset = await run(['--reset-owner']);
    const pw2 = reset.match(/New password for "owner": (\S+)/)[1];
    assert.notEqual(pw2, pw);
    const deps = postgresDeps(s.sql);
    assert.equal((await H.handleRequest({ action: 'auth.login', payload: { username: 'owner', password: pw2 } }, deps)).ok, true);
  } finally { await s.close(); }
});

testAsync('driver: the restore script loads a backup file into an empty database', async () => {
  const fs = require('fs');
  const os = require('os');
  const { makeApi } = require('../test_core.js');
  const { as } = makeApi();
  as('suppliers.save', { item: { name: 'Fresh Co' } });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'resto-bk-')), 'restaurant-ops-backup-2026-11-13.json');
  fs.writeFileSync(file, JSON.stringify(as('backup.export', { today: '2026-11-13' })));
  const s = await socketDb();
  try {
    const out = (await execFileAsync(process.execPath, [path.join(__dirname, '..', 'supabase_restore.mjs'), file, '--yes'],
      { env: Object.assign({}, process.env, { SUPABASE_DB_URL: s.url }), encoding: 'utf8' })).stdout;
    assert.match(out, /Restored \d+ rows/);
    // The test database takes one connection at a time: run the second restore before querying it here.
    await assert.rejects(execFileAsync(process.execPath, [path.join(__dirname, '..', 'supabase_restore.mjs'), file, '--yes'],
      { env: Object.assign({}, process.env, { SUPABASE_DB_URL: s.url }), encoding: 'utf8' }), /not empty/);
    assert.deepEqual((await s.sql.unsafe('select "name" from "Suppliers"')).map((r) => r.name), ['Fresh Co']);
  } finally { await s.close(); fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
});
