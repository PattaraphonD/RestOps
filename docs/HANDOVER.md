# Restaurant Ops: Developer Handover

**Version:** 1.7.1 (`VERSION` in `app/js/core.js`, `CACHE` in `app/sw.js`)
**Status (2026-11-14):** feature-complete v1. **v1.6.1:** Thai only — the English text and the language switch were removed. **v1.7.0 — daily journeys** (see `docs/ux/2026-11-14-user-journeys.md`): Home is a Today screen with tasks per role and a setup checklist; a close-the-day routine; sales for all channels in one entry; ingredient search and recent items; kitchen mode for SOPs; a wide-screen layout (left rail ≥ 900 px); a printable monthly report; five tabs (วันนี้ · สต็อก · เมนู · ยอดขาย · เพิ่มเติม, with Orders under More). **Upgrading to v1.7.0: redeploy the Apps Script backend** (new actions `today.summary`, `day.close`, `day.status`; the DayCloses tab is created on first use). Until then Home still loads, without the Today card. **v1.7.1 — palette theme:** teal #439093 · coral #F09B93 · cream #F9EBD9 · blush #EBD6D7 · yellow #E9DD8A, with deeper shades where text sits on a colour (all AA); roles and contrast in `docs/superpowers/specs/2026-11-14-palette-theme-design.md`. Colours live only in the tokens at the top of `app/css/app.css` (light and dark). **Layer 1 (v1.3) — costing foundation:** units and conversions, yield (trim loss), prep items (sub-recipes), production runs, cost history and cost impact alerts. **Layer 2 (v1.4) — channel pricing and menu analysis:** sales channels as records with commission and packaging, a price per channel, commission on every sale and in the P&L, suggested prices, menu engineering and a Needs attention card. Layer 2 screens were checked by script in demo mode in English and Thai; their phone-width layout still needs a visual check. **Layer 3 (v1.5) — promotions:** a builder with a live profit check, a delivery-app offer check with a counter-offer, promo lines in sales entry (per dish, bundles, buy-X-get-Y) and results against the previous 4 weeks. Checked the same way; phone-width layout not yet checked by eye. **Layer 4 (v1.6) — SOP manuals:** step-by-step procedures for dishes and preps built from their recipes, quantities scaled by portions or batches, allergens derived from ingredients, critical food-safety steps, print (one SOP per page or the whole manual) and share. Tested end to end in demo mode in a browser at phone size, in English and Thai. **Deployed:** app on Vercel at https://restops-app.vercel.app/ (Root Directory `app`), API URL set in `app/config.js`. A full run of every flow against the real Google Sheet / Apps Script has not been recorded yet. The code is in a local git repository with no shared remote yet.

This document is for the developer taking over the project. For end-user setup, see [README.md](../README.md).

---

## 1. What the app is

A phone app for a restaurant's back office:

| Area | What users do |
|---|---|
| Stock | Log purchases (stock in), usage, waste (reason required), stock counts, adjustments. See levels, value, low-stock alerts. |
| Recipe costing | Each dish has a recipe (ingredients per portion, in any unit that converts, e.g. grams for an ingredient bought by the kg). Recipes use the usable amount; the ingredient's yield adds the trim loss. Shows food cost, food cost %, margin, the share of each line, and the price needed to hit the target %. A sale deducts the recipe from stock. |
| Preps and production | Sauces, stocks and pastes made in the kitchen are prep items with their own recipe and batch size. Their cost follows their ingredients. Each batch made is a production run: ingredients out, prep in, real yield and cost. Each ingredient keeps a cost history; a delivery that moves costs shows which dishes it affects. |
| Sales | Daily entry per dish and per channel (Dine-in / Takeaway / Delivery). |
| Expenses | Rent, wages, utilities and so on. |
| Reports | Dashboard: revenue, today's sales, food cost % vs target, net profit, stock value, daily cash flow chart, top sellers, monthly P&L, 6-month summary. |
| Purchasing | Reorder suggestions → purchase orders → send (LINE/email/SMS/print) → receive deliveries against the PO → supplier invoices with 3-way matching → approve/dispute → pay; payables view. |
| Team | Owner / Manager / Staff roles and logins. |
| Language | Thai only (no language switch since v1.6.1). |

**Users:** owner, managers and kitchen/floor staff of a single restaurant, mostly on phones.

---

## 2. Architecture

```
 Phone (PWA, static files on Vercel)
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
app/                         ← deployable PWA (Vercel Root Directory = this folder)
  index.html                 shell; loads config.js, costing.js, pricing.js, core.js, then js/app.js (module)
  config.js                  RESTO_CONFIG.apiUrl, the Apps Script /exec URL (optional)
  manifest.webmanifest       PWA manifest
  sw.js                      service worker: network-first, offline fallback to cache
  vercel.json                Vercel headers (CSP, no-cache for code)
  _headers                   same headers for Netlify (unused on Vercel; keep the two in sync)
  css/app.css                design system (tokens, light/dark, components)
  icons/                     PNG + SVG icons (regenerate: tools/make_icons.py)
  js/core.js                 ★ ALL business rules + schema (shared with server)
  js/costing.js              pure costing maths: units, conversion, yield, prep costs, explode, run cost (shared with server)
  js/pricing.js              pure pricing maths: price rounding, channel economics, menu engineering (shared with server)
  js/api.js                  API client: remote (fetch) or demo transport; session storage
  js/demo.js                 demo backend (core.js + localStorage) and sample-data seeder
  js/i18n.js                 Thai dictionary, default lists, t(), locale() (always th-TH)
  js/app.js                  shell: routing, nav (bottom bar; left rail ≥ 900 px), login screen, state
  js/views/close.js          close the day: sales (all channels) → waste → count key items → close
  js/ui.js                   html`` (auto-escaping templates), formatting, icons, sheets, toasts
  js/charts.js               SVG charts: cash-flow (in/out bars), bar list
  js/views/home.js           dashboard (manager+) / today view (staff)
  js/views/stock.js          levels, history, stock-in/usage/waste/count forms, ingredient editor
  js/views/sales.js          daily sales, entry sheet, voids
  js/views/menu.js           Menu hub: Dishes | Preps, dish editor with live costing
  js/views/recipe-lines.js   shared recipe-line editor (dishes and preps): unit picker, yield, line cost
  js/views/production.js     Produce batch sheet and the production log (#/more/production)
  js/views/purchasing.js     orders, receiving, supplier invoices, payables
  js/views/more.js           expenses, suppliers, team, settings, account, install help
backend/                     ← Google Apps Script project
  Server.gs                  doPost/doGet, Sheets storage, locks, sessions, setup()
  Core.gs                    GENERATED copy of app/js/core.js
  Costing.gs                 GENERATED copy of app/js/costing.js
  Pricing.gs                 GENERATED copy of app/js/pricing.js
  appsscript.json            manifest (timezone Asia/Bangkok, V8, web app settings)
tools/
  serve.py                   local preview server (http://localhost:5173)
  build_backend.py           core.js → Core.gs, costing.js → Costing.gs, pricing.js → Pricing.gs (in backend/)
  test_core.js               test runner for core.js + costing.js (node tools/test_core.js)
  tests/*.test.js            the tests, against an in-memory db
  check_i18n.py              fails if any text key used in the app is missing
  make_icons.py              regenerates PNG icons (stdlib only)
docs/HANDOVER.md             this file
README.md                    user-facing setup guide
```

About 6,000 lines of code. No external runtime dependencies.

---

## 4. Data model (Google Sheet tabs)

Defined in `SCHEMA` in `core.js`. **Column order = sheet column order.** `setup()` creates the tabs and refuses to touch a tab whose headers differ.

| Tab | Columns | Notes |
|---|---|---|
| **Settings** | key, value, updatedAt, updatedBy | Key/value pairs (see below) |
| **Users** | id, username, displayName, role, passwordHash, salt, active, createdAt, updatedAt, updatedBy, version | role ∈ owner/manager/staff |
| **Suppliers** | id, name, contactName, phone, email, notes, active, createdAt, updatedAt, updatedBy, version | |
| **Ingredients** | id, name, category, unit, costPerUnit, minLevel, supplierId, active, createdAt, updatedAt, updatedBy, version, parLevel, yieldPct, kind, batchQty, trackStock, shelfLifeDays | `costPerUnit` is updated by purchases (raw) or recomputed from the recipe (prep). kind ∈ raw/prep (blank = raw) |
| **IngredientUnits** | id, ingredientId, unit, factor | Other units: 1 `unit` = `factor` × stock unit. Replaced as a whole on each `ingredients.save` |
| **PrepRecipes** | id, prepId, ingredientId, qty, unit, yieldPct, note | Lines of a prep (raw items or other preps). Replaced as a whole on each `ingredients.save` |
| **CostChanges** | id, date, ingredientId, oldCost, newCost, source, refId, createdAt, createdBy | One row each time a cost moves. source ∈ purchase/prep/manual |
| **ProductionRuns** | id, runNo, date, prepId, batches, expectedQty, producedQty, unit, inputCost, byproductValue, totalCost, unitCost, yieldPct, producedBy, note, voided, createdAt, createdBy | One row per batch made. `runNo` is PR-0001, PR-0002 … `producedBy` is who cooked it |
| **Purchases** | id, date, supplierId, ingredientId, qty, unitCost, total, invoiceRef, note, voided, createdAt, createdBy | Stock **in**; one row per line |
| **StockMovements** | id, date, ingredientId, type, qty, unitCost, value, reason, refId, voided, createdAt, createdBy | Everything except purchases |
| **Menu** | id, name, category, price, active, createdAt, updatedAt, updatedBy, version | |
| **Recipes** | id, menuItemId, ingredientId, qty, note, unit, yieldPct | Replaced as a whole on each `menu.save`. `qty` is the net (usable) amount. Blank unit = the ingredient's unit; blank yield = the ingredient's yield |
| **Sales** | id, date, menuItemId, itemName, qty, unitPrice, total, unitCost, costTotal, channel, note, voided, createdAt, createdBy, channelId, commission, promoId, listPrice, discount, platformDiscount | `unitCost` is a **snapshot** of the dish cost at the time of sale. `unitPrice`/`total` = what the restaurant is credited before commission. `commission` is a snapshot. `promoId`/`discount`/`platformDiscount` are for promotions (Layer 3; 0 / blank until then). Older rows have only `channel` (a name) |
| **Channels** | id, name, type, commissionPct, packagingCost, commissionOnDiscounted, active, sortOrder, createdAt, updatedAt, updatedBy, version | type: dineIn / takeaway / delivery / other. Created from the old `salesChannels` setting on first use |
| **MenuPrices** | id, menuItemId, channelId, price | A dish's price on one channel; no row = the dish's own price |
| **Promotions** | id, name, type, value, channelIds, startDate, endDate, weekdays, platformFundedPct, campaignCommissionPct, status, note, createdAt, createdBy, updatedAt, updatedBy, version | type: percentOff / amountOff / fixedPrice / bundle / buyXGetY (value "2+1"). Stored status: draft / scheduled / cancelled; shown as scheduled / active / ended by date. Blank channelIds or weekdays = all |
| **PromotionItems** | id, promoId, menuItemId, qty | The dishes a promotion covers (qty only matters for bundles) |
| **SopSteps** | id, ownerId, stepNo, text, minutes, imageUrl, critical | Steps of a dish's or prep's SOP; replaced as a whole on each `sop.save` |
| **DayCloses** | id, date, closedBy, closedAt, salesTotal, wasteValue, countLines, note | One row per closed trading day; closing again updates the row |
| **Expenses** | id, date, category, description, amount, paymentMethod, note, voided, createdAt, createdBy | |
| **PurchaseOrders** | id, poNumber, supplierId, status, orderDate, expectedDate, note, total, sentAt, sentBy, closedAt, closedBy, closeReason, createdAt, createdBy, updatedAt, updatedBy, version | status: draft → sent → partial → received; or closed (short) / cancelled |
| **PurchaseOrderLines** | id, poId, ingredientId, qtyOrdered, unitPrice, note | Replaced as a whole while the PO is a draft |
| **SupplierInvoices** | id, invoiceNo, supplierId, poId, invoiceDate, dueDate, subtotal, vat, total, status, exceptionCount, varianceAmount, reviewNote, reviewedAt, reviewedBy, paidAt, paidBy, paymentMethod, paymentRef, note, createdAt, createdBy, updatedAt, updatedBy, version | status: matched / exception / noPo → approved / disputed → paid |
| **SupplierInvoiceLines** | id, invoiceId, ingredientId, qty, unitPrice, total | |

**Columns added in v1.2 (appended, so old sheets upgrade in place):** Suppliers `leadTimeDays`, `paymentTermsDays`; Ingredients `parLevel`; Purchases `poId`, `poLineId`. **Added in v1.3:** Ingredients `yieldPct`, `kind`, `batchQty`, `trackStock`, `shelfLifeDays`; Recipes `unit`, `yieldPct`; new tabs IngredientUnits, PrepRecipes, CostChanges, ProductionRuns. **Added in v1.4:** Sales `channelId`, `commission`, `promoId`, `listPrice`, `discount`, `platformDiscount`; new tabs Channels, MenuPrices. **Added in v1.5:** new tabs Promotions, PromotionItems. **Added in v1.6:** Ingredients `portionNote`, `holdingNote`, `equipment`, `prepMinutes`, `allergens` (csv of codes), `photoUrl`; Menu `portionNote`, `holdingNote`, `equipment`, `prepMinutes`, `photoUrl`; new tab SopSteps. `Server.gs` → `prepareTab_()` adds missing tabs and columns automatically on first use (and in `setup()`). It refuses to touch a tab whose existing headers differ.

**Quantity received is never stored on the PO.** It is always the sum of non-voided `Purchases` rows with that `poLineId`. Voiding a receipt re-opens the order (`refreshPoStatus`).

**StockMovements.type and sign convention** (`qty` is signed; negative reduces stock):

| type | qty | Created by |
|---|---|---|
| `usage` | negative | staff, for staff meals, testing and so on |
| `waste` | negative | staff; reason required |
| `count` | counted − on hand (±) | stock count; zero-difference lines are skipped |
| `adjustment` | ± as entered | manager only |
| `sale` | −(gross recipe qty × dishes sold) | automatic on `sales.add`; `refId` = Sales.id; voided together with the sale. A prep not kept in stock is replaced by its own ingredients |
| `production` | negative | automatic on `production.add`: each ingredient used (gross); `refId` = run id |
| `produce` | positive | the prep made, valued at the run's actual unit cost |
| `byproduct` | positive | something useful left over (e.g. chicken fat from stock), valued at its cost |

**Conventions**
- IDs: `PREFIX-XXXXXXXXXX` (ING, SUP, PUR, MOV, MENU, REC, SAL, EXP, USR, IUN, PRL, CST, RUN, CHN, MPR, PRM, PRI, SOP, DAY).
- Units in recipe, prep and conversion lines are stored as a unit code (`g`, `kg`, `ml`, `l`, `pcs` …) when the text is a known unit or alias, otherwise as typed. An ingredient's own stock unit is stored as typed (`กก.` in Thai).
- Dates are `YYYY-MM-DD` text; timestamps are ISO-8601 text. `TEXT_COLUMNS` are formatted as plain text by `setup()` so Sheets doesn't convert them. `Server.gs` also converts any `Date` cells back on read.
- Booleans are `TRUE`/`FALSE`. Read them with `bool()` in core.

**Settings keys:** `restaurantName`, `currency` (ISO code, default THB), `costMethod` (`average` | `last`), `targetFoodCostPct` (default 30), `priceRounding` (blank = by currency, or `none | 1 | 5 | 10 | 0.99 | 9-ending`), `salesChannels` (only read once, to create the Channels rows), `expenseCategories`, `ingredientCategories`, `menuCategories`, `units` (comma-separated lists), and `locale` (legacy, unused; formatting now follows the app language).

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
- **Status:** `out` if on hand ≤ 0; `low` if ≤ minLevel; otherwise `ok`. A prep not kept in stock is always `ok`.
- **Ingredient cost** on each purchase:
  - `average` (default): (onHand × oldCost + qty × unitCost) / (onHand + qty). Falls back to the purchase price if on hand ≤ 0.
  - `last`: unitCost.
- **Dish food cost** = Σ line cost (below). **Food cost %** = cost / price.

**Costing (v1.3, maths in `costing.js`)**

- **Units:** a built-in catalogue in three families: mass (`mg, g, kg, oz, lb`), volume (`ml, l, tsp, tbsp, cup, floz, pt, qt, gal`, US measures) and count (`pcs, dozen`). Aliases map free text to codes, ignoring case and a trailing dot (`กก.` → kg, `ลิตร` → l, `ฟอง` → pcs). Any other text (`bottle`, `ขวด`) is a custom unit of its own.
- **Conversion** (`convertQty`) into the ingredient's stock unit: same unit 1:1; same family by factor; otherwise through the ingredient's own conversions (`1 bottle = 0.7 L`, `1 g = 1/55 pcs` for eggs). If nothing fits, saving says "Can't convert … Add a conversion on the ingredient."
- **Yield:** `yieldPct` 1–1000 (blank = 100; above 100 for rice or beans that swell). Recipe quantities are **net** (usable). **Gross** = net ÷ (yield / 100). A recipe line may override the ingredient's yield.
- **Line cost** = gross qty in stock units × costPerUnit. Stock is deducted by the gross qty.
- **Prep cost per unit** = Σ line costs ÷ batchQty, recursive (preps can use preps, at most 4 levels deep; cycles are refused). It is the **theoretical** recipe cost: recomputed on prep save and whenever a purchase moves an ingredient inside it (a CostChanges row with source `prep`). Production runs never change it.
- **Prep kept in stock** (`trackStock` TRUE): a sale deducts the prep. **Made to order** (FALSE): a sale deducts the prep's own ingredients (`explode`).
- **Production run** (`runCost`): inputs default to recipe × batches (gross, converted), or what the cook entered. inputCost = Σ input qty × current cost; by-products are credited at their current cost; totalCost = inputCost − by-product value (not below 0); unitCost = totalCost ÷ producedQty; yieldPct = produced ÷ (batchQty × batches). Inputs that go below zero give a warning, not a block. Voiding a run voids all its movements; it does not roll back weighted-average costs.
- **Actual vs recipe:** the prep screen shows the mean unit cost of the last 5 runs next to the recipe cost.
- **Cost impact:** `purchases.add` and `po.receive` return which ingredients moved by 1 % or more and which active dishes now cost more or less, including dishes that use them through a prep.
**Channel pricing and analysis (v1.4, maths in `pricing.js`)**

- **Channels** are records. The first `bootstrap` (or any channel-aware action) turns the old comma-separated `salesChannels` setting into rows, guessing the type from the name. An older sale that stored only a channel name is matched to a channel by name when reports read it (`resolveChannel`); it is never rewritten.
- **Price on a channel** = the `MenuPrices` row, else the dish's own price. Sales entry uses it automatically.
- **Commission on a sale** = commissionPct × base × qty, where base = the price received if `commissionOnDiscounted`, else the list price. Stored on the row, so later rate changes don't alter history.
- **Channel economics** (`channelEconomics`): net revenue = price × (1 − commission %); margin (CM) = net − food cost − packaging; food cost % of net = food cost ÷ net. **Suggested price** = (food cost + packaging) ÷ (target % × (1 − commission %)), rounded **up** by `priceRounding` (auto: THB → 5; JPY/KRW/VND/IDR → 10; others → .99). Null when commission ≥ 100 %, target ≤ 0 or there is no food cost.
- **Food cost % stays on the menu price** in Menu, reports and the dashboard. Delivery profitability is shown as margin after commission.
- **Menu engineering** (`menuEngineering`, `menu.analysis`): per dish, CM = revenue − food cost − commission. Popular when menu mix % ≥ 70 % × (1 ÷ dishes sold); high margin when CM per dish ≥ the sales-weighted average. Star / Plowhorse / Puzzle / Dog. Promotion sales (`promoId` set) are left out unless asked. `indicative` when fewer than 5 dishes sold or under 14 days.
- **Needs attention** (`reports.summary.attention`): active dish × active channel pairs sold in the last 28 days that miss the target after commission; top 3 by (suggested − price) × qty.
**SOP manuals (v1.6)**

- **Allergens** are the 14 EU major allergens (`RestoCosting.ALLERGENS`). They are set only on ingredients; a prep's and a dish's allergens are derived from the recipe, recursively (`allergensFor`, cycle-safe).
- **SOP quantities** are the recipe's net amounts × portions (dish) or batches (prep), shown in the easiest unit (`humanQty`: 1500 g → 1.5 kg, 0.25 kg → 250 g).
- `sop.save` changes only the SOP fields of a dish or prep (version-checked) and replaces its steps; photo links must be http(s); at most 40 steps.

**Promotions (v1.5, engine in `pricing.js`)**

- **Per unit** (one dish, or one whole bundle): promo price = what the customer pays (% off, amount off, special price, list × x ÷ (x + y) for buy-X-get-Y, or the set price). The cut is split between the restaurant (`discount`) and the app (`platformDiscount` = cut × platformFundedPct). **Credited** = promo price + the app's share (= list − restaurant discount; a set priced above its dishes is credited what the customer pays). **Commission** = campaign rate (or the channel rate) × the promo price (or the list price if the channel doesn't charge on discounted prices).
- **CM before** = list × (1 − channel rate) − food cost − packaging; **CM during** = credited − commission − food cost − packaging. **Cost % during** = (food + packaging) ÷ (credited − commission).
- **Verdict:** `loss` if CM during < 0; `profitable` if cost % ≤ target + 5; otherwise `thin`. **Break-even uplift** = CM before ÷ CM during − 1.
- **Counter-offer** (`counterOffer`): the largest % off (0.5 steps, up to 90) at which every dish stays `profitable` (dishes already off target left out), and the largest at which every dish still makes money.
- **Bundles** are one unit in the profit check. When sold, each component gets its own sale row; the set price is split by list price (equally when the list prices are all 0).
- **Sales:** promo lines are priced on the server (client prices ignored) and refused when the promotion isn't running on that date, weekday and channel, or the dish isn't in it.
- **Results** (`promotions.results`): per-day averages of complete days only (the period ends yesterday) against the 28 days before the start, on the promotion's channels, for the promoted dishes and the whole restaurant. CM = total − food cost − commission. `worked` if the restaurant's CM per day didn't fall; `soldMoreEarnedLess` if promoted units rose but CM fell; otherwise `didNotWork`; `tooEarly` before the first full day; `noBaseline` when there were no sales in the 28 days before. Sales entry also offers a promotion on the day after it ends, for next-morning entry. `weak` when fewer than 14 baseline days had sales.
- **Reports (`reports.summary`)** for a month:
  - Revenue = Σ Sales.total
  - COGS = Σ Sales.costTotal (the snapshot)
  - Channel commissions = Σ Sales.commission
  - Waste & variance = −Σ value of `waste`, `count`, `adjustment` movements
  - Gross profit (shown) = Revenue − COGS − Channel commissions − Waste & variance
  - Net profit = Gross − Expenses
  - Revenue, cost, commission and margin **by channel** (`byChannel`)
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
| `bootstrap` | staff | | none → user, settings, ingredients (with stock, yield, conversions, prep lines), suppliers, menu (with cost and recipe breakdown), users (owner only), team (active people, for "made by") |
| `stock.levels` | staff | | none |
| `purchases.add` | staff | ✓ | date, supplierId?, invoiceRef?, note?, lines[{ingredientId, qty, unitCost}] (max 60; no preps) → also `impact` |
| `purchases.list` | staff | | from?, to?, ingredientId?, limit? |
| `purchases.void` | manager | ✓ | id |
| `movements.add` | staff (adjustment: manager) | ✓ | date, type, reason, lines[{ingredientId, qty}] |
| `movements.list` | staff | | from?, to?, type?, ingredientId?, includeSales?, limit? |
| `movements.void` | manager | ✓ | id (not for `sale` rows) |
| `ingredients.save` | manager | ✓ | item {id?, version?, name, unit, category, costPerUnit, minLevel, parLevel, supplierId, active, yieldPct, kind, batchQty, trackStock, shelfLifeDays}, units[{unit, factor}] (1 unit = factor × stock unit), prepRecipe[{ingredientId, qty, unit, yieldPct, note}] (preps only; cost is computed) |
| `ingredients.costHistory` | manager | | id, limit? → [{date, oldCost, newCost, changePct, source, refId}], newest first |
| `suppliers.save` | manager | ✓ | item {id?, version?, name, contactName, phone, email, notes, active} |
| `menu.save` | manager | ✓ | item {id?, version?, name, price, category, active}, recipe[{ingredientId, qty (net), unit, yieldPct}], prices?[{channelId, price}] (replaced only when sent; blank price removes it) |
| `menu.applyPrices` | manager | ✓ | channelId, items[{menuItemId, price}] (max 200) → {count} |
| `menu.analysis` | manager | | from, to, channelId?, includePromo? → menu-engineering classes per dish |
| `promotions.save` | manager | ✓ | item {id?, version?, name, type, value, channelIds[], startDate, endDate?, weekdays[], platformFundedPct?, campaignCommissionPct?, note, draft}, items[{menuItemId, qty?}] |
| `promotions.list` / `.get` | manager | | today / id, today → rows with status and profit check per channel |
| `promotions.check` | manager | | channelId, item {type, value, platformFundedPct?, campaignCommissionPct?}, items → {economics, counterOffer} (unsaved) |
| `promotions.cancel` | manager | ✓ | id |
| `sop.save` | manager | ✓ | ownerId (dish or prep), version, notes {portionNote, holdingNote, equipment, prepMinutes, photoUrl}, steps[{text, minutes?, imageUrl?, critical?}] → {version, steps} |
| `sop.list` | staff | | none → {ownerId: steps[]} |
| `today.summary` | staff | | today → {day, yesterdayClosed, tasks[{kind, n, items?}], setup (owner)}; kinds: deliveries, invoices (manager+), preps, lowStock, promotionsEnding (manager+), closeYesterday |
| `day.close` | staff | ✓ | date (not in the future), today, note? → the DayCloses row (sales total, waste value, count lines) |
| `day.status` | staff | | date → {closed, closedBy, closedAt, note, …} |
| `promotions.results` | manager | | id, today → before/during per day, change %, verdict, daily margin |
| `channels.save` | manager | ✓ | item {id?, version?, name, type, commissionPct (0–99.9), packagingCost, commissionOnDiscounted, active, sortOrder}; the last active channel can't be turned off |
| `production.add` | staff | ✓ | date, prepId, batches, producedQty, producedBy (username), note?, inputs?[{ingredientId, qty, unit}], byproducts?[{ingredientId, qty, unit}] → {run, warnings} |
| `production.list` | staff | | from?, to?, prepId?, limit? |
| `production.void` | manager | ✓ | id (also voids its movements) |
| `sales.add` | staff | ✓ | date, channelId (or legacy channel name), lines[{menuItemId, qty, unitPrice?}] or promo lines [{menuItemId, qty, promoId}] / bundle lines [{promoId, qty}] → stores channel price, listPrice, commission, promo discount split; also writes `sale` movements |
| `sales.list` | staff | | from, to |
| `sales.void` | manager | ✓ | id (also voids its movements) |
| `expenses.add` / `.list` / `.void` | manager | ✓ / – / ✓ | date, category, amount, description, paymentMethod, note |
| `po.suggestions` | manager | | none → groups by supplier with suggested quantities (preps skipped; `po.save` refuses them) |
| `po.list` / `po.get` | staff | | status (open/awaiting/draft/done/all/…), supplierId / id → PO with lines, receipts, invoices |
| `po.save` | manager | ✓ | item {id?, version?, supplierId, orderDate, expectedDate?, note}, lines[{ingredientId, qtyOrdered, unitPrice}], send? (drafts only) |
| `po.send` / `po.cancel` / `po.close` | manager | ✓ | id, reason? (cancel only without receipts; close only sent/partial) |
| `po.receive` | staff | ✓ | poId, date, deliveryRef, note, lines[{poLineId, qty, unitPrice}] → stock-in rows + status + `impact` |
| `invoices.save` | manager | ✓ | item {id?, version?, supplierId, poId?, invoiceNo, invoiceDate, dueDate?, vat?, total?, note}, lines[{ingredientId, qty, unitPrice}] → invoice + match |
| `invoices.list` / `invoices.get` | manager | | status (review/unpaid/disputed/paid/all), today / id → rows + payables summary / invoice + match |
| `invoices.approve` / `.dispute` | manager | ✓ | id, note (required for exceptions and disputes) |
| `invoices.pay` | manager | ✓ | id, date, method, reference (matched/approved only) |
| `reports.summary` | manager | | month (YYYY-MM), today → totals (incl. commissions), byChannel, attention, … |
| `users.save` | owner | ✓ | item {id?, version?, username, displayName, role, active, password?}; at least one active owner is enforced |
| `settings.save` | owner | ✓ | values {key: value} |

**Retry protection:** any write may include `requestId`. The server caches the result for 1 hour under `rq:<userId>:<requestId>`, inside the write lock, and returns it for repeats. The app creates one ID per form, so tapping Save again after a timeout doesn't record a second delivery, invoice or payment.

**Error codes:** `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `AUTH` (the client signs out), `LOCKED`, `FORBIDDEN`, `BAD_REQUEST`, `BUSY` (lock timeout), `SERVER`. The client adds `NETWORK` and `CONFIG`.

**Adding a feature, end to end:**
1. Add the action to `A[...]` in `core.js`, with its role and whether it writes.
2. If it needs a new tab or column, update `SCHEMA` and re-run `setup()`. **Append new columns at the end.**
3. Add Thai translations of any new error messages to `TH_RULES` in `core.js`.
4. Build the UI in `app/js/views/*`, and add text keys to **both** dictionaries in `i18n.js`.
5. Add tests in `tools/tests/`, then run `node tools/test_core.js`, `python tools/build_backend.py` and `python tools/check_i18n.py`.
6. Test in demo mode, then paste `Core.gs`, `Costing.gs` and `Pricing.gs` into Apps Script and deploy a new version.

---

## 7. Security

- **Passwords:** salted and hashed with 500 rounds of SHA-256 (pure JS in core, so the server and the demo behave identically). Never stored in plain text.
- **Sessions:** a random 64-hex token in Apps Script `CacheService`, valid for 6 hours after the last request (sliding). The client keeps the token in `localStorage`.
- **Brute force:** 5 failed logins lock that username for 10 minutes.
- **Roles** are checked on the server for every action. The UI hiding buttons is a convenience, not the protection.
- **XSS:** all HTML comes from the `html` template tag in `ui.js`, which escapes every interpolated value. Avoid `innerHTML` with raw strings; `raw()` is used only for constant markup.
- **Web app access** is "Anyone" (required for phones). The API rejects every call without a valid session token, except `auth.login` and the GET health check.
- **Hosting headers (`vercel.json`; `_headers` for Netlify):** a CSP that allows only `self` plus `script.google.com` / `script.googleusercontent.com`, plus `nosniff` and `frame-ancestors 'none'`.
- Owner locked out? Run `resetOwnerPassword()` in the Apps Script editor; the new password appears in the log.

---

## 8. Frontend notes

- **Routing:** hash routes such as `#/home`, `#/stock`, `#/sales`, `#/menu`, `#/more/expenses`. Deep links open forms: `#/stock/purchase|usage|waste|count`, `#/stock/low`, `#/stock/item/<id>`, `#/sales/new`, `#/more/expenses/new`, `#/more/production` (production log).
- **State:** `state.boot` comes from `bootstrap`. After each successful write, a view calls `ctx.refresh()` and then re-renders itself. `ctx.stale()` guards against a slow response drawing into a screen the user has left.
- **Bottom sheets** (`openSheet`) push a history entry, so the Android back button closes the sheet.
- **Charts** are hand-built SVG with hover/tap tooltips. The colours come from a colour-blind-checked palette (`--series-1`, `--series-2`).
- **Offline:** the service worker caches the app shell (network-first). Reading cached screens works offline; **saving requires a connection**, and there is no offline queue.
- **Theme:** light, dark, or follow the system (`ro.theme` in localStorage).
- **i18n:** `t(key, vars)` in `i18n.js`. Values are strings with `{var}` or functions. Everything formats with `th-TH` (Buddhist-era years). The app always sends `lang: 'th'`, so server errors come back in Thai. User data is stored exactly as typed. Server errors are translated in `core.js` (`translate()`).

**localStorage keys:** `ro.token`, `ro.user`, `ro.apiUrl`, `ro.mode` (`remote` | `demo`), `ro.theme`, `ro.demo.db.v7` (v1.3–v1.7 changed the sample data, so older demo data is ignored and the demo reseeds).

---

## 9. Local development

```bash
python tools/serve.py
```

Open http://localhost:5173 and tap **Explore with demo data**. Demo accounts are `owner`, `manager` and `staff`, all with password `demo1234`. The sample data is seeded in Thai; **More → My account → Reset demo data** reseeds it.

Before every handover or release:

```bash
python tools/build_backend.py
```

```bash
python tools/check_i18n.py
```

```bash
node tools/test_core.js
```

`test_core.js` runs every `tools/tests/*.test.js` against `core.js` and `costing.js` with an in-memory db (Node, no dependencies). The tests cover the costing maths, units, ingredients and preps, menu costing, production runs and cost impact. The UI is still checked by hand in the browser, in English and Thai, at phone size.

The demo seeds 62 days of history: purchases, orders and invoices, daily sales, and about 60 production runs of chilli oil, chicken stock (with chicken fat as a by-product), nam jim and tom yum base.

---

## 10. Deployment and release

| Piece | Where | How to update |
|---|---|---|
| Database | A Google Sheet in the owner's Google account | `setup()` (Thai lists; `setupThai()` is the same) adds missing tabs and is safe to re-run |
| API | Apps Script bound to that Sheet | Paste `Server.gs`, `Core.gs`, `Costing.gs`, `appsscript.json` → **Deploy → Manage deployments → Edit → New version** (keeps the URL) |
| App | Vercel, https://restops-app.vercel.app/ (Root Directory `app`) | Redeploy from the Vercel dashboard or CLI (`vercel --prod` from `app/`), or push to the connected git branch |

Release checklist:
1. Bump `VERSION` in `core.js` and `CACHE` in `sw.js`.
2. Run the tests and the two Python tools above.
3. Update Apps Script first, then the app.

The scope `spreadsheets.currentonly` requires the script to be **bound** to the sheet (Extensions → Apps Script). If you use a standalone script with `SPREADSHEET_ID`, change the scope to `.../auth/spreadsheets`.

---

## 11. Handover checklist (things that are NOT in the repo)

Collect these from the current owner and store them in the team's password manager, not in git:

- [ ] Google account that **owns** the Sheet and the Apps Script, plus the Sheet URL
- [ ] Apps Script **web-app URL** (`…/exec`) and deployment ID
- [ ] Vercel account / team and the project name (`restops-app`)
- [ ] Owner login for the app (never commit it)
- [ ] A shared **git remote**. The repo has commits but **no remote**: push it and give the next developer access.
- [ ] The local preview entry lives in `Desktop/proj/.claude/launch.json` (named `restaurant-ops`). It's only needed for Claude Code previews; `tools/serve.py` works without it.

To move ownership: share the Sheet with the new owner and make them **Owner** (the bound script moves with it), have them create a **new deployment** under their account, and put the new URL in `app/config.js`.

---

## 12. Known limitations and risks

| # | Item | Impact | Suggested fix |
|---|---|---|---|
| 1 | **Not yet run against a real Sheet** | Apps Script-specific bugs are possible (cell formats, permissions, quotas) | First task: deploy to a test Sheet and run every flow |
| 2 | ~~No idempotency on writes~~ **Fixed in v1.2** for purchasing (`requestId`) | Sales, stock and expense forms don't send a `requestId` yet | Pass `{ requestId }` from those forms too (`newRequestId()` in `api.js`) |
| 3 | **Every request reads whole tabs** | Gets slower as StockMovements grows (each sale line writes several rows). Fine for roughly the first year. | Yearly archive plus opening count, or a cached `StockLevels` tab |
| 4 | **Tests cover the business logic only** | UI regressions possible | `node tools/test_core.js` covers core.js and costing.js. The views are checked by hand. |
| 5 | **No offline queue** | Can't save without signal | Queue writes in IndexedDB with `requestId`s (needs #2) |
| 6 | Password hashing is SHA-256 ×500 | Weaker than bcrypt/argon2 if the Users tab leaks | Restrict sheet sharing; consider PBKDF2 with more rounds |
| 7 | Apps Script quotas | Consumer accounts have daily execution limits | Use a Google Workspace account for production |
| 8 | Single restaurant only | No multi-branch | Add `branchId` to ledgers and users |
| 9 | Sessions last 6 h | Staff sign in each shift | Acceptable; a "remember me" refresh token could extend it |

**Purchasing follow-ups:** credit notes (negative invoices) to settle disputes, adjusting ingredient cost when an approved invoice price differs from the receipt price, supplier price lists, and attaching a photo of the paper invoice.

**Suggested next features:** CSV/Excel export, per-supplier price history, dish-level sales trend, and a store app (Flutter/React Native can reuse the same API unchanged).
