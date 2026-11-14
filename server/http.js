/**
 * HTTP layer for the Supabase Edge Function, written against the standard Fetch API
 * (Request/Response) so the same code runs on Deno and in the Node tests.
 *
 * The app sends text/plain JSON (a CORS "simple request", as it did to Apps Script);
 * replies are { ok, data } or { ok: false, error }. GET is a health check.
 */
var RestoHttp = (function () {
  'use strict';
  var Handler = typeof RestoHandler !== 'undefined' ? RestoHandler : require('./handler.js');
  var CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Max-Age': '86400'
  };
  function json(obj, status) {
    var headers = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS);
    return new Response(JSON.stringify(obj), { status: status || 200, headers: headers });
  }

  async function handleHttp(request, deps) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'GET') {
      var info = { service: 'Restaurant Ops API', version: RestoCore.VERSION, database: 'supabase' };
      // ?check=db runs a tiny query: used by the daily keep-alive, so the database itself sees activity.
      if (new URL(request.url).searchParams.get('check') === 'db') {
        try {
          await deps.transaction(function (query) { return query('select 1 as ok', []); });
          info.databaseOk = true;
        } catch (e) {
          if (typeof console !== 'undefined') console.error('health check failed:', e && e.message);
          return json({ ok: false, error: { code: 'SERVER', message: 'Database unreachable.' } }, 503);
        }
      }
      return json({ ok: true, data: info });
    }
    if (request.method !== 'POST') return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Use POST.' } }, 405);
    var body;
    try { body = JSON.parse(await request.text() || '{}'); } catch (e) {
      return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON.' } });
    }
    return json(await Handler.handleRequest(body, deps));
  }

  return { handleHttp: handleHttp };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RestoHttp;
