# Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing API (`core.js` unchanged in behaviour) on Supabase — Postgres for storage, one Edge Function for the server — so the app only changes its server address.

**Architecture:** Per request, the Edge Function opens a Postgres transaction (global advisory lock for writes), loads tables into an in-memory store, runs `RestoCore` synchronously against it, collects a change log, writes the changes back in the same transaction and commits. Storage and request handling live in plain-JS modules under `server/` that Node tests drive against PGlite (Postgres in WebAssembly), and that `tools/build_backend.py` copies into `supabase/functions/_shared/`.

**Tech Stack:** Supabase (Postgres 15+, Edge Functions on Deno), `npm:postgres@3` in the function, `@electric-sql/pglite@0.5.16` for Node tests (dev-only `package.json`), existing Node test runner `tools/test_core.js`.

**Spec:** `docs/superpowers/specs/2026-11-14-supabase-migration-design.md`

## Global Constraints

- Business rules stay in `app/js/core.js`, `costing.js`, `pricing.js`; the only core change allowed is exposing `actionInfo` (Task 3). Demo and tests keep using them unchanged.
- Table and column names exactly as `RestoCore.SCHEMA` (quoted identifiers, e.g. `"Sales"."menuItemId"`); new columns append-only.
- Dates stay text `YYYY-MM-DD`; timestamps stay ISO text; `null` from Postgres is returned to core as `''`.
- Every table: RLS enabled, no policies; `revoke all` from `anon` and `authenticated`.
- Request/response contract unchanged: body `{ action, token, payload, lang, requestId }` sent as `text/plain`, reply `{ ok, data }` or `{ ok:false, error:{ code, message, details } }`.
- Writes are atomic: any error → `ROLLBACK`, nothing persisted.
- Advisory lock key `4242` (`pg_advisory_xact_lock`) for every write action and `auth.login`.
- Thai only in user-facing text (see `thai-only` rule in `docs/HANDOVER.md`).
- Version `2.0.0` (core `VERSION`, `sw.js` cache `resto-ops-v2.0.0`, smoke test).
- Supabase account, project creation, `supabase login` and the first deploy are done by the owner; docs give the exact commands. No credentials in the repo.
- Executed natively (in-session), one fresh reviewer at the end.

## Review Focus

1. **Blank cells vs zero:** a numeric column left empty (e.g. `parLevel`, `prepMinutes`) must come back as `''`, not `0`, because core treats `''` as "not set". Test in Task 2.
2. **Timeout after commit:** the app retries with the same `requestId`; the second call must return the first result and not write again. Test in Task 4.
3. **Two saves at once:** two concurrent write requests must not lose either change (the second sees the first's rows). Test in Task 4.
4. **A failing write after partial work** (e.g. `po.receive` validation error after core appended rows to its store): nothing reaches Postgres. Test in Task 4.
5. **Session expiry:** an expired token is refused with code `AUTH` and expired rows are purged on the next write. Test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `tools/pg_schema.js` | Generate the SQL migration from `RestoCore.SCHEMA` + a column type map |
| `supabase/migrations/20261114000000_init.sql` | Generated: tables, keys, indexes, RLS, `sessions` |
| `server/store.js` | `memStore(snapshot)`: synchronous `read/append/updateWhere/removeWhere/lock` + `changes()`; `memSessions(rows)` |
| `server/pg.js` | `snapshot(query, tables)`, `flush(query, changes)`, `flushSessions(query, changes)` — async, driver-agnostic |
| `server/handler.js` | `handleRequest(body, deps)` — the transaction flow |
| `supabase/functions/api/index.ts` | Deno entry: CORS, `GET` health, `POST` → `handleRequest` with `npm:postgres` |
| `supabase/functions/_shared/*.js` | Copied by `tools/build_backend.py` (core, costing, pricing, store, pg, handler) |
| `tools/supabase_setup.mjs` | One-off: create settings + first owner, print temporary password |
| `tools/tests/pg_*.test.js` | PGlite tests (skipped with a notice if PGlite isn't installed) |
| `package.json` | Dev-only: `@electric-sql/pglite`, `postgres` |
| `docs/SUPABASE.md` | Owner's setup, deploy, reset, rollback |

---

### Task 1: SQL schema generated from SCHEMA

**Files:**
- Create: `tools/pg_schema.js`, `supabase/migrations/20261114000000_init.sql`, `package.json`, `tools/tests/pg_schema.test.js`

**Interfaces:**
- Produces: `buildSql(schema: object, textColumns: string[]) -> string`; `COLUMN_TYPES: { [column]: 'numeric' | 'boolean' }` (everything else `text`); `keyOf(table) -> 'id' | 'key'`; CLI `node tools/pg_schema.js` writes the migration file.

- [ ] **Step 1: Add dev dependencies**

`package.json` with `"private": true`, devDependencies `@electric-sql/pglite` `0.5.16`, `postgres` `3.4.5`. Run `npm install`. Add `node_modules/` to `.gitignore`.

- [ ] **Step 2: Write the failing tests** in `tools/tests/pg_schema.test.js` (skip whole file with a printed notice if `require.resolve('@electric-sql/pglite')` fails; the runner is synchronous, so PGlite tests register one async test via a small `testAsync(name, fn)` helper added to `tools/test_core.js` that awaits all async tests after the sync ones and adds them to the pass/fail count):
  - `every table has a key`: for each SCHEMA table, `keyOf(t)` is a column of it (`Settings` → `key`, others → `id`).
  - `types`: `COLUMN_TYPES.qty === 'numeric'`, `COLUMN_TYPES.total === 'numeric'`, `COLUMN_TYPES.version === 'numeric'`, `COLUMN_TYPES.active === 'boolean'`, `COLUMN_TYPES.voided === 'boolean'`, `COLUMN_TYPES.date === undefined`, `COLUMN_TYPES.code === undefined`; no column in `TEXT_COLUMNS` is numeric/boolean.
  - `migration applies` (async): new PGlite, `exec(buildSql(...))`; `select count(*) from information_schema.tables where table_schema='public'` equals SCHEMA table count + 1 (`sessions`); `"Sales"` has columns in SCHEMA order plus `created_seq`; `relrowsecurity` is true for every table.
  - `checked-in migration is current`: file content equals `buildSql(...)` (forces regeneration when SCHEMA changes).

- [ ] **Step 3: Run to verify failure** — `node tools/test_core.js` → the four new tests fail (`buildSql is not a function`).

- [ ] **Step 4: Implement `tools/pg_schema.js`**

Per table: `create table if not exists "T" (<cols>, created_seq bigserial, primary key ("<key>"))`; `alter table "T" enable row level security; revoke all on "T" from anon, authenticated;`. Indexes on `"date"` for Sales, StockMovements, Purchases, Expenses, DayCloses; on `menuItemId`, `ingredientId`, `poId`, `invoiceId`, `channelId` where present. Plus `sessions(key text primary key, value text not null, expires_at timestamptz not null)` with the same RLS/revoke. Numeric list: start from the numeric fields used with `num(` in core (qty, unitCost, total, costTotal, unitPrice, amount, costPerUnit, minLevel, parLevel, version, yieldPct, batchQty, shelfLifeDays, factor, oldCost, newCost, batches, expectedQty, producedQty, inputCost, commissionPct, packagingCost, sortOrder, price, value, platformFundedPct, stepNo, minutes, prepMinutes, leadTimeDays, paymentTermsDays, qtyOrdered, subtotal, vat, salesTotal, wasteValue, countLines, commission, listPrice, discount, platformDiscount, …); tests in Tasks 2 and 6 catch omissions.

- [ ] **Step 5: Generate and run** — `node tools/pg_schema.js` then `node tools/test_core.js` → all pass.

- [ ] **Step 6: Commit** — `feat(server): Postgres schema generated from SCHEMA`

---

### Task 2: In-memory store with change log, and Postgres load/flush

**Files:**
- Create: `server/store.js`, `server/pg.js`, `tools/tests/pg_store.test.js`

**Interfaces:**
- Consumes: `keyOf`, `COLUMN_TYPES` (Task 1).
- Produces:
  - `memStore(snapshot: { [table]: row[] }) -> { read, append, updateWhere, removeWhere, lock, changes }` where `changes() -> { [table]: { inserted: row[], updated: row[], removed: key[] } }` (an inserted row later updated stays in `inserted` with final values; an inserted-then-removed row disappears).
  - `memSessions(rows: {key,value,expires_at}[], now: () => Date) -> { get, put, remove, changes }` with `changes() -> { upserts: {key,value,expires_at}[], removed: key[] }`.
  - `snapshot(query, tables: string[]) -> Promise<{ [table]: row[] }>` ordered by `created_seq`, values converted back (numeric → Number, boolean → Boolean, `null` → `''`).
  - `loadSessions(query) -> Promise<row[]>` (unexpired only).
  - `flush(query, changes) -> Promise<void>`; `flushSessions(query, changes, now) -> Promise<void>` (also deletes expired rows).
  - `query` is `(text: string, params: any[]) -> Promise<row[]>` — PGlite: `(t,p)=>db.query(t,p).then(r=>r.rows)`; postgres.js: `(t,p)=>sql.unsafe(t,p)`.
  - Both files use the same pattern as core: IIFE setting a global (`RestoStore`, `RestoPg`) and `module.exports` when present.

- [ ] **Step 1: Write the failing tests**
  - `memStore records inserts, updates and removals`: snapshot `{ Suppliers: [{id:'S1', name:'A', version:1}] }`; append S2; updateWhere S1 name→'B'; removeWhere S2 → `changes().Suppliers` is `{ inserted: [], updated: [{...S1, name:'B'}], removed: [] }`.
  - `memStore passes the whole core suite`: export `memDb` factory from `tools/test_core.js` behind a flag `RESTO_STORE=mem` that uses `memStore({})` instead; run `RESTO_STORE=mem node tools/test_core.js` → 142 passed (proves the interface matches).
  - (async) `round trip keeps types and blanks`: on PGlite with the migration, flush an Ingredients insert `{ id:'I1', name:'Rice', costPerUnit: 30, minLevel: 0, parLevel: '', active: true, version: 1, code: '' }`, then `snapshot` → `costPerUnit === 30` (number), `minLevel === 0`, `parLevel === ''`, `active === true`, `code === ''`.
  - (async) `order is kept`: insert three Sales rows → snapshot returns them in insert order.
  - (async) `sessions expire`: put `k` with ttl 1 s at now=T, load at T+2 s → not returned; `flushSessions` deletes it.

- [ ] **Step 2: Run to verify failure**, **Step 3: Implement** `server/store.js` (copy-on-read like `memDb`; key from `keyOf`) and `server/pg.js` (parameterised SQL; quoted identifiers; `insert … on conflict do nothing` is **not** used — duplicates must error), **Step 4: Run** → all pass.

- [ ] **Step 5: Commit** — `feat(server): change-log store and Postgres load/flush`

---

### Task 3: Core exposes action metadata

**Files:**
- Modify: `app/js/core.js` (the `return { handle, runAs, initialize }` block near the end of `createApi`)
- Test: `tools/tests/pg_store.test.js`

**Interfaces:**
- Produces: `api.actionInfo(action: string) -> { write: boolean, role: string } | null`. `auth.login` → `{ write: true, role: 'staff' }`.

- [ ] **Step 1: Failing test** `actionInfo`: `actionInfo('sales.add').write === true`, `actionInfo('reports.summary').write === false`, `actionInfo('auth.login').write === true`, `actionInfo('nope') === null`.
- [ ] **Step 2–4:** fail, implement, `python tools/build_backend.py`, run → pass.
- [ ] **Step 5: Commit** — `feat(core): expose action metadata for the server`

---

### Task 4: Request handler (transaction flow)

**Files:**
- Create: `server/handler.js`, `tools/tests/pg_handler.test.js`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces: `handleRequest(body: object, deps: { transaction: (fn: (query) => Promise<any>) => Promise<any>, uuid: () => string, now: () => Date }) -> Promise<{ ok, data?, error? }>` (global `RestoHandler`).

Flow: `info = probe api.actionInfo(body.action)` (unknown action → core's own `BAD_REQUEST` reply, no DB work) → `transaction(async (query) => { if write: query('select pg_advisory_xact_lock(4242)'); snap = await snapshot(query, ALL_TABLES); sess = memSessions(await loadSessions(query), now); store = memStore(snap); reply = createApi({ db: store, sessions: sess, uuid, now }).handle(body); if (!reply.ok) throw ROLLBACK_SENTINEL(reply); await flush(query, store.changes()); await flushSessions(query, sess.changes(), now()); return reply; })`, mapping the sentinel back to `reply` after rollback. Read actions also flush (session refresh), without the lock.

- [ ] **Step 1: Failing tests** (async, PGlite, `transaction` = `db.transaction(tx => fn((t,p)=>tx.query(t,p).then(r=>r.rows)))`; seed with a `setupOwner(query)` helper from Task 6 or inline `initialize`):
  - `sign in and read`: `auth.login` owner → `ok`, token; `bootstrap` with token → `ok`, `data.settings.restaurantName` present.
  - `a save persists`: `suppliers.save` → new row in `"Suppliers"` via SQL.
  - `a failed save writes nothing`: `po.receive` with a bad PO id → `ok:false`, and `select count(*)` of `"Purchases"` and `"StockMovements"` unchanged.
  - `retry with the same requestId saves once`: `sales.add` twice with `requestId:'r1'` → `"Sales"` row count increases once; both replies equal.
  - `concurrent saves both land`: `Promise.all` of two `suppliers.save` with different names → both rows present (PGlite serialises; the test still proves the lock+snapshot order is correct).
  - `expired session`: put a session row with `expires_at` in the past → `bootstrap` returns `error.code === 'AUTH'`; after any write the row is gone.
  - `Thai errors`: `sales.add` with `lang:'th'` and an empty line → Thai message (same text the demo gives).
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit** — `feat(server): transactional request handler`

---

### Task 5: Edge Function and build

**Files:**
- Create: `supabase/functions/api/index.ts`, `supabase/config.toml` (`supabase init` defaults; `[functions.api] verify_jwt = false`)
- Modify: `tools/build_backend.py` (also copy `app/js/{core,costing,pricing}.js` and `server/{store,pg,handler}.js` to `supabase/functions/_shared/`)

**Interfaces:**
- Consumes: `RestoHandler.handleRequest`.
- Produces: `POST /functions/v1/api` (contract unchanged), `GET` → `{ ok:true, data:{ service:'Restaurant Ops API', version } }`, `OPTIONS` → 204 with CORS headers (`Access-Control-Allow-Origin: *`, `-Methods: GET, POST, OPTIONS`, `-Headers: content-type`).

- [ ] **Step 1:** `index.ts` imports the shared files for their globals (`import '../_shared/costing.js'` …), creates `postgres(Deno.env.get('SUPABASE_DB_URL'), { max: 3, prepare: false })`, `transaction = (fn) => sql.begin((tx) => fn((t, p) => tx.unsafe(t, p)))`, `uuid = crypto.randomUUID`, `now = () => new Date()`; parses `await req.text()`; bad JSON → `{ ok:false, error:{ code:'BAD_REQUEST', message:'Request body is not valid JSON.' } }` (same as Server.gs).
- [ ] **Step 2: Verify** `python tools/build_backend.py` lists the six shared files; `npx deno check supabase/functions/api/index.ts` if Deno is available, otherwise defer to the deploy smoke test (Task 7).
- [ ] **Step 3: Commit** — `feat(server): Supabase Edge Function entry`

---

### Task 6: Parity test — a scripted day through both stores

**Files:**
- Create: `tools/tests/pg_parity.test.js`, `tools/tests/script_day.js`

**Interfaces:**
- Produces: `runScriptedDay(call: (user, action, payload) => any | Promise<any>) -> Promise<void>` — owner creates channel prices, 2 suppliers, 6 ingredients (one prep), 3 dishes with recipes, a PO (save, send, receive partly), an invoice (save, approve, pay), sales on 2 channels, waste, a count, a production run, a promotion, `day.close`, settings change; uses fixed ids via the deterministic `uuid` from `makeApi`.

- [ ] **Step 1: Failing test** `memory and Postgres end the day identically`: run the script through `makeApi()` (memDb) and through `handleRequest` on PGlite (same `uuid` sequence, same `now`), then for every SCHEMA table compare rows sorted by key with `assert.deepEqual` (ignoring `created_seq`).
- [ ] **Step 2–4:** fail (missing numeric types show up here as `'30'` vs `30`), fix `COLUMN_TYPES` / conversions, pass.
- [ ] **Step 5: Commit** — `test(server): memory/Postgres parity for a full day`

---

### Task 7: Owner setup, app address, docs, version

**Files:**
- Create: `tools/supabase_setup.mjs`, `docs/SUPABASE.md`
- Modify: `app/config.js`, sign-in help keys in `app/js/i18n.js` (`login.serverHelp`), `app/js/core.js` (`VERSION = '2.0.0'`), `app/sw.js`, `tools/tests/smoke.test.js`, `docs/HANDOVER.md`, `README.md`

**Interfaces:**
- Produces: `node tools/supabase_setup.mjs "<db-url>" [restaurantName]` → runs `initialize({ ownerUsername:'owner', ownerPassword:<random 12>, lang:'th', restaurantName })` through the handler's transaction and prints the Thai/English message Server.gs prints; `--reset-owner` prints a new owner password (same as `resetOwnerPassword`).

- [ ] **Step 1: Test** `setup creates owner once` (PGlite, call the exported `setup(query)`): first call → `ownerCreated === 'owner'`; second → `null`; `"Settings"` has all default keys.
- [ ] **Step 2: Implement**, `config.js` keeps a comment showing both URL shapes and leaves `apiUrl` as the Apps Script URL until the owner's deploy (Step 4).
- [ ] **Step 3: Write `docs/SUPABASE.md`** (Thai headings with English commands): create project (region Singapore, plan note: Free pauses after 7 days idle and has no backups; Pro ≈ US$25/month for real use) → `npx supabase login` → `npx supabase link --project-ref <ref>` → `npx supabase db push` → `npx supabase functions deploy api --no-verify-jwt` → `node tools/supabase_setup.mjs "<db-url>"` (from Project Settings → Database → Connection string, kept out of the repo) → set `apiUrl` to `https://<ref>.supabase.co/functions/v1/api` → redeploy the app. Rollback: put the Apps Script URL back in `config.js`.
- [ ] **Step 4: Deploy smoke test with the owner** (owner runs login/link/deploy; then I run): `curl` GET health → version 2.0.0; app sign-in with the printed password; add a supplier; reload → still there; Supabase table editor shows the row; `curl` to `https://<ref>.supabase.co/rest/v1/Suppliers` with the anon key → empty/401 (RLS).
- [ ] **Step 5: Commit** — `feat: v2.0.0 Supabase backend` (config change committed only after Step 4 passes).

---

### Task 8: Load only the tables an action needs

**Files:**
- Create: `tools/trace_tables.js`, `server/manifest.json`
- Modify: `server/handler.js`, `tools/build_backend.py` (copy manifest)

**Interfaces:**
- Produces: `manifest.json`: `{ [action]: table[] }` generated by running the full test suite with a tracing store that records `read/append/updateWhere/removeWhere` tables per action (plus `Users`, `Settings` always). `handleRequest` loads `manifest[action] || ALL_TABLES`.

- [ ] **Step 1: Failing test** `manifest covers every action`: every key of core's action table appears in `manifest.json`; `manifest['reports.summary']` includes `Sales`, `Purchases`, `Expenses`, `StockMovements`; handler test suite (Task 4) and parity (Task 6) still pass with the manifest on.
- [ ] **Step 2–4:** fail, implement `node tools/trace_tables.js` → writes manifest; pass. Add to `docs/HANDOVER.md`: run the tracer after adding an action (a missing entry falls back to all tables, so it's slow, never wrong).
- [ ] **Step 5: Commit** — `perf(server): per-action table manifest`

---

### Task 9 (optional, only if the owner asks): import from an existing Google Sheet

- `tools/import_sheets.mjs "<db-url>" <folder-of-csv>`: one CSV per tab (File → Download → CSV), header row must equal SCHEMA; rows converted with `COLUMN_TYPES`; whole import in one transaction; refuses if target tables aren't empty. Test with PGlite and a two-tab fixture.

### Task 10 (optional, only if the owner asks): nightly copy to Google Sheets

- Apps Script time trigger calling a read-only `export.tables` action (owner role, new) and writing each table to a tab. Off by default.

---

## Self-review notes

- Spec coverage: database & RLS → T1; store/snapshot/flush → T2; handler/atomicity/lock/sessions → T4; core change → T3; function/CORS/health/no-JWT → T5; parity → T6; app address, docs, backups, rollback, version, deploy smoke → T7; performance phase 2 → T8; optional import/export → T9/T10.
- Review Focus 1 → T2 round-trip test; 2, 3, 4, 5 → T4 tests.
