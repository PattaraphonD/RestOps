'use strict';
const { testAsync, pglite, assert } = require('../test_core.js');
const S = require('../pg_schema.js');
const H = require('../../server/handler.js');
const Http = require('../../server/http.js');

async function deps() {
  const pg = await pglite();
  await pg.db.exec(S.buildSql(global.RestoCore.SCHEMA, global.RestoCore.TEXT_COLUMNS));
  const d = { transaction: pg.transaction, uuid: () => require('crypto').randomUUID(), now: () => new Date() };
  await H.setupDatabase(d, { ownerUsername: 'owner', ownerPassword: 'test1234', lang: 'th' });
  return Object.assign(d, { pg });
}
const post = (body, raw) => new Request('https://x.supabase.co/functions/v1/api', {
  method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8', Origin: 'https://restops-app.vercel.app' },
  body: raw !== undefined ? raw : JSON.stringify(body),
});

testAsync('http: CORS preflight and health', async () => {
  const d = await deps();
  const pre = await Http.handleHttp(new Request('https://x/api', { method: 'OPTIONS' }), d);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  const health = await (await Http.handleHttp(new Request('https://x/api'), d)).json();
  assert.deepEqual(health, { ok: true, data: { service: 'Restaurant Ops API', version: global.RestoCore.VERSION, database: 'supabase' } });
  await d.pg.db.close();
});

testAsync('http: the app\'s sign-in request works as text/plain JSON', async () => {
  const d = await deps();
  const res = await Http.handleHttp(post({ action: 'auth.login', payload: { username: 'owner', password: 'test1234' }, lang: 'th' }), d);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.data.token);
  await d.pg.db.close();
});

testAsync('http: a body that is not JSON gets the same reply as Apps Script', async () => {
  const d = await deps();
  const body = await (await Http.handleHttp(post(null, '{nope'), d)).json();
  assert.deepEqual(body, { ok: false, error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON.' } });
  await d.pg.db.close();
});

const { test } = require('../test_core.js');
test('edge function: shared files load as ES modules the way Deno loads them', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const shared = path.join(__dirname, '..', '..', 'supabase', 'functions', '_shared');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resto-esm-'));
  const order = ['costing', 'pricing', 'core', 'types', 'store', 'pg', 'handler', 'http', 'pgjs'];
  order.forEach((n) => fs.copyFileSync(path.join(shared, n + '.js'), path.join(dir, n + '.mjs')));
  const entry = order.map((n) => `import './${n}.mjs';`).join('\n') +
    "\nconsole.log(JSON.stringify({ http: typeof globalThis.RestoHttp.handleHttp, version: globalThis.RestoCore.VERSION, store: typeof globalThis.RestoStore.memStore }));";
  fs.writeFileSync(path.join(dir, 'entry.mjs'), entry);
  const out = JSON.parse(execFileSync(process.execPath, [path.join(dir, 'entry.mjs')], { encoding: 'utf8' }));
  assert.deepEqual(out, { http: 'function', version: global.RestoCore.VERSION, store: 'function' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('edge function: shared copies match their sources (run python tools/build_backend.py)', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
  [['app/js/core.js', 'core'], ['app/js/costing.js', 'costing'], ['app/js/pricing.js', 'pricing'], ['server/types.js', 'types'],
    ['server/store.js', 'store'], ['server/pg.js', 'pg'], ['server/handler.js', 'handler'], ['server/http.js', 'http'], ['server/pgjs.js', 'pgjs']].forEach(([src, n]) => {
    assert.ok(read(`supabase/functions/_shared/${n}.js`).includes(read(src)), `${n}.js is out of date`);
  });
  assert.equal(read('supabase/functions/_shared/manifest.json'), read('server/manifest.json'));
});
