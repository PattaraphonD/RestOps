/**
 * One API request on Postgres: load the tables, run the business rules (RestoCore) unchanged against
 * an in-memory copy, then write the changes back — all in one transaction, so a save lands completely
 * or not at all. Saves take a database-wide lock first (like Apps Script's LockService), so two saves
 * never read the same data and overwrite each other.
 *
 * deps = {
 *   transaction(fn) → Promise   runs fn(query) inside BEGIN … COMMIT (ROLLBACK if it throws);
 *                               READ COMMITTED, so a save reads what was committed before its lock
 *   uuid() → string, now() → Date
 *   tablesFor(action) → string[] | null   optional: only these tables are loaded (see manifest)
 *   onFallback(action, message)           optional: called when that list was incomplete
 * }
 */
var RestoHandler = (function () {
  'use strict';
  var Store = typeof RestoStore !== 'undefined' ? RestoStore : require('./store.js');
  var Pg = typeof RestoPg !== 'undefined' ? RestoPg : require('./pg.js');
  var LOCK_KEY = 4242;

  function allTables() { return Object.keys(RestoCore.SCHEMA); }
  function apiFor(store, sessions, deps) {
    return RestoCore.createApi({ db: store, sessions: sessions, uuid: deps.uuid, now: deps.now });
  }

  var NEEDS_LOCK = { needsLock: true };
  var SERVER_ERROR = "The server couldn't finish this. Please try again.";

  /**
   * Runs fn(api, store, sessions) on a fresh snapshot inside one transaction; ok replies are written back.
   * A read that turns out to change tables (e.g. the first bootstrap creating default channels) writes
   * nothing and returns NEEDS_LOCK, so the caller runs it again as a save, under the lock.
   */
  function run(deps, opts, fn) {
    return deps.transaction(async function (query) {
      if (opts.write) {
        // Never wait forever behind a stuck save: the phone gives up after 45 s.
        await query("set local lock_timeout = '20s'", []);
        await query("set local statement_timeout = '30s'", []);
        await query('select pg_advisory_xact_lock(' + LOCK_KEY + ')', []);
      }
      var now = deps.now();
      var snap = await Pg.snapshot(query, opts.tables);
      var sessions = Store.memSessions(await Pg.loadSessions(query, now), deps.now);
      var store = Store.memStore(snap, { strict: opts.tables.length < allTables().length });
      var reply = fn(apiFor(store, sessions, deps), store, sessions);
      if (reply && reply.error && reply.error.code === 'TABLE_NOT_LOADED') return reply;
      if (!opts.write && Object.keys(store.changes()).length) return NEEDS_LOCK;
      // A failed action's table changes are dropped; session changes (sign-in attempts) still count.
      if (!reply || reply.ok !== false) await Pg.flush(query, store.changes());
      await Pg.flushSessions(query, sessions.changes(), now);
      return reply;
    });
  }

  /** deps whose uuid() can be rewound, so a re-run of the same request reuses the same ids. */
  function replayable(deps) {
    var issued = [], next = 0, replaying = false;
    return Object.assign({}, deps, {
      uuid: function () {
        if (replaying && next < issued.length) return issued[next++];
        var id = deps.uuid();
        issued.push(id); next = issued.length;
        return id;
      },
      rewind: function () { replaying = true; next = 0; }
    });
  }

  async function handleRequest(body, deps) {
    body = body || {};
    deps = replayable(deps);
    var probe = apiFor(Store.memStore({}), Store.memSessions([], deps.now), deps);
    var info = probe.actionInfo(body.action);
    var write = !!(info && info.write);
    var tables = (deps.tablesFor && deps.tablesFor(body.action)) || allTables();
    var handle = function (api) { return api.handle(body); };
    try {
      var reply = await run(deps, { write: write, tables: tables }, handle);
      // The table list for this action was incomplete: run again with every table.
      if (reply && reply.error && reply.error.code === 'TABLE_NOT_LOADED') {
        if (deps.onFallback) deps.onFallback(body.action, reply.error.message);
        tables = allTables();
        deps.rewind();
        reply = await run(deps, { write: write, tables: tables }, handle);
      }
      if (reply === NEEDS_LOCK) { deps.rewind(); reply = await run(deps, { write: true, tables: tables }, handle); }
      return reply;
    } catch (e) {
      // Details go to the function's logs; the person sees a short message in their language.
      if (typeof console !== 'undefined') console.error('api ' + body.action + ' failed:', e && e.stack ? e.stack : e);
      return { ok: false, error: { code: 'SERVER', message: RestoCore.translate(SERVER_ERROR, body.lang) } };
    }
  }

  /** Default settings and the first owner. Safe to run more than once. */
  async function setupDatabase(deps, opts) {
    var result = null;
    await run(deps, { write: true, tables: allTables() }, function (api) {
      result = api.initialize(opts);
      return { ok: true };
    });
    return result;
  }

  /** A new password for the (first active) owner, e.g. when they are locked out. Returns { username }. */
  async function resetOwnerPassword(deps, password) {
    var who = null;
    await run(deps, { write: true, tables: allTables() }, function (api, store, sessions) {
      var owner = store.read('Users').filter(function (u) { return u.role === 'owner'; })[0];
      if (!owner) return { ok: false, error: { code: 'NOT_FOUND', message: 'No owner found. Run the setup first.' } };
      var salt = deps.uuid().replace(/-/g, '');
      store.updateWhere('Users', function (u) { return u.id === owner.id; },
        { salt: salt, passwordHash: RestoCore.hashPassword(password, salt), active: true });
      sessions.remove('fail:' + String(owner.username).toLowerCase());   // lift a sign-in lockout too
      who = { username: owner.username };
      return { ok: true };
    });
    if (!who) throw new Error('No owner found. Run the setup first.');
    return who;
  }

  /**
   * Loads an owner's backup file (backup.export) into a new, empty database — before the setup script.
   * Passwords are not in backups: afterwards run the setup script with --reset-owner, then reset staff passwords in the app.
   */
  async function restoreBackup(deps, backup) {
    if (!backup || backup.format !== 'restaurant-ops-backup' || !backup.tables) throw new Error('This file is not a Restaurant Ops backup.');
    var total = 0;
    await deps.transaction(async function (query) {
      await query('select pg_advisory_xact_lock(' + LOCK_KEY + ')', []);
      var tables = allTables();
      for (var i = 0; i < tables.length; i++) {
        var n = await query('select count(*)::int as n from "' + tables[i] + '"', []);
        if (Number(n[0].n) > 0) throw new Error('The database is not empty (' + tables[i] + '). Restore only into a new project, before running the setup.');
      }
      var changes = {};
      tables.forEach(function (t) {
        var rows = (backup.tables[t] || []).map(function (r) {
          var o = {};
          RestoCore.SCHEMA[t].forEach(function (c) { o[c] = r[c] === undefined ? '' : r[c]; });
          return o;
        });
        total += rows.length;
        if (rows.length) changes[t] = { inserted: rows, updated: [], removed: [] };
      });
      await Pg.flush(query, changes);
    });
    return { rows: total };
  }

  return { handleRequest: handleRequest, setupDatabase: setupDatabase, resetOwnerPassword: resetOwnerPassword, restoreBackup: restoreBackup };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RestoHandler;
