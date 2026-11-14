/**
 * Postgres side of the store: load tables for a request, and write a request's changes back.
 * `query(text, params) → Promise<rows>` is supplied by the caller (postgres.js in the Edge Function,
 * PGlite in tests), always inside one transaction.
 *
 * Values come back the way a spreadsheet gave them to the business rules: numbers as numbers,
 * booleans as booleans, empty cells (NULL) as ''.
 */
var RestoPg = (function () {
  'use strict';
  var Types = typeof RestoPgTypes !== 'undefined' ? RestoPgTypes : require('./types.js');
  var schema = function () { return RestoCore.SCHEMA; };
  var q = function (id) { return '"' + String(id).replace(/"/g, '""') + '"'; };

  function fromDb(type, v) {
    if (v === null || v === undefined) return '';
    if (type === 'numeric') return Number(v);
    if (type === 'boolean') return v === true || v === 't' || v === 'true';
    return v instanceof Date ? v.toISOString() : String(v);
  }
  function toDb(type, v) {
    if (v === null || v === undefined || v === '') return null;
    if (type === 'numeric') { var n = Number(v); return isFinite(n) ? n : null; }
    if (type === 'boolean') return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
    return String(v);
  }

  /** { table: rows[] } in the order rows were first written. */
  async function snapshot(query, tables) {
    var out = {};
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i], cols = schema()[t];
      var rows = await query('select ' + cols.map(q).join(', ') + ' from ' + q(t) + ' order by "created_seq"', []);
      out[t] = rows.map(function (r) {
        var o = {};
        cols.forEach(function (c) { o[c] = fromDb(Types.typeOf(t, c), r[c]); });
        return o;
      });
    }
    return out;
  }

  /** Writes memStore.changes(): removals, then updates, then inserts (keeps write order). */
  async function flush(query, changes) {
    var tables = Object.keys(changes);
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i], ch = changes[t], cols = schema()[t], key = Types.keyOf(t);
      var val = function (r, c) { return toDb(Types.typeOf(t, c), r[c]); };
      if (ch.removed.length) await query('delete from ' + q(t) + ' where ' + q(key) + ' = any($1)', [ch.removed]);
      for (var u = 0; u < ch.updated.length; u++) {
        var row = ch.updated[u], set = cols.filter(function (c) { return c !== key; });
        await query('update ' + q(t) + ' set ' + set.map(function (c, j) { return q(c) + ' = $' + (j + 1); }).join(', ') +
          ' where ' + q(key) + ' = $' + (set.length + 1),
          set.map(function (c) { return val(row, c); }).concat([String(row[key])]));
      }
      // Multi-row inserts, in batches small enough for the parameter limit.
      var per = Math.max(1, Math.floor(30000 / cols.length));
      for (var b = 0; b < ch.inserted.length; b += per) {
        var batch = ch.inserted.slice(b, b + per), params = [], groups = [];
        batch.forEach(function (r) {
          groups.push('(' + cols.map(function (c) { params.push(val(r, c)); return '$' + params.length; }).join(', ') + ')');
        });
        await query('insert into ' + q(t) + ' (' + cols.map(q).join(', ') + ') values ' + groups.join(', '), params);
      }
    }
  }

  /** Unexpired sessions as memSessions rows. */
  async function loadSessions(query, now) {
    var rows = await query('select "key", "value", "expires_at" from "sessions" where "expires_at" > $1', [now.toISOString()]);
    return rows.map(function (r) { return { key: r.key, value: r.value, exp: new Date(r.expires_at).getTime() }; });
  }

  /** Writes memSessions.changes() and drops expired sessions. */
  async function flushSessions(query, changes, now) {
    if (changes.removed.length) await query('delete from "sessions" where "key" = any($1)', [changes.removed]);
    for (var i = 0; i < changes.upserts.length; i++) {
      var s = changes.upserts[i];
      await query('insert into "sessions" ("key", "value", "expires_at") values ($1, $2, $3) ' +
        'on conflict ("key") do update set "value" = excluded."value", "expires_at" = excluded."expires_at"', [s.key, s.value, s.expires_at]);
    }
    await query('delete from "sessions" where "expires_at" <= $1', [now.toISOString()]);
  }

  return { snapshot: snapshot, flush: flush, loadSessions: loadSessions, flushSessions: flushSessions, fromDb: fromDb, toDb: toDb };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RestoPg;
