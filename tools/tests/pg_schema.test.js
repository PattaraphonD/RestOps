'use strict';
const fs = require('fs');
const path = require('path');
const { test, testAsync, pglite, assert } = require('../test_core.js');
const S = require('../pg_schema.js');

const SCHEMA = global.RestoCore.SCHEMA;
const MIG_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
// The newest migration always holds the full, re-runnable schema.
const MIGRATION = path.join(MIG_DIR, fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort().pop());

test('pg schema: every table has a key', () => {
  Object.keys(SCHEMA).forEach((t) => {
    const k = S.keyOf(t);
    assert.ok(SCHEMA[t].includes(k), `${t} has its key ${k}`);
  });
  assert.equal(S.keyOf('Settings'), 'key');
  assert.equal(S.keyOf('Sales'), 'id');
});

test('pg schema: column types', () => {
  const T = S.COLUMN_TYPES;
  assert.equal(T.qty, 'numeric');
  assert.equal(T.total, 'numeric');
  assert.equal(T.version, 'numeric');
  assert.equal(T.active, 'boolean');
  assert.equal(T.voided, 'boolean');
  assert.equal(T.date, undefined);
  assert.equal(T.code, undefined);
  global.RestoCore.TEXT_COLUMNS.forEach((c) => assert.equal(T[c], undefined, `${c} stays text`));
});

test('pg schema: the checked-in migration is current', () => {
  // Git on Windows may check the file out with CRLF line endings.
  assert.equal(fs.readFileSync(MIGRATION, 'utf8').replace(/\r\n/g, '\n'), S.buildSql(SCHEMA, global.RestoCore.TEXT_COLUMNS),
    'SCHEMA changed: run node tools/pg_schema.js (adds a new migration), then npx supabase db push --remote');
});

testAsync('pg schema: migration applies with RLS on every table', async () => {
  const { db, query } = await pglite();
  await db.exec(S.buildSql(SCHEMA, global.RestoCore.TEXT_COLUMNS));
  // PGlite has no anon/authenticated roles until the migration creates them for local runs.
  const tables = await query("select table_name from information_schema.tables where table_schema = 'public'");
  assert.equal(tables.length, Object.keys(SCHEMA).length + 1);
  const cols = await query("select column_name from information_schema.columns where table_name = 'Sales' order by ordinal_position");
  assert.deepEqual(cols.map((c) => c.column_name), [...SCHEMA.Sales, 'created_seq']);
  const rls = await query("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'");
  assert.equal(rls.length, Object.keys(SCHEMA).length + 1);
  rls.forEach((r) => assert.equal(r.relrowsecurity, true, `${r.relname} has RLS`));
  await db.close();
});

testAsync('pg schema: running it again on an older database adds the new columns', async () => {
  const { db, query } = await pglite();
  await db.exec('create table "Ingredients" ("id" text primary key, "name" text, "created_seq" bigserial)');
  await db.exec("insert into \"Ingredients\" (\"id\", \"name\") values ('I1', 'Rice')");
  await db.exec(S.buildSql(SCHEMA, global.RestoCore.TEXT_COLUMNS));
  await db.exec(S.buildSql(SCHEMA, global.RestoCore.TEXT_COLUMNS));
  const cols = (await query("select column_name from information_schema.columns where table_name = 'Ingredients'")).map((r) => r.column_name);
  ['code', 'costPerUnit', 'allergens'].forEach((c) => assert.ok(cols.includes(c), c));
  assert.equal((await query('select "name" from "Ingredients"'))[0].name, 'Rice');
  await db.close();
});
