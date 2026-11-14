'use strict';
const fs = require('fs');
const path = require('path');
const { test, testAsync, pglite, assert } = require('../test_core.js');
const S = require('../pg_schema.js');
const H = require('../../server/handler.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('go-live: the site lets the app call Supabase (Vercel and Netlify headers)', () => {
  const vercel = JSON.parse(read('app/vercel.json')).headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  const netlify = read('app/_headers').split('\n').find((l) => l.includes('Content-Security-Policy'));
  [vercel, netlify].forEach((csp) => {
    const connect = csp.split(';').find((d) => d.trim().startsWith('connect-src'));
    assert.match(connect, /https:\/\/\*\.supabase\.co/);
    assert.match(connect, /https:\/\/script\.google\.com/, 'Apps Script stays allowed for the fallback');
  });
});

test('go-live: the sign-in screen accepts a Supabase function address', () => {
  const src = read('app/js/app.js');
  const m = src.match(/const SERVER_URL = (\/.+\/);/);
  assert.ok(m, 'SERVER_URL pattern in app.js');
  const re = eval(m[1]); // eslint-disable-line no-eval
  assert.ok(re.test('https://abcdefghijklmnop.supabase.co/functions/v1/api'));
  assert.ok(re.test('https://script.google.com/macros/s/AKfy/exec'));
  assert.ok(!re.test('http://abcdefghijklmnop.supabase.co/functions/v1/api'));
  assert.ok(!re.test('https://evil.example.com/functions/v1/api'));
});

testAsync('go-live: resetting the owner password', async () => {
  const pg = await pglite();
  await pg.db.exec(S.buildSql(global.RestoCore.SCHEMA, global.RestoCore.TEXT_COLUMNS));
  const deps = { transaction: pg.transaction, uuid: () => require('crypto').randomUUID(), now: () => new Date() };
  await H.setupDatabase(deps, { ownerUsername: 'owner', ownerPassword: 'first123' });
  const r = await H.resetOwnerPassword(deps, 'second456');
  assert.equal(r.username, 'owner');
  const login = (password) => H.handleRequest({ action: 'auth.login', payload: { username: 'owner', password } }, deps);
  assert.equal((await login('first123')).ok, false);
  assert.equal((await login('second456')).ok, true);
  await pg.db.close();
});
