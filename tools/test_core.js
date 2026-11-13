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

function makeApi() {
  const db = memDb();
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

module.exports = { makeApi, test, assert };

if (require.main === module) {
  const dir = path.join(__dirname, 'tests');
  fs.readdirSync(dir).filter((f) => /\.test\.js$/.test(f)).sort().forEach((f) => require(path.join(dir, f)));
  let passed = 0, failed = 0;
  tests.forEach((t) => {
    try { t.fn(); passed++; console.log('  ok   ' + t.name); }
    catch (e) {
      failed++;
      const msg = e && e.code && e.message && !e.stack ? e.code + ': ' + e.message : (e && e.stack) || String(e);
      console.log('  FAIL ' + t.name + '\n       ' + msg.split('\n').join('\n       '));
    }
  });
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}
