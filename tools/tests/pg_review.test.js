'use strict';
// Final-review fixes for the Supabase server.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, testAsync, pglite, assert } = require('../test_core.js');
const S = require('../pg_schema.js');
const H = require('../../server/handler.js');

/** A migrated PGlite whose queries are logged in order. */
async function logged() {
  const pg = await pglite();
  await pg.db.exec(S.buildSql(global.RestoCore.SCHEMA, global.RestoCore.TEXT_COLUMNS));
  const log = [];
  const deps = {
    transaction: (fn) => pg.transaction((query) => fn((t, p) => { log.push(t); return query(t, p); })),
    uuid: () => require('crypto').randomUUID(), now: () => new Date(),
  };
  await H.setupDatabase(deps, { ownerUsername: 'owner', ownerPassword: 'test1234' });
  return { pg, log, deps };
}

testAsync('review: a read action that writes (first bootstrap creates channels) takes the save lock first', async () => {
  const { pg, log, deps } = await logged();
  const token = (await H.handleRequest({ action: 'auth.login', payload: { username: 'owner', password: 'test1234' } }, deps)).data.token;
  log.length = 0;
  const boot = await H.handleRequest({ action: 'bootstrap', token }, deps);
  assert.equal(boot.ok, true);
  assert.equal(boot.data.channels.length, 3);
  const lock = log.findIndex((t) => /pg_advisory_xact_lock/.test(t));
  const insert = log.findIndex((t) => /^insert into "Channels"/.test(t));
  assert.ok(insert >= 0, 'channels were created');
  assert.ok(lock >= 0 && lock < insert, 'the lock comes before the insert');
  assert.equal((await pg.query('select count(*)::int as n from "Channels"'))[0].n, 3);
  await pg.db.close();
});

testAsync('review: saves give up waiting for a stuck lock instead of hanging', async () => {
  const { pg, log, deps } = await logged();
  const token = (await H.handleRequest({ action: 'auth.login', payload: { username: 'owner', password: 'test1234' } }, deps)).data.token;
  log.length = 0;
  await H.handleRequest({ action: 'suppliers.save', payload: { item: { name: 'A' } }, token }, deps);
  const timeout = log.findIndex((t) => /set local lock_timeout/.test(t));
  const lock = log.findIndex((t) => /pg_advisory_xact_lock/.test(t));
  assert.ok(timeout >= 0 && timeout < lock, 'lock_timeout is set before taking the lock');
  assert.ok(log.some((t) => /set local statement_timeout/.test(t)));
  await pg.db.close();
});

testAsync('review: a database error is shown in Thai, without technical details', async () => {
  const { pg, deps } = await logged();
  const failing = Object.assign({}, deps, { transaction: () => Promise.reject(new Error('duplicate key value violates unique constraint "Suppliers_pkey"')) });
  const r = await H.handleRequest({ action: 'bootstrap', lang: 'th' }, failing);
  assert.equal(r.error.code, 'SERVER');
  assert.match(r.error.message, /[฀-๿]/);
  assert.doesNotMatch(r.error.message, /duplicate|Suppliers|constraint/);
  await pg.db.close();
});

testAsync('review: resetting the owner password also clears a sign-in lockout', async () => {
  const { pg, deps } = await logged();
  const login = (password) => H.handleRequest({ action: 'auth.login', payload: { username: 'owner', password } }, deps);
  for (let i = 0; i < 6; i++) await login('wrong');
  assert.equal((await login('test1234')).error.code, 'LOCKED');
  await H.resetOwnerPassword(deps, 'fresh789');
  assert.equal((await login('fresh789')).ok, true);
  await pg.db.close();
});

test('review: the schema tool adds a new migration instead of editing one that may be live', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resto-mig-'));
  fs.writeFileSync(path.join(dir, '20261114000000_init.sql'), '-- already applied');
  const tool = path.join(__dirname, '..', 'pg_schema.js');
  const run = (args = []) => execFileSync(process.execPath, [tool].concat(args), { env: Object.assign({}, process.env, { MIGRATIONS_DIR: dir }), encoding: 'utf8' });
  run();
  const files = () => fs.readdirSync(dir).sort();
  assert.equal(fs.readFileSync(path.join(dir, '20261114000000_init.sql'), 'utf8'), '-- already applied');
  assert.equal(files().length, 2, 'a new dated file');
  run();
  assert.equal(files().length, 2, 'nothing new when the schema did not change');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('review: the Supabase CLI is pinned, so the guide needs no download prompt', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.match(pkg.devDependencies.supabase || '', /^\d+\.\d+\.\d+$/);
});
