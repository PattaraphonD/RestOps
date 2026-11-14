'use strict';
// The Vercel cron function that keeps the free Supabase project awake (app/api/keepalive.js).
const fs = require('fs');
const path = require('path');
const { testAsync, test, assert } = require('../test_core.js');

const fnPath = path.join(__dirname, '..', '..', 'app', 'api', 'keepalive.js');
function res() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
}

testAsync('keepalive: pings the Supabase server with a database check', async () => {
  const keepalive = require(fnPath);
  const realFetch = global.fetch;
  const seen = [];
  global.fetch = async (url) => { seen.push(String(url)); return new Response(JSON.stringify({ ok: true, data: { databaseOk: true, version: '2.0.4' } }), { status: 200 }); };
  try {
    const r = res();
    await keepalive({ headers: {} }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.match(seen[0], /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/api\?check=db$/);
  } finally { global.fetch = realFetch; }
});

testAsync('keepalive: a sleeping or broken database is reported as a failure (shows in Vercel logs)', async () => {
  const keepalive = require(fnPath);
  const realFetch = global.fetch;
  global.fetch = async () => new Response('{"ok":false}', { status: 503 });
  try {
    const r = res();
    await keepalive({ headers: {} }, r);
    assert.equal(r.statusCode, 502);
    assert.equal(r.body.ok, false);
  } finally { global.fetch = realFetch; }
});

test('keepalive: Vercel runs it once a day', () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'vercel.json'), 'utf8'));
  assert.deepEqual(v.crons, [{ path: '/api/keepalive', schedule: '0 20 * * *' }]);
});
