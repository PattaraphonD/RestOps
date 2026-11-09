# Restaurant Ops: Developer Handover

**Version:** 1.2.0 (`VERSION` in `app/js/core.js`, `CACHE` in `app/sw.js`)
**Status (2026-11-07):** feature-complete v1. Tested end to end in demo mode in a browser at phone size, in English and Thai. **Not yet deployed or tested against a real Google Sheet / Apps Script.** No git commits yet.

This document is for the developer taking over the project. For end-user setup, see [README.md](../README.md).

---

## 1. What the app is

A phone app for a restaurant's back office:

| Area | What users do |
|---|---|
| Stock | Log purchases (stock in), usage, waste (reason required), stock counts, adjustments. See levels, value, low-stock alerts. |
| Recipe costing | Each dish has a recipe (ingredients per portion). Shows food cost, food cost %, margin, and the price needed to hit the target %. A sale deducts the recipe from stock. |
| Sales | Daily entry per dish and per channel (Dine-in / Takeaway / Delivery). |
| Expenses | Rent, wages, utilities and so on. |
| Reports | Dashboard: revenue, today's sales, food cost % vs target, net profit, stock value, daily cash flow chart, top sellers, monthly P&L, 6-month summary. |
| Purchasing | Reorder suggestions → purchase orders → send (LINE/email/SMS/print) → receive deliveries against the PO → supplier invoices with 3-way matching → approve/dispute → pay; payables view. |
| Team | Owner / Manager / Staff roles and logins. |
| Languages | English and Thai, chosen per phone. |

**Users:** owner, managers and kitchen/floor staff of a single restaurant, mostly on phones.

---

## 2. Architecture

```
 Phone (PWA, static files on Netlify)
   │  POST { action, token, payload, lang }   (Content-Type: text/plain → no CORS preflight)
   ▼
 Google Apps Script web app  (backend/Server.gs + backend/Core.gs)
   │  LockService for every write · CacheService for sessions
   ▼
 Google Spreadsheet  (one tab per table)
```

**Why it's built this way (keep these decisions unless there's a strong reason):**

1. **The app never talks to Google Sheets directly.** That would put Google credentials on phones. Apps Script is the only thing with sheet access.
2. **One business-logic file shared by server and demo.** `app/js/core.js` contains every rule: validation, stock maths, costing, reports, auth. Apps Script runs it as `Core.gs`, and the browser's demo mode runs the *same file* against localStorage. The demo is therefore a faithful test bed for the server logic.
   - ⚠️ `backend/Core.gs` is **generated**. Edit `app/js/core.js`, then run `python tools/build_backend.py`.
   - `core.js` must stay **plain ES5-compatible JS** with no DOM and no Google APIs. Everything environment-specific comes in through the `env` object (`db`, `sessions`, `uuid`, `now`).
3. **No build step, no framework.** The frontend is vanilla JS with ES modules, so any static host works. Don't add a bundler without a reason.
4. **Append-only ledgers.** Stock, sales, purchases and expenses are never edited or deleted. Mistakes are **voided** (`voided = TRUE`). This gives a full audit trail, and two people logging at the same time can't overwrite each other.
5. **Optimistic concurrency for shared records.** Ingredients, suppliers, menu items and users carry a `version` number. A save with a stale version fails with `CONFLICT` instead of silently overwriting.
6. **Every write is serialized** with `LockService.getScriptLock()` (25 s wait). Data is re-read inside the lock.

---

## 3. Repository map

```
app/                         ← deployable PWA (upload THIS folder to Netlify)
  index.html                 shell; loads config.js, core.js, then js/app.js (module)
  config.js                  RESTO_CONFIG.apiUrl, the Apps Script /exec URL (optional)
  manifest.webmanifest       PWA manifest
  sw.js                      service worker: network-first, offline fallback to cache
  _headers                   Netlify headers (CSP, no-cache for code)
  css/app.css                design system (tokens, light/dark, components)
  icons/                     PNG + SVG icons (regenerate: tools/make_icons.py)
  js/core.js                 ★ ALL business rules + schema (shared with server)
  js/api.js                  API client: remote (fetch) or demo transport; session storage
  js/demo.js                 demo backend (core.js + localStorage) and sample-data seeder
  js/i18n.js                 English + Thai dictionaries, default lists, t(), locale()
  js/app.js                  shell: routing, nav, login screen, language switch, state
  js/ui.js                   html`` (auto-escaping templates), formatting, icons, sheets, toasts
  js/charts.js               SVG charts: cash-flow (in/out bars), bar list
  js/views/home.js           dashboard (manager+) / today view (staff)
  js/views/stock.js          levels, history, stock-in/usage/waste/count forms, ingredient editor
  js/views/sales.js          daily sales, entry sheet, voids
  js/views/menu.js           dishes, recipe editor with live costing
  js/views/more.js           expenses, suppliers, team, settings, account, install help
backend/                     ← Google Apps Script project
  Server.gs                  doPost/doGet, Sheets storage, locks, sessions, setup()
  Core.gs                    GENERATED copy of app/js/core.js
  appsscript.json            manifest (timezone Asia/Bangkok, V8, web app settings)
tools/
  serve.py                   local preview server (http://localhost:5173)
  build_backend.py           core.js → backend/Core.gs
  check_i18n.py              fails if any text key is missing in EN or TH
  make_icons.py              regenerates PNG icons (stdlib only)
docs/HANDOVER.md             this file
README.md                    user-facing setup guide
```

About 4,500 lines of code. No external runtime dependencies.

---

## 4. Data model (Google Sheet tabs)

Defined in `SCHEMA` in `core.js`. **Column order = sheet column order.** `setup()` creates the tabs and refuses to touch a tab whose headers differ.

| Tab | Columns | Notes |
|---|---|---|
| **Settings** | key, value, updatedAt, updatedBy | Key/value pairs (see below) |
| **Users** | id, username, displayName, role, passwordHash, salt, active, createdAt, updatedAt, updatedBy, version | role ∈ owner/manager/staff |
| **Suppliers** | id, name, contactName, phone, email, notes, active, createdAt, updatedAt, updatedBy, version | |
| **Ingredients** | id, name, category, unit, costPerUnit, minLevel, supplierId, active, createdAt, updatedAt, updatedBy, version | `costPerUnit` is updated by purchases |
| **Purchases** | id, date, supplierId, ingredientId, qty, unitCost, total, invoiceRef, note, voided, createdAt, createdBy | Stock **in**; one row per line |
| **StockMovements** | id, date, ingredientId, type, qty, unitCost, value, reason, refId, voided, createdAt, createdBy | Everything except purchases |
| **Menu** | id, name, category, price, active, createdAt, updatedAt, updatedBy, version | |
| **Recipes** | id, menuItemId, ingredientId, qty, note | Replaced as a whole on each `menu.save` |
| **Sales** | id, date, menuItemId, itemName, qty, unitPrice, total, unitCost, costTotal, channel, note, voided, createdAt, createdBy | `unitCost` is a **snapshot** of the dish cost at the time of sale |
| **Expenses** | id, date, category, description, amount, paymentMethod, note, voided, createdAt, createdBy | |
| **PurchaseOrders** | id, poNumber, supplierId, status, orderDate, expectedDate, note, total, sentAt, sentBy, closedAt, closedBy, closeReason, createdAt, createdBy, updatedAt, updatedBy, version | status: draft → sent → partial → received; or closed (short) / cancelled |
| **PurchaseOrderLines** | id, poId, ingredientId, qtyOrdered, unitPrice, note | Replaced as a whole while the PO is a draft |
| **SupplierInvoices** | id, invoiceNo, supplierId, poId, invoiceDate, dueDate, subtotal, vat, total, status, exceptionCount, varianceAmount, reviewNote, reviewedAt, reviewedBy, paidAt, paidBy, paymentMethod, paymentRef, note, createdAt, createdBy, updatedAt, updatedBy, version | status: matched / exception / noPo → approved / disputed → paid |
| **SupplierInvoiceLines** | id, invoiceId, ingredientId, qty, unitPrice, total | |

**Columns added in v1.2 (appended, so old sheets upgrade in place):** Suppliers `leadTimeDays`, `paymentTermsDays`; Ingredients `parLevel`; Purchases `poId`, `poLineId`. `Server.gs` → `prepareTab_()` adds missing tabs and columns automatically on first use (and in `setup()`). It refuses to touch a tab whose existing headers differ.

**Quantity received is never stored on the PO.** It is always the sum of non-voided `Purchases` rows with that `poLineId`. Voiding a receipt re-opens the order (`refreshPoStatus`).

**StockMovements.type and sign convention** (`qty` is signed; negative reduces stock):

| type | qty | Created by |
|---|---|---|
| `usage` | negative | staff, for staff meals, testing and so on |
| `waste` | negative | staff; reason required |
| `count` | counted − on hand (±) | stock count; zero-difference lines are skipped |
| `adjustment` | ± as entered | manager only |
| `sale` | −(recipe qty × dishes sold) | automatic on `sales.add`; `refId` = Sales.id; voided together with the sale |

**Conventions**
- IDs: `PREFIX-XXXXXXXXXX` (ING, SUP, PUR, MOV, MENU, REC, SAL, EXP, USR).
- Dates are `YYYY-MM-DD` text; timestamps are ISO-8601 text. `TEXT_COLUMNS` are formatted as plain text by `setup()` so Sheets doesn't convert them. `Server.gs` also converts any `Date` cells back on read.
- Booleans are `TRUE`/`FALSE`. Read them with `bool()` in core.

**Settings keys:** `restaurantName`, `currency` (ISO code, default THB), `costMethod` (`average` | `last`), `targetFoodCostPct` (default 30), `salesChannels`, `expenseCategories`, `ingredientCategories`, `menuCategories`, `units` (comma-separated lists), and `locale` (legacy, unused; formatting now follows the app language).

> Staff may look at the spreadsheet, but **editing rows by hand bypasses validation, locking and versioning**. Treat the sheet as read-only, except for emergency fixes by a developer.

---

## 5. Business rules and formulas

**Purchasing**
- **Reorder:** suggest when onHand + onOrder ≤ minLevel. Quantity = par − onHand − onOrder, where par = parLevel, or 2 × minLevel if unset. onOrder = ordered − received on draft/sent/partial POs.
- **3-way match** (`matchInvoice` in core), per ingredient on the PO:
  - `overBilled` / `notReceived`: (this invoice + earlier non-disputed invoices) > received
  - `priceUp`: invoice price exceeds the PO price by more than `priceTolerancePct`; `priceDown` is informational
  - `notOrdered`: line isn't on the PO
  - `notBilled`: received but not billed yet (informational)
  - `totalMismatch`: |total − (Σ lines + VAT)| > 1
  - `varianceAmount` = Σ over-billing + price increases + any positive total difference. Any exception → status `exception`. No PO → `noPo`.
- Editing an invoice re-runs the match and clears any previous approval or dispute.
- **Payables** (`payablesSummary`): unpaid = matched + approved; overdue = unpaid with dueDate < today; due soon = within 7 days.
- Supplier payments do **not** create expenses (ingredient cost is recognised at receipt). Cash flow still counts purchases on the receipt date.

**Stock and P&L**

- **Stock on hand** = Σ Purchases.qty + Σ StockMovements.qty (non-voided).
- **Status:** `out` if on hand ≤ 0; `low` if ≤ minLevel; otherwise `ok`.
- **Ingredient cost** on each purchase:
  - `average` (default): (onHand × oldCost + qty × unitCost) / (onHand + qty). Falls back to the purchase price if on hand ≤ 0.
  - `last`: unitCost.
- **Dish food cost** = Σ(recipe qty × ingredient costPerUnit). **Food cost %** = cost / price.
- **Reports (`reports.summary`)** for a month:
  - Revenue = Σ Sales.total
  - COGS = Σ Sales.costTotal (the snapshot)
  - Waste & variance = −Σ value of `waste`, `count`, `adjustment` movements
  - Gross profit (shown) = Revenue − COGS − Waste & variance
  - Net profit = Gross − Expenses
  - Food cost % = (COGS + Waste & variance) / Revenue
  - Purchases are **not** a P&L cost (they're inventory). They appear in **cash flow** only: money out = purchases + expenses.
  - Month-to-date is compared with **the same days of the previous month**.

---

## 6. API

Single endpoint: `POST <web-app URL>` with body `{ "action", "token", "payload", "lang" }`.
Response: `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. `lang: "th"` returns Thai error messages. `GET` returns a health check.

| Action | Min role | Write | Payload (main fields) |
|---|---|---|---|
| `auth.login` | none | ✓ | username, password → `{ token, user }` |
| `auth.logout` | staff | | none |
| `auth.changePassword` | staff | ✓ | current, next |
| `bootstrap` | staff | | none → user, settings, ingredients (with stock), suppliers, menu (with cost and recipe), users (owner only) |
| `stock.levels` | staff | | none |
| `purchases.add` | staff | ✓ | date, supplierId?, invoiceRef?, note?, lines[{ingredientId, qty, unitCost}] (max 60) |
| `purchases.list` | staff | | from?, to?, ingredientId?, limit? |
| `purchases.void` | manager | ✓ | id |
| `movements.add` | staff (adjustment: manager) | ✓ | date, type, reason, lines[{ingredientId, qty}] |
| `movements.list` | staff | | from?, to?, type?, ingredientId?, includeSales?, limit? |
| `movements.void` | manager | ✓ | id (not for `sale` rows) |
| `ingredients.save` | manager | ✓ | item {id?, version?, name, unit, category, costPerUnit, minLevel, supplierId, active} |
| `suppliers.save` | manager | ✓ | item {id?, version?, name, contactName, phone, email, notes, active} |
| `menu.save` | manager | ✓ | item {id?, version?, name, price, category, active}, recipe[{ingredientId, qty}] |
| `sales.add` | staff | ✓ | date, channel, lines[{menuItemId, qty, unitPrice?}] → also writes `sale` movements |
| `sales.list` | staff | | from, to |
| `sales.void` | manager | ✓ | id (also voids its movements) |
| `expenses.add` / `.list` / `.void` | manager | ✓ / – / ✓ | date, category, amount, description, paymentMethod, note |
| `po.suggestions` | manager | | none → groups by supplier with suggested quantities |
| `po.list` / `po.get` | staff | | status (open/awaiting/draft/done/all/…), supplierId / id → PO with lines, receipts, invoices |
| `po.save` | manager | ✓ | item {id?, version?, supplierId, orderDate, expectedDate?, note}, lines[{ingredientId, qtyOrdered, unitPrice}], send? (drafts only) |
| `po.send` / `po.cancel` / `po.close` | manager | ✓ | id, reason? (cancel only without receipts; close only sent/partial) |
| `po.receive` | staff | ✓ | poId, date, deliveryRef, note, lines[{poLineId, qty, unitPrice}] → stock-in rows + status |
| `invoices.save` | manager | ✓ | item {id?, version?, supplierId, poId?, invoiceNo, invoiceDate, dueDate?, vat?, total?, note}, lines[{ingredientId, qty, unitPrice}] → invoice + match |
| `invoices.list` / `invoices.get` | manager | | status (review/unpaid/disputed/paid/all), today / id → rows + payables summary / invoice + match |
| `invoices.approve` / `.dispute` | manager | ✓ | id, note (required for exceptions and disputes) |
| `invoices.pay` | manager | ✓ | id, date, method, reference (matched/approved only) |
| `reports.summary` | manager | | month (YYYY-MM), today |
| `users.save` | owner | ✓ | item {id?, version?, username, displayName, role, active, password?}; at least one active owner is enforced |
| `settings.save` | owner | ✓ | values {key: value} |

**Retry protection:** any write may include `requestId`. The server caches the result for 1 hour under `rq:<userId>:<requestId>`, inside the write lock, and returns it for repeats. The app creates one ID per form, so tapping Save again after a timeout doesn't record a second delivery, invoice or payment.

**Error codes:** `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `AUTH` (the client signs out), `LOCKED`, `FORBIDDEN`, `BAD_REQUEST`, `BUSY` (lock timeout), `SERVER`. The client adds `NETWORK` and `CONFIG`.

**Adding a feature, end to end:**
1. Add the action to `A[...]` in `core.js`, with its role and whether it writes.
2. If it needs a new tab or column, update `SCHEMA` and re-run `setup()`. **Append new columns at the end.**
3. Add Thai translations of any new error messages to `TH_RULES` in `core.js`.
4. Build the UI in `app/js/views/*`, and add text keys to **both** dictionaries in `i18n.js`.
5. Run `python tools/build_backend.py` and `python tools/check_i18n.py`.
6. Test in demo mode, then paste `Core.gs` into Apps Script and deploy a new version.

---

## 7. Security

- **Passwords:** salted and hashed with 500 rounds of SHA-256 (pure JS in core, so the server and the demo behave identically). Never stored in plain text.
- **Sessions:** a random 64-hex token in Apps Script `CacheService`, valid for 6 hours after the last request (sliding). The client keeps the token in `localStorage`.
- **Brute force:** 5 failed logins lock that username for 10 minutes.
- **Roles** are checked on the server for every action. The UI hiding buttons is a convenience, not the protection.
- **XSS:** all HTML comes from the `html` template tag in `ui.js`, which escapes every interpolated value. Avoid `innerHTML` with raw strings; `raw()` is used only for constant markup.
- **Web app access** is "Anyone" (required for phones). The API rejects every call without a valid session token, except `auth.login` and the GET health check.
- **Netlify `_headers`:** a CSP that allows only `self` plus `script.google.com` / `script.googleusercontent.com`, plus `nosniff` and `frame-ancestors 'none'`.
- Owner locked out? Run `resetOwnerPassword()` in the Apps Script editor; the new password appears in the log.

---

## 8. Frontend notes

- **Routing:** hash routes such as `#/home`, `#/stock`, `#/sales`, `#/menu`, `#/more/expenses`. Deep links open forms: `#/stock/purchase|usage|waste|count`, `#/stock/low`, `#/stock/item/<id>`, `#/sales/new`, `#/more/expenses/new`.
- **State:** `state.boot` comes from `bootstrap`. After each successful write, a view calls `ctx.refresh()` and then re-renders itself. `ctx.stale()` guards against a slow response drawing into a screen the user has left.
- **Bottom sheets** (`openSheet`) push a history entry, so the Android back button closes the sheet.
- **Charts** are hand-built SVG with hover/tap tooltips. The colours come from a colour-blind-checked palette (`--series-1`, `--series-2`).
- **Offline:** the service worker caches the app shell (network-first). Reading cached screens works offline; **saving requires a connection**, and there is no offline queue.
- **Theme:** light, dark, or follow the system (`ro.theme` in localStorage).
- **i18n:** `t(key, vars)` in `i18n.js`. Values are strings with `{var}` or functions (for English plurals). Thai mode formats with `th-TH` (Buddhist-era years). User data is stored exactly as typed. Server errors are translated in `core.js` (`translate()`).

**localStorage keys:** `ro.token`, `ro.user`, `ro.apiUrl`, `ro.mode` (`remote` | `demo`), `ro.lang`, `ro.theme`, `ro.demo.db.v1`.

---

## 9. Local development

```bash
python tools/serve.py
```

Open http://localhost:5173 and tap **Explore with demo data**. Demo accounts are `owner`, `manager` and `staff`, all with password `demo1234`. The sample data is seeded in the current language; **More → My account → Reset demo data** reseeds it.

Before every handover or release:

```bash
python tools/build_backend.py
```

```bash
python tools/check_i18n.py
```

There are **no automated tests yet** (see the backlog). Verification so far has been manual in the browser, plus scripted checks run through the browser console (hashing against WebCrypto, a conflict on concurrent edits, role permissions, stock deduction on sale, Thai error messages, no horizontal overflow at 375 px).

---

## 10. Deployment and release

| Piece | Where | How to update |
|---|---|---|
| Database | A Google Sheet in the owner's Google account | `setup()` / `setupThai()` adds missing tabs and is safe to re-run |
| API | Apps Script bound to that Sheet | Paste `Server.gs`, `Core.gs`, `appsscript.json` → **Deploy → Manage deployments → Edit → New version** (keeps the URL) |
| App | Netlify (drag the `app/` folder) | Site → **Deploys** → drag the `app/` folder again |

Release checklist:
1. Bump `VERSION` in `core.js` and `CACHE` in `sw.js`.
2. Run the two Python tools above.
3. Update Apps Script first, then the app.

The scope `spreadsheets.currentonly` requires the script to be **bound** to the sheet (Extensions → Apps Script). If you use a standalone script with `SPREADSHEET_ID`, change the scope to `.../auth/spreadsheets`.

---

## 11. Handover checklist (things that are NOT in the repo)

Collect these from the current owner and store them in the team's password manager, not in git:

- [ ] Google account that **owns** the Sheet and the Apps Script, plus the Sheet URL
- [ ] Apps Script **web-app URL** (`…/exec`) and deployment ID
- [ ] Netlify account / team and the site name and URL
- [ ] Owner login for the app (never commit it)
- [ ] A shared **git remote**. The repo currently has **no commits and no remote**: commit, push, and give the next developer access.
- [ ] The local preview entry lives in `Desktop/proj/.claude/launch.json` (named `restaurant-ops`). It's only needed for Claude Code previews; `tools/serve.py` works without it.

To move ownership: share the Sheet with the new owner and make them **Owner** (the bound script moves with it), have them create a **new deployment** under their account, and put the new URL in `app/config.js`.

---

## 12. Known limitations and risks

| # | Item | Impact | Suggested fix |
|---|---|---|---|
| 1 | **Not yet run against a real Sheet** | Apps Script-specific bugs are possible (cell formats, permissions, quotas) | First task: deploy to a test Sheet and run every flow |
| 2 | ~~No idempotency on writes~~ **Fixed in v1.2** for purchasing (`requestId`) | Sales, stock and expense forms don't send a `requestId` yet | Pass `{ requestId }` from those forms too (`newRequestId()` in `api.js`) |
| 3 | **Every request reads whole tabs** | Gets slower as StockMovements grows (each sale line writes several rows). Fine for roughly the first year. | Yearly archive plus opening count, or a cached `StockLevels` tab |
| 4 | **No automated tests** | Regressions possible | `core.js` runs in Node (`module.exports`). Add unit tests with an in-memory db, using the demo's `localDb` as a model. |
| 5 | **No offline queue** | Can't save without signal | Queue writes in IndexedDB with `requestId`s (needs #2) |
| 6 | Password hashing is SHA-256 ×500 | Weaker than bcrypt/argon2 if the Users tab leaks | Restrict sheet sharing; consider PBKDF2 with more rounds |
| 7 | Apps Script quotas | Consumer accounts have daily execution limits | Use a Google Workspace account for production |
| 8 | Single restaurant only | No multi-branch | Add `branchId` to ledgers and users |
| 9 | Sessions last 6 h | Staff sign in each shift | Acceptable; a "remember me" refresh token could extend it |

**Purchasing follow-ups:** credit notes (negative invoices) to settle disputes, adjusting ingredient cost when an approved invoice price differs from the receipt price, supplier price lists, and attaching a photo of the paper invoice.

**Suggested next features:** CSV/Excel export, per-supplier price history, dish-level sales trend, a recipe yield/waste factor, and a store app (Flutter/React Native can reuse the same API unchanged).
