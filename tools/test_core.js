'use strict';
// Dependency-free test runner for app/js/core.js (and costing.js when present).
// Usage: node tools/test_core.js
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const costingPath = path.join(__dirname, '..', 'app', 'js', 'costing.js');
if (fs.existsSync(costingPath)) global.RestoCosting = require(costingPath);
const pricingPath = path.join(__dirname, '..', 'app', 'js', 'pricing.js');
if (fs.existsSync(pricingPath)) global.RestoPricing = require(pricingPath);
global.RestoCore = require('../app/js/core.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
// Async tests (Postgres via PGlite) run after the synchronous ones, one at a time.
const asyncTests = [];
function testAsync(name, fn) { asyncTests.push({ name, fn }); }
let pgliteOk = null;
/** True when the dev-only PGlite package is installed (npm install). */
function hasPglite() {
  if (pgliteOk === null) { try { require.resolve('@electric-sql/pglite'); pgliteOk = true; } catch { pgliteOk = false; } }
  return pgliteOk;
}
/** A fresh in-memory Postgres; query(text, params) -> rows. */
async function pglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.waitReady;
  const query = (t, p) => db.query(t, p || []).then((r) => r.rows);
  const transaction = (fn) => db.transaction((tx) => fn((t, p) => tx.query(t, p || []).then((r) => r.rows)));
  return { db, query, transaction };
}

function memDb() {
  const data = { tables: {}, sessions: {} };
  const tbl = (n) => (data.tables[n] = data.tables[n] || []);
  return {
    data,
    read: (n) => tbl(n).map((r) => Object.assign({}, r)),
    append(n, rows) { rows.forEach((r) => tbl(n).push(Object.assign({}, r))); },
    updateWhere(n, pred, patch) {
      let c = 0;
      tbl(n).forEach((r) => { if (pred(Object.assign({}, r))) { Object.assign(r, patch); c++; } });
      return c;
    },
    removeWhere(n, pred) {
      const before = tbl(n).length;
      data.tables[n] = tbl(n).filter((r) => !pred(Object.assign({}, r)));
      return before - data.tables[n].length;
    },
    lock: (fn) => fn(),
    sessions: {
      get(k) { const s = data.sessions[k]; return s && s.exp > Date.now() ? s.v : null; },
      put(k, v, ttl) { data.sessions[k] = { v: String(v), exp: Date.now() + ttl * 1000 }; },
      remove(k) { delete data.sessions[k]; },
    },
  };
}

/** RESTO_STORE=mem runs the whole suite on the server's change-log store instead of memDb. */
function storeDb() {
  const { memStore } = require('../server/store.js');
  return Object.assign(memStore({}), { sessions: memDb().sessions });
}

function makeApi() {
  const db = process.env.RESTO_STORE === 'mem' ? storeDb() : memDb();
  let n = 0;
  // Counter sits in the first 10 hex chars, which is what newId() keeps.
  const uuid = () => { n++; return ('00000000' + n.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; };
  const api = RestoCore.createApi({ db, sessions: db.sessions, uuid, now: () => new Date('2026-11-13T05:00:00Z') });
  api.initialize({ ownerUsername: 'owner', ownerPassword: 'test1234' });
  const owner = db.read('Users').filter((u) => u.role === 'owner')[0];
  const run = (user) => (action, payload) => {
    const res = api.runAs(user, action, payload || {});
    return res;
  };
  const as = run(owner);
  as('users.save', { item: { username: 'staff', displayName: 'Staff', role: 'staff', password: 'test1234' } });
  const staff = db.read('Users').filter((u) => u.username === 'staff')[0];
  return { api, db, owner, as, asStaff: run(staff) };
}

/** Loads every tests/*.test.js and runs them (sync first, then async). quiet: only failures are printed; skip: RegExp of test names to leave out. */
async function runAll(opts = {}) {
  const dir = path.join(__dirname, 'tests');
  fs.readdirSync(dir).filter((f) => /\.test\.js$/.test(f)).sort().forEach((f) => require(path.join(dir, f)));
  let passed = 0, failed = 0;
  const report = (t, e) => {
    if (!e) { passed++; if (!opts.quiet) console.log('  ok   ' + t.name); return; }
    failed++;
    const msg = e && e.code && e.message && !e.stack ? e.code + ': ' + e.message : (e && e.stack) || String(e);
    console.log('  FAIL ' + t.name + '\n       ' + msg.split('\n').join('\n       '));
  };
  const keep = (t) => !(opts.skip && opts.skip.test(t.name));
  tests.filter(keep).forEach((t) => { try { t.fn(); report(t); } catch (e) { report(t, e); } });
  if (asyncTests.length && !hasPglite()) console.log('  skip ' + asyncTests.length + ' Postgres tests (run npm install to enable them)');
  else {
    for (const t of asyncTests.filter(keep)) { try { await t.fn(); report(t); } catch (e) { report(t, e); } }
  }
  return { passed, failed };
}

module.exports = { makeApi, memDb, test, testAsync, hasPglite, pglite, assert, runAll };

if (require.main === module) {
  runAll().then(({ passed, failed }) => {
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
}
