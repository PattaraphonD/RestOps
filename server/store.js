/**
 * In-memory store for one request: the business rules (RestoCore) run synchronously against it,
 * exactly as they do against a spreadsheet, and it records every change so the server can write
 * them back to Postgres in the same transaction.
 *
 * memStore(snapshot, { strict }) → { read, append, updateWhere, removeWhere, lock, changes }
 * memSessions(rows, now)         → { get, put, remove, changes }
 */
var RestoStore = (function () {
  'use strict';
  var Types = typeof RestoPgTypes !== 'undefined' ? RestoPgTypes : require('./types.js');
  var copy = function (r) { return Object.assign({}, r); };

  function memStore(snapshot, opts) {
    var strict = !!(opts && opts.strict);
    var data = {};
    Object.keys(snapshot || {}).forEach(function (t) { data[t] = snapshot[t].map(copy); });
    var log = {};

    function tbl(t) {
      if (!data[t]) {
        if (strict) { var e = new Error('Table not loaded: ' + t); e.code = 'TABLE_NOT_LOADED'; e.table = t; throw e; }
        data[t] = [];
      }
      return data[t];
    }
    function entry(t) {
      return log[t] = log[t] || { inserted: new Map(), updated: new Map(), removed: new Set() };
    }

    return {
      read: function (t) { return tbl(t).map(copy); },
      append: function (t, rows) {
        var key = Types.keyOf(t), list = tbl(t), e = entry(t);
        rows.forEach(function (r) { var row = copy(r); list.push(row); e.inserted.set(String(row[key]), row); });
      },
      updateWhere: function (t, pred, patch) {
        var key = Types.keyOf(t), n = 0, e;
        tbl(t).forEach(function (r) {
          if (!pred(copy(r))) return;
          Object.assign(r, patch);
          e = entry(t);
          var k = String(r[key]);
          if (!e.inserted.has(k)) e.updated.set(k, r);
          n++;
        });
        return n;
      },
      removeWhere: function (t, pred) {
        var key = Types.keyOf(t), list = tbl(t), keep = [], n = 0, e;
        list.forEach(function (r) {
          if (!pred(copy(r))) { keep.push(r); return; }
          e = entry(t);
          var k = String(r[key]);
          if (e.inserted.has(k)) e.inserted.delete(k);
          else { e.updated.delete(k); e.removed.add(k); }
          n++;
        });
        data[t] = keep;
        return n;
      },
      lock: function (fn) { return fn(); },   // the server holds a Postgres lock for the whole request
      changes: function () {
        var out = {};
        Object.keys(log).forEach(function (t) {
          var e = log[t];
          if (!e.inserted.size && !e.updated.size && !e.removed.size) return;
          out[t] = {
            inserted: Array.from(e.inserted.values()).map(copy),
            updated: Array.from(e.updated.values()).map(copy),
            removed: Array.from(e.removed)
          };
        });
        return out;
      }
    };
  }

  /** rows: [{ key, value, exp (ms since epoch) }] — unexpired sessions loaded for this request. */
  function memSessions(rows, now) {
    var map = new Map(), upserts = new Map(), removed = new Set();
    (rows || []).forEach(function (r) { map.set(r.key, { value: String(r.value), exp: Number(r.exp) }); });
    var t = function () { return now().getTime(); };
    return {
      get: function (k) { var s = map.get(k); return s && s.exp > t() ? s.value : null; },
      put: function (k, v, ttlSeconds) {
        var s = { value: String(v), exp: t() + Number(ttlSeconds) * 1000 };
        map.set(k, s); upserts.set(k, s); removed.delete(k);
      },
      remove: function (k) { map.delete(k); upserts.delete(k); removed.add(k); },
      changes: function () {
        return {
          upserts: Array.from(upserts.entries()).map(function (e) {
            return { key: e[0], value: e[1].value, expires_at: new Date(e[1].exp).toISOString() };
          }),
          removed: Array.from(removed)
        };
      }
    };
  }

  return { memStore: memStore, memSessions: memSessions };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RestoStore;
