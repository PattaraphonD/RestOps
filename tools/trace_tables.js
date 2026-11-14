'use strict';
// Records which tables each API action uses, by running the whole test suite through a tracing store,
// and writes server/manifest.json. The Supabase server then loads only those tables per request.
// Run after adding or changing an action, then `python tools/build_backend.py`:
//   node tools/trace_tables.js
// A missing or incomplete entry is never wrong, only slower: the server falls back to every table.
const fs = require('fs');
const path = require('path');
const T = require('./test_core.js');

const used = {};
let current = [];   // stack of actions running (runAs inside handle, etc.)
const note = (table) => current.forEach((a) => { (used[a] = used[a] || new Set()).add(table); });

const realCreate = global.RestoCore.createApi;
global.RestoCore.createApi = function (env) {
  const db = env.db;
  const traced = Object.assign({}, db, {
    read: (t) => { note(t); return db.read(t); },
    append: (t, rows) => { note(t); return db.append(t, rows); },
    updateWhere: (t, p, patch) => { note(t); return db.updateWhere(t, p, patch); },
    removeWhere: (t, p) => { note(t); return db.removeWhere(t, p); },
    lock: (fn) => db.lock(fn),
  });
  const api = realCreate(Object.assign({}, env, { db: traced }));
  const wrap = (fn, actionOf) => function () {
    const a = actionOf.apply(null, arguments);
    if (!a) return fn.apply(api, arguments);
    current.push(a);
    try { return fn.apply(api, arguments); } finally { current.splice(current.lastIndexOf(a), 1); }
  };
  return Object.assign({}, api, {
    handle: wrap(api.handle, (req) => req && req.action),
    runAs: wrap(api.runAs, (user, action) => action),
  });
};

T.runAll({ quiet: true, skip: /^manifest:|shared copies match/ }).then(({ failed }) => {
  if (failed) { console.error('Tests failed while tracing; manifest not written.'); process.exit(1); }
  const out = {};
  Object.keys(used).sort().forEach((a) => {
    // Every request checks the session's user and reads settings.
    out[a] = Array.from(new Set(['Users', 'Settings'].concat(Array.from(used[a])))).sort();
  });
  const file = path.join(__dirname, '..', 'server', 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log('Wrote server/manifest.json (' + Object.keys(out).length + ' actions)');
  process.exit(0);
});
