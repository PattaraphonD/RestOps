# Move the database to Supabase (v2.0.0) — design

## Intent
Replace Google Sheets + Apps Script as the live database and server with **Supabase** (Postgres + Edge Functions, Singapore region), before real data exists. Why: Sheets/Apps Script reads whole tables on almost every call, starts slowly (1–3 s), serialises every save, and has quotas; sales history grows by tens of thousands of rows a year, so Home and reports would slow to several seconds. Supabase gives a real database close to Thailand, daily backups (Pro), file storage and room for realtime later.

## Goals
- Same app, same features, same Thai UI: only the server address changes.
- All business rules stay in `core.js` (+ `costing.js`, `pricing.js`), shared by the demo, the tests and the server. No rewrite of rules.
- Every action behaves exactly as today: same validation, same Thai errors, same role checks, same idempotent `requestId` handling.
- Saves are atomic: an action's writes all land or none do.
- The database is not reachable from the internet except through our function (no public table access).
- Deploy is repeatable from the repo (migrations + one function).

## Non-goals
- No new features, no UI changes beyond the server-address setting text.
- No Supabase Auth: the app keeps its own users, roles and sessions (already in core).
- No data migration from Sheets (only demo data exists). An import script is optional (Task 9).
- Not removing the Apps Script backend from the repo yet: it stays as a fallback until v2 is live for a month.

## Anti-goals
- A port that forks business logic between demo and server.
- Tables readable through Supabase's public REST API with the anon key.
- A half-saved order (lines written, header not) after a timeout.

## Constraints
- `core.js` is synchronous and ES5 (`db.read(table)` returns an array immediately). Postgres access in an Edge Function is asynchronous.
- Edge Functions run on Deno; the shared files are plain scripts that set globals (`RestoCore`, `RestoCosting`, `RestoPricing`).
- The app posts `text/plain` JSON (a CORS "simple request") with `{ action, token, payload, lang, requestId }` and expects `{ ok, data | error }`.
- Tests run in Node with no Docker on this Windows machine.
- The owner creates the Supabase account and project and runs the CLI login (credentials stay with them).

## Approaches
1. **Snapshot → run → write back, in one Edge Function (chosen).** Per request: open a Postgres transaction (take a global advisory lock for writes, like Apps Script's LockService), load the tables into an in-memory store, run `core.js` unchanged against it, collect every append/update/remove as a change log, write the changes back in the same transaction, commit. Business rules untouched; atomic; testable with the existing in-memory store.
2. Rewrite each action as SQL / Postgres functions. Rejected: rewrites ~2,700 lines of tested rules; demo and server would diverge.
3. Make `core.js` async (`await db.read`). Rejected: touches every action (113 reads), and the demo/tests would need rewriting too.
4. Run `core.js` inside Postgres with plv8. Rejected: Supabase is deprecating plv8 on newer Postgres versions.

## Design

### Database
- One Postgres table per `SCHEMA` table, same name in snake case is **not** used: names stay exactly as in SCHEMA (quoted, e.g. `"Sales"`), columns exactly as in SCHEMA, so the store maps 1:1.
- Column types from a generated type map:
  - `text` by default (ids, names, notes, codes, all `TEXT_COLUMNS`);
  - `numeric` for quantities, money, percentages, versions, levels (an explicit list in `tools/pg_schema.js`);
  - `boolean` for `active`, `voided`, `trackStock`, `critical`, `commissionOnDiscounted`;
  - dates stay `text` in `YYYY-MM-DD` (core compares them as strings); timestamps stay `text` ISO (same reason).
- Primary key: `id` (or `key` for `Settings`). Every table gets `created_seq bigserial` for stable row order (Sheets row order is relied on for "latest" lookups).
- Indexes: `date` on Sales, StockMovements, Purchases, Expenses; foreign-id columns used in filters (menuItemId, ingredientId, poId, invoiceId, channelId).
- Extra tables: `sessions (key text primary key, value text, expires_at timestamptz)`, `request_log` is not needed (idempotency already lives in core's tables).
- **Row Level Security enabled on every table with no policies**, and `anon`/`authenticated` grants revoked: PostgREST can't read anything. Only the function's direct connection (postgres role) can.
- Migrations live in `supabase/migrations/`, generated from SCHEMA by `tools/pg_schema.js` so new columns stay append-only like the Sheets tabs.

### The function `api`
- `supabase/functions/api/index.ts`: handles `OPTIONS` (CORS), `GET` (health: service + version), `POST` (the API).
- `supabase/functions/_shared/`: `core.js`, `costing.js`, `pricing.js` copied by `tools/build_backend.py` (extended), loaded for their globals.
- `pgStore.js` (shared, plain JS so Node tests can use it):
  - `snapshot(sql, tables)` → loads rows, converts types back to what Sheets gave core (numbers as numbers, booleans as booleans, null → `''`).
  - `memStore(snapshot)` → the same interface as the test `memDb` (`read/append/updateWhere/removeWhere/lock`) plus `changes()`: appended rows, updated rows (by primary key, final values), removed keys.
  - `flush(sql, changes)` → inserts, updates, deletes in order, inside the open transaction.
- Request flow: parse body → decide read or write by action (core exposes its action table's `write` flag) → `BEGIN` → write: `pg_advisory_xact_lock(4242)` → snapshot all tables → `RestoCore.createApi({ db: memStore, sessions: pgSessions, uuid, now })` → `handle(req)` → if ok and writes happened: `flush` → `COMMIT` (or `ROLLBACK` on any error) → JSON reply.
- Sessions: `pgSessions` reads/writes the `sessions` table synchronously through the snapshot (loaded with the request; changes flushed like table writes); expired rows purged on login.
- Connection: `SUPABASE_DB_URL` (provided to Edge Functions automatically), `npm:postgres` driver, pooled connection.
- Deployed with JWT verification off (`--no-verify-jwt`): the app authenticates with its own session token, exactly as today.

### Performance
- First version loads all tables per request (like Sheets, but ~10–50× faster in the same region). Expected 150–400 ms per call for a year of data.
- Phase 2 (Task 8): a **table manifest** per action, recorded automatically by running the test suite with a tracing store; the function loads only those tables. Reports stay correct because the manifest is generated, not hand-written.
- Later (not in this plan): SQL-side date windows for report actions once Sales passes ~100k rows.

### App changes
- `config.js`: `apiUrl` → `https://<project-ref>.supabase.co/functions/v1/api`.
- Sign-in screen help text: "server address" instead of "Apps Script URL".
- `api.js` unchanged (same body, same `text/plain`).

### Backups and operations
- Pro plan (≈ US$25/month): daily backups, no pausing. Free plan only for the trial (pauses after 7 days idle).
- `docs/SUPABASE.md`: create project (Singapore), CLI login/link, `db push`, `functions deploy api --no-verify-jwt`, first owner (`setup` action run once via a one-off script that prints the temporary password), how to reset the owner password, how to roll back to Apps Script (change `config.js`).

## Testing
- All 142 existing tests keep running against `memDb` (unchanged).
- New Node tests run the **same API through `memStore`+`flush` against PGlite** (Postgres compiled to WebAssembly, `npm:@electric-sql/pglite`, no Docker): migrations apply cleanly; initialize; a write action round-trips; a failing action writes nothing; types survive (numbers, booleans, blank cells, dates); idempotent `requestId` retry; session expiry.
- A parity test runs a scripted day (the demo seed's actions) through both `memDb` and PGlite and compares every table.
- Deployed smoke test: `GET` health, sign-in, `bootstrap`, one save, reading it back.

## Decided by the owner
- Move to Supabase now (2026-11-14), before real data.

## My calls (owner can override)
- Keep the app's own login rather than Supabase Auth (no user re-creation, no UI change).
- Keep Apps Script code as a fallback for a month.
- Nightly copy to Google Sheets is optional (Task 10), off by default.
- Version 2.0.0, because the server changes.

## Left to the builder
- Exact numeric column list (start from `num(` usage in core; tests catch misses).
- Driver pool size and timeouts.
