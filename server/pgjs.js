/**
 * Handler deps for the postgres.js driver (used by the Edge Function and tools/supabase_setup.mjs).
 * Every request runs in one transaction; query(text, params) uses unprepared statements, which
 * Supabase's connection pooler requires.
 */
var RestoPgjs = (function () {
  'use strict';
  function postgresDeps(sql, extra) {
    return Object.assign({
      transaction: function (fn) {
        return sql.begin(function (tx) { return fn(function (text, params) { return tx.unsafe(text, params || []); }); });
      },
      uuid: function () { return crypto.randomUUID(); },
      now: function () { return new Date(); }
    }, extra || {});
  }
  return { postgresDeps: postgresDeps };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RestoPgjs;
