# Layer 2: Channel Pricing & Menu Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sales channels real records with commission and packaging, add per-channel dish prices with suggested prices, record commission on every sale and show it in the P&L, and add menu-engineering analysis plus a "Needs attention" card, as Restaurant Ops v1.4.0.

**Architecture:** Pure pricing maths goes in a new shared ES5 file `app/js/pricing.js` (global `RestoPricing`), loaded before `core.js` and copied to `backend/Pricing.gs`, exactly like `costing.js`. `core.js` owns the new tabs, migration, validation, sale snapshots and reports. Views use `RestoPricing` for live numbers. Layer 3 (promotions) will add its profit engine to the same `pricing.js`.

**Tech Stack:** Vanilla ES5 (shared logic), ES modules (views), Google Apps Script + Sheets, Node (tests, no packages), Python 3 (tools).

**Spec:** `docs/superpowers/specs/2026-11-13-costing-pricing-promotions-design.md`. Section 6 is this layer; also sections 2, 3, 9 and 14. Read `docs/HANDOVER.md` sections 2–6 and 8 for conventions.

## Global Constraints

- `core.js` and `pricing.js` stay plain ES5: `var`, `function`, no arrows/`let`/`const`/template literals, no DOM, no Google APIs. `core.js` references `RestoPricing` and `RestoCosting` **only inside function bodies**.
- New sheet columns are **appended** to the end of a `SCHEMA` array; never reorder or insert.
- Ledgers are append-only. **Old sales rows are never rewritten**: the channel of a legacy row is resolved at read time.
- **Food cost % stays on the menu price everywhere** (Menu flags, reports, dashboard): no existing figure shifts. Delivery profitability is shown as **contribution margin (CM) after commission**. Pricing screens also show "food cost % of net revenue", clearly labelled.
- **No per-order fees** (sales are daily totals per dish).
- Exact formulas (spec 6.2):
  - net revenue = price × (1 − commission%)
  - CM = net revenue − food cost − packaging
  - suggested price = (food cost + packaging) ÷ (target% × (1 − commission%)), then rounded by `priceRounding`.
- `Sales` stored meaning (spec 6.1): `unitPrice`/`total` = what the restaurant is credited before commission. `commission` = rate × base × qty, where base = the price after discount if the channel's `commissionOnDiscounted` is TRUE, else the list price. In this layer there are no promotions, so `discount` = 0, `platformDiscount` = 0, `promoId` = ''.
- Commission presets are **data in `i18n.js` defaults**, never logic. Every preset rate is shown with the label "Typical rate; check your contract" and the user must confirm it.
- Menu engineering (spec 6.3):
  - Popular when menu mix % ≥ 70 % × (1 ÷ number of dishes sold).
  - High margin when CM per dish ≥ the sales-weighted average CM.
  - Promo-price sales are excluded by default.
  - "Indicative" notice when fewer than 5 dishes were sold or the period is under 14 days.
- Every new text key is in EN and TH (`python tools/check_i18n.py`). Every new English server message has a `TH_RULES`/`TH_LABELS` translation; extend the sweep test in `tools/tests/final_review.test.js`.
- All HTML goes through the escaping `html` template; `raw()` is for constant markup only.
- Phone-first (375 px), 44 px targets, every input labelled, colour never the only signal, live numbers. Follow `app/css/app.css` tokens in light and dark.
- Version: `VERSION` `1.4.0` in `core.js`, `CACHE` `resto-ops-v1.4.0` in `app/sw.js`. Demo key: `ro.demo.db.v3`.
- Commit after each task. `git add` only the task's files, never `Claude outputs/` or `.superpowers/`.

## Review Focus

1. **Legacy sales with only a channel name** (no `channelId`, Thai names like `เดลิเวอรี่`) must group under the matching channel in reports and analysis, not under "Other". → Task 4 test.
2. **Degenerate pricing inputs**: commission ≥ 100 %, target ≤ 0, or food cost 0 must give `suggested: null` (shown as "—"), never `Infinity`/`NaN`. → Task 1 test.
3. **Analysis with 0 or 1 dish sold, or all CM ≤ 0**: no division by zero, sensible classes, and `indicative: true`. → Task 1 and Task 4 tests.
4. **A deactivated channel that has history**: it still appears in reports and analysis, is hidden from sales entry, and its sales still resolve. → Task 4 test.
5. **A channel renamed after sales were recorded**: rows with a `channelId` group under the new name; legacy name-only rows match the old name only if a channel still has that name (otherwise "Other"). → Task 4 test.
6. **A blank channel price** falls back to the base menu price in sales entry, economics, suggestions and analysis. → Task 3 test.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `app/js/pricing.js` | create | Pure maths: `roundPrice`, `effectiveRounding`, `channelEconomics`, `menuEngineering` |
| `app/js/core.js` | modify | Schema (Channels, MenuPrices, Sales columns), channel migration, `channels.save`, `priceRounding` setting, menu prices, sale commission snapshot, reports commissions/byChannel/attention, `menu.analysis` |
| `tools/build_backend.py`, `app/index.html`, `app/sw.js` | modify | Load, cache and copy `pricing.js`; version |
| `tools/test_core.js` | modify | Also load `global.RestoPricing` if present |
| `tools/tests/pricing.test.js`, `channels.test.js`, `analysis.test.js` | create | Tests |
| `app/js/views/channels.js` | create | More → Setup → Sales channels page and channel sheet with presets |
| `app/js/views/pricing-view.js` | create | Menu → Pricing tab and the "apply suggested" preview sheet |
| `app/js/views/analysis.js` | create | Menu → Analysis tab |
| `app/js/views/menu.js` | modify | Hub segments; dish sheet "Prices by channel" section |
| `app/js/views/sales.js` | modify | Channel select from channel records; channel prices in entry |
| `app/js/views/home.js` | modify | Commission P&L line, revenue by channel, Needs attention card |
| `app/js/views/more.js` | modify | Setup link to channels; Settings: drop `salesChannels` list, add `priceRounding` |
| `app/js/charts.js` | modify | `quadrantChart(container, items, opts)` |
| `app/js/i18n.js` | modify | Keys EN+TH; `channelPresets` defaults |
| `app/js/demo.js` | modify | v3 key; channels, channel prices, 4-channel sales |
| `docs/HANDOVER.md`, `README.md` | modify | Docs |

---

### Task 1: Pricing maths (`pricing.js`)

**Files:**
- Create: `app/js/pricing.js`, `tools/tests/pricing.test.js`
- Modify: `tools/build_backend.py` (also write `backend/Pricing.gs`), `tools/test_core.js` (load `global.RestoPricing` if the file exists, before core), `app/index.html` (script tag before `core.js`), `app/sw.js` (SHELL)

**Interfaces — produces, on global `RestoPricing` (with the `module.exports` guard like `costing.js`):**
- `ROUNDING_RULES`: `['none', '1', '5', '10', '0.99', '9-ending']`.
- `effectiveRounding(setting, currency) -> String`. A valid stored setting wins. Otherwise: `THB` → `'5'`; `JPY`, `KRW`, `VND`, `IDR` → `'10'`; any other currency → `'0.99'`.
- `roundPrice(p, rule) -> Number|null`. Never rounds down (a suggested price must still meet the target). `null`/non-finite/≤ 0 in → `null`.
  - `'none'`: ceil to 2 dp.
  - `'1'`, `'5'`, `'10'`: ceil to that multiple.
  - `'0.99'`: smallest `n + 0.99` ≥ p.
  - `'9-ending'`: smallest integer ≥ p whose last digit is 9.
- `channelEconomics({ price, foodCost, packaging, commissionPct, targetPct, rounding }) -> { netRevenue, cm, foodCostPctNet, suggested, meetsTarget }`.
  - Money is rounded to 2 dp.
  - `foodCostPctNet` = foodCost ÷ netRevenue × 100 (1 dp), or `null` when netRevenue ≤ 0.
  - `suggested` = `roundPrice((foodCost + packaging) ÷ (target/100 × (1 − c/100)), rounding)`. It is `null` when target ≤ 0, c ≥ 100 or foodCost + packaging ≤ 0.
  - `meetsTarget` = `foodCostPctNet !== null && foodCostPctNet <= targetPct`.
  - `price` blank or 0 → `netRevenue` 0, `cm` = −(foodCost + packaging), `foodCostPctNet` `null`.
- `menuEngineering(items: [{ id, qty, cm }]) -> { threshold, avgCm, items: [{ id, mixPct, cmPerDish, popular, highMargin, cls }] }`. Here `cm` is the total CM for the period.
  - Only items with qty > 0 are classified.
  - `threshold` = 70 % × (100 ÷ number of items with qty > 0), as a percentage.
  - `avgCm` = Σcm ÷ Σqty; 0 when Σqty is 0.
  - `cls` ∈ `star | plowhorse | puzzle | dog`.
  - mixPct 1 dp; cmPerDish 2 dp.

- [ ] **Step 1: Write failing tests** `tools/tests/pricing.test.js`:
  - `roundPrice(83.2,'5') === 85`; `roundPrice(85,'5') === 85`; `roundPrice(12.3,'0.99') === 12.99`; `roundPrice(12.995,'0.99') === 13.99`; `roundPrice(83,'9-ending') === 89`; `roundPrice(90,'9-ending') === 99`; `roundPrice(7.001,'none') === 7.01`; `roundPrice(0,'5') === null`; `roundPrice(Infinity,'5') === null`.
  - `effectiveRounding('', 'THB') === '5'`; `effectiveRounding('', 'USD') === '0.99'`; `effectiveRounding('10', 'USD') === '10'`; `effectiveRounding('bogus', 'JPY') === '10'`.
  - `channelEconomics({ price:100, foodCost:30, packaging:5, commissionPct:30, targetPct:30, rounding:'5' })` gives `netRevenue 70`, `cm 35`, `foodCostPctNet 42.9`, `suggested 170` (35 ÷ 0.21 = 166.67 → 170), `meetsTarget false`.
  - Same inputs with commission 0 and packaging 0 give `suggested 100` and `meetsTarget true`.
  - Commission 100 → `suggested null`. Target 0 → `suggested null`. Price 0 → `foodCostPctNet null`.
  - `menuEngineering` with 4 items (`A` qty 50 cm 2500, `B` qty 50 cm 500, `C` qty 5 cm 400, `D` qty 5 cm 25):
    - threshold `17.5`; `avgCm 31.14`
    - A `star`, B `plowhorse`, C `puzzle`, D `dog`.
  - `menuEngineering([])` gives `items []` and `avgCm 0`. One item → threshold 70, and it is popular.
- [ ] **Step 2:** Run `node tools/test_core.js`. Expected: the pricing tests FAIL.
- [ ] **Step 3:** Implement `pricing.js`. Wire the build script, runner, script tag and SHELL.
- [ ] **Step 4:** Run tests (all PASS) and `python tools/build_backend.py` (writes Core.gs, Costing.gs, Pricing.gs).
- [ ] **Step 5:** Commit `feat(pricing): price rounding, channel economics, menu engineering`.

---

### Task 2: Channels as records, migration, settings

**Files:**
- Modify: `app/js/core.js`
- Create: `tools/tests/channels.test.js`
- Modify: `tools/tests/final_review.test.js` (add the new messages to the Thai sweep)

**Interfaces:**
- **Schema changes:**
  - New tab `Channels: ['id','name','type','commissionPct','packagingCost','commissionOnDiscounted','active','sortOrder','createdAt','updatedAt','updatedBy','version']`, ids prefixed `CHN`.
  - `type` ∈ `dineIn | takeaway | delivery | other`.
  - `TEXT_COLUMNS` gains `'channelId'`.
- `DEFAULT_SETTINGS.priceRounding = ''` (meaning auto by currency). `settings.save` validates it as `''` or one of `RestoPricing.ROUNDING_RULES`, else `Unknown price rounding.`
- `guessChannelType(name) -> String`. Case-insensitive:
  - `dine|ทาน|ร้าน` → `dineIn`
  - `take|กลับ|to go` → `takeaway`
  - `deliver|เดลิ|grab|line ?man|panda|shopee|robinhood|uber|doordash|deliveroo|just ?eat` → `delivery`
  - anything else → `other`.
- `ensureChannels(user) -> rows`.
  - If `Channels` has no rows, it runs `db.lock(...)`, re-checks inside the lock, then appends one row per name in `settings().salesChannels`.
  - Each row has the guessed type, commission 0, packaging 0, `commissionOnDiscounted` TRUE, active, and sortOrder = its index.
  - It is called from `bootstrap`, `channels.save`, `sales.add`, `reports.summary` and `menu.analysis`.
- `channelRows() -> [{ id, name, type, commissionPct, packagingCost, commissionOnDiscounted, active, sortOrder, version }]`, typed and sorted by sortOrder then name.
- `resolveChannel(sale, channels) -> channel|null`:
  1. `sale.channelId` matches a channel → that channel.
  2. Otherwise a case-insensitive trimmed name match on `sale.channel`.
  3. Otherwise `null` (reports call it "Other").
- `A['channels.save']` (manager, write). Payload `{ item: { id?, version?, name, type, commissionPct, packagingCost, commissionOnDiscounted, active, sortOrder } }`.
  - Validation: name required, max 40 characters, unique among active channels (existing `assertUnique` wording).
  - Type must be in the list, else `Unknown channel type.`
  - commissionPct must be 0–99.9 (`Commission must be between 0 and 99.9 %.`).
  - packagingCost ≥ 0. Use the label `Packaging cost` and add it to `TH_LABELS`.
  - Uses `saveRow` with versioning.
  - Refuses to deactivate the last active channel: `Keep at least one active sales channel.`
- `bootstrap` gains `channels: channelRows()`.
- Add `TH_RULES`/`TH_LABELS` for every new message.

- [ ] **Step 1: Write failing tests** `tools/tests/channels.test.js`:
  - A fresh api's `bootstrap` returns 3 channels from the default `salesChannels` ('Dine-in', 'Takeaway', 'Delivery') with types `dineIn`, `takeaway`, `delivery`. Calling `bootstrap` again does not duplicate them.
  - Thai names `ทานที่ร้าน, กลับบ้าน, เดลิเวอรี่` set through `settings.save` before the first bootstrap migrate to `dineIn`, `takeaway`, `delivery`.
  - `channels.save` creates 'Grab' with commission 30 and packaging 5. The row is returned with a version, and `bootstrap.channels` includes it.
  - Commission 100 → VALIDATION. A duplicate active name → VALIDATION. Deactivating every channel → the last save fails with "Keep at least one".
  - Staff `channels.save` → FORBIDDEN.
  - `settings.save { priceRounding:'9-ending' }` succeeds; `'7'` → VALIDATION.
  - The Thai sweep covers the new messages.
- [ ] **Step 2:** Run the tests; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests (PASS) and the build.
- [ ] **Step 5:** Commit `feat(core): sales channels as records with commission and packaging`.

---

### Task 3: Channel prices and sale commission snapshot

**Files:**
- Modify: `app/js/core.js`, `tools/tests/channels.test.js` (new tests in a second section)

**Interfaces:**
- **Schema changes:**
  - New tab `MenuPrices: ['id','menuItemId','channelId','price']`, ids prefixed `MPR`.
  - `Sales` gets these columns appended: `'channelId','commission','promoId','listPrice','discount','platformDiscount'`.
  - `TEXT_COLUMNS` gains `'promoId'`.
- `menuWithCost()` dishes gain `prices: { channelId: Number }`, containing only channels with a stored price.
- `listPriceFor(dish, channelId) -> Number` returns the stored channel price, else `dish.price`.
- `menu.save` accepts top-level `prices: [{ channelId, price }]`.
  - A blank price removes that channel's row.
  - Otherwise the price must be ≥ 0, and the channel must exist (`Sales channel not found.` via `findOrFail`).
  - The dish's `MenuPrices` rows are replaced as a whole.
- `A['menu.applyPrices']` (manager, write). Payload `{ channelId, items: [{ menuItemId, price }] }`, at most 200 items. It upserts each dish's row for that channel and returns `{ count }`. Each dish must exist; each price must be > 0.
- `sales.add` accepts `channelId`. The legacy `channel` (a name) is still accepted and resolved with `resolveChannel`. With neither given, it uses the first active channel.
  - Each row stores `channel` = the channel name and `channelId`.
  - `listPrice` = `listPriceFor(dish, channelId)`. The default `unitPrice` = listPrice; an explicit `unitPrice` overrides it, as today.
  - `discount` = 0, `platformDiscount` = 0, `promoId` = ''.
  - `commission` = round(commissionPct/100 × base × qty, 2), where base = `unitPrice` if `commissionOnDiscounted`, else `listPrice`.
  - It refuses an inactive channel: `This sales channel is turned off.`
- `sales.list` rows gain `channelId`, `commission`, `listPrice`. Totals gain `commission`.

- [ ] **Step 1: Write failing tests:**
  - `menu.save` with `prices: [{ channelId: grab, price: 120 }]` → bootstrap menu item `prices[grab] === 120`. Saving again with `price: ''` removes it.
  - `sales.add { channelId: grab, lines: [{ menuItemId, qty: 2 }] }` (Grab 30 %, price 120) gives a row with `unitPrice 120`, `total 240`, `listPrice 120`, `commission 72`, `channel 'Grab'`, `channelId` set.
  - A blank channel price → `unitPrice` = the base menu price (Review Focus 6).
  - An explicit `unitPrice 100` with `commissionOnDiscounted` FALSE → commission is calculated on 120. With TRUE → on 100.
  - Legacy `sales.add { channel: 'Delivery' }` → `channelId` resolved.
  - An inactive channel → VALIDATION.
  - `menu.applyPrices` with 2 items upserts both.
  - Staff `menu.applyPrices` → FORBIDDEN.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run (PASS) and build.
- [ ] **Step 5:** Commit `feat(core): channel prices and commission on every sale`.

---

### Task 4: Reports by channel, commissions in P&L, Needs attention, menu analysis

**Files:**
- Modify: `app/js/core.js`
- Create: `tools/tests/analysis.test.js`

**Interfaces:**
- `periodTotals(...)` gains `commissions` (Σ `Sales.commission`; legacy rows count as 0).
  - `grossProfit` = revenue − cogs − commissions.
  - `netProfit` = grossProfit − wasteAndVariance − expenses.
  - `foodCostPct` and `theoreticalFoodCostPct` are **unchanged**.
- `reports.summary` gains `byChannel: [{ channelId (or ''), name, type, revenue, cogs, commission, cm, qty }]`, sorted by revenue descending, using `resolveChannel`. Unresolved rows go to `{ channelId:'', name: 'Other' }`, and the UI translates `'Other'`.
- `reports.summary` also gains `attention`, the top 3 entries by `lostMargin` descending:
  - Look at active dishes × active channels with sales in the 28 days ending today, where `channelEconomics(...).meetsTarget === false` and `suggested !== null`.
  - Each entry is `{ menuItemId, name, channelId, channelName, price, suggested, foodCostPctNet, qty28, lostMargin }`.
  - `lostMargin` = (suggested − price) × qty28, rounded to 2 dp.
- `A['menu.analysis']` (manager, read). Payload `{ from, to, channelId?, includePromo? }`, dates required.
  - Sales are live rows in range, filtered to `resolveChannel(row).id === channelId` when given, and excluding rows with a non-empty `promoId` unless `includePromo`.
  - Per dish: qty, revenue, cost (Σ costTotal), commission, cm = revenue − cost − commission. The result is classified with `RestoPricing.menuEngineering`.
  - Returns `{ from, to, days, channelId, dishesSold, threshold, avgCm, indicative, items: [{ menuItemId, name, qty, revenue, cost, commission, cm, cmPerDish, mixPct, popular, highMargin, cls, foodCostPct (cost ÷ revenue on menu price, 1 dp), overTarget }] }`.
  - `days` = inclusive day count. `indicative` = `dishesSold < 5 || days < 14`.
  - Items are sorted by class (star, plowhorse, puzzle, dog), then by revenue descending.

- [ ] **Step 1: Write failing tests** `tools/tests/analysis.test.js`:
  - A sale on Grab (commission 72 on 240) → `reports.summary.totals.commissions === 72` and `grossProfit` = revenue − cogs − 72. `foodCostPct` is unchanged from before (compute it independently).
  - **Legacy row** (`db.append('Sales', [...])` with `channel: 'เดลิเวอรี่'` and no channelId, after migrating Thai channels): `byChannel` lists it under the delivery channel, not "Other" (Review Focus 1).
  - **Renamed channel:** after a sale, rename 'Grab' to 'Grab Food' → `byChannel` name is 'Grab Food' (Review Focus 5).
  - **Deactivated channel** with sales still appears in `byChannel` and in analysis with `channelId` set (Review Focus 4).
  - `menu.analysis` over 2 dishes and 1 day → `indicative true`, and classes are present.
  - Zero sales → `items []`, `avgCm 0`, `indicative true` (Review Focus 3).
  - `includePromo` default excludes a row appended with `promoId:'PRM-X'`; `includePromo:true` includes it.
  - `attention`: a dish at price 100, food cost 40, on Grab 30 % with sales in the last 28 days appears with `suggested` and `lostMargin > 0`. A dish meeting the target doesn't appear.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run (PASS) and build.
- [ ] **Step 5:** Commit `feat(core): commissions in P&L, revenue by channel, menu analysis`.

---

### Task 5: Channels UI, settings, sales entry

**Files:**
- Create: `app/js/views/channels.js`
- Modify: `app/js/views/more.js`, `app/js/views/sales.js`, `app/js/i18n.js`, `app/sw.js`

**Interfaces:**
- Consumes `boot.channels`, `channels.save`, `sales.add { channelId }`, `boot.menu[].prices`, and `settings.priceRounding`.
- `channels.js` exports `renderChannels(ctx)` (route `#/more/channels`, manager+) and `channelSheet(ctx, item?)`.
  - **List:** a type icon per channel (dine-in `chef`, takeaway `bag` or an existing icon, delivery `truck`), name, commission % and packaging, a hidden badge for inactive channels, and up/down buttons that save `sortOrder`.
  - **New-channel sheet** starts with a **preset picker** (chips from `defaults('channelPresets')`, each `{ name, type, commissionPct }`), plus "Custom".
  - Choosing a preset fills the fields. It shows the rate with the hint `channels.typicalRate` ("Typical rate; check your contract") and a required checkbox `channels.confirmRate`. Save stays disabled until it is ticked whenever the rate came from a preset and is unchanged.
  - **Fields:** name, type (seg control), commission %, packaging cost per dish, "Commission is charged on the discounted price" checkbox, active.
- `i18n.js` defaults `channelPresets` (EN and TH share the brand names; Thai labels only where the brand has none):
  - Grab 30, LINE MAN 30, foodpanda 32, ShopeeFood 25, Robinhood 0, Uber Eats 30, DoorDash 25, Deliveroo 30, Just Eat 14, Other delivery app 25.
  - All are type `delivery`.
- **More:** Setup gains "Sales channels" (manager+), with the active channel count shown under it.
- **Settings:** remove `salesChannels` from `LISTS` and the defaults button. Add a `priceRounding` select: Auto (by currency) / None / Whole number / Nearest 5 / Nearest 10 / .99 / Ends in 9. Each option shows an example (e.g. "83 → 85").
- **Sales entry:**
  - The channel select lists active channels by sortOrder (value = id).
  - Each dish's price and the running total update to that channel's price when the channel changes.
  - The payload sends `channelId`. The day list grouping key is unchanged.
- **Sales list:** a delivery-channel batch shows commission in its detail sheet ("Commission −฿72").

- [ ] **Step 1:** Add i18n keys and presets; run `python tools/check_i18n.py`.
- [ ] **Step 2:** Implement `channels.js` and the More and Settings changes.
- [ ] **Step 3:** Implement the sales entry changes.
- [ ] **Step 4: Verify in browser** (demo, 375 px, EN then TH, light then dark):
  - Add Grab from its preset; Save is blocked until the rate is confirmed.
  - Reorder the channels.
  - Enter sales on Grab and check that dish prices follow the channel prices.
  - A staff login doesn't see Sales channels in More.
  - No console errors.
- [ ] **Step 5:** Commit `feat(ui): sales channels with presets, channel-aware sales entry`.

---

### Task 6: Dish prices by channel and the Pricing tab

**Files:**
- Create: `app/js/views/pricing-view.js`
- Modify: `app/js/views/menu.js`, `app/js/i18n.js`, `app/sw.js`

**Interfaces:**
- Consumes `RestoPricing.channelEconomics`, `effectiveRounding`, `boot.channels`, `boot.menu[].prices`, `menu.save { prices }` and `menu.applyPrices`.
- **Dish sheet "Prices by channel" section** (manager), under the cost card:
  - One compact row per active channel: channel name, price input (placeholder = base price), and a line showing `Net ฿x · Margin ฿y · Food cost z % of net` with a pill (good/warn/bad against the target).
  - If not meeting the target: "Suggested ฿s" with a **Use** button that fills the input.
  - Every row updates live as the base price, recipe or channel price changes.
  - Saves through `menu.save` `prices`.
- `pricing-view.js` exports `renderPricing(ctx, host)` for the Menu **Pricing** tab (manager+):
  - Channel chips at the top (active channels).
  - A summary strip: dishes meeting the target / not meeting it / average margin.
  - A list of active dishes with the current channel price, CM, food cost % of net revenue with a pill, and the suggested price.
  - Tapping a row opens the dish sheet.
  - The button "Apply suggested prices on {channel}" opens a **preview sheet** listing only the dishes not meeting the target (name, old → new, new margin), each with a checkbox (default on).
  - Confirm calls `menu.applyPrices`, then refreshes and shows a toast with the count.
- **Menu hub segments:** this task adds **Pricing**, so the hub reads Dishes · Preps · Pricing (Pricing manager+ only; staff keep Dishes · Preps). Task 7 adds the Analysis segment. `ui.tab` values: `dishes | preps | pricing | analysis`.

- [ ] **Step 1:** i18n keys; run `check_i18n`.
- [ ] **Step 2:** Implement the dish sheet section.
- [ ] **Step 3:** Implement `pricing-view.js` and add the Pricing segment.
- [ ] **Step 4: Verify in browser** (demo, 375 px, EN/TH, light/dark):
  - Grab rows show net, margin and the pill.
  - **Use** fills the suggested price.
  - The preview lists old → new, and applying it updates the prices.
  - Staff don't see Pricing.
  - Numbers match `RestoPricing.channelEconomics` for one dish, checked in the console.
- [ ] **Step 5:** Commit `feat(ui): channel prices with suggested prices and bulk apply`.

---

### Task 7: Analysis tab, quadrant chart, dashboard additions

**Files:**
- Create: `app/js/views/analysis.js`
- Modify: `app/js/views/menu.js` (Analysis segment), `app/js/views/home.js`, `app/js/charts.js`, `app/js/i18n.js`, `app/sw.js`

**Interfaces:**
- Consumes `menu.analysis` and `reports.summary` (`totals.commissions`, `byChannel`, `attention`).
- `charts.js`: `export function quadrantChart(container, items, { avgCm, threshold })`.
  - An SVG with x = mixPct and y = cmPerDish. The divider lines are at `threshold` and `avgCm`.
  - Bubble area ∝ revenue.
  - Colours use the existing series tokens, and each point has a text label or `<title>`.
  - Quadrant names sit in the corners.
  - Tapping a dot dispatches `CustomEvent('pick', { detail: menuItemId })` on the container.
  - Accessible `<title>`/`<desc>` summary.
- `analysis.js` exports `renderAnalysis(ctx, host)`:
  - Period chips: This month / Last month / Last 4 weeks / Custom (two date inputs). Default is Last 4 weeks.
  - A channel select (All + active and inactive channels that have sales).
  - An "Include promotion sales" switch, off by default.
  - The `indicative` notice when set.
  - The quadrant chart, then a list grouped Star / Plowhorse / Puzzle / Dog. Each group shows its plain name plus the expert term (e.g. "Plowhorse · popular, low margin") and its one-line recommendation from spec 6.3.
  - Each dish shows qty, mix %, CM per dish, and a red flag + icon when `overTarget`.
  - Tapping a dish opens the dish sheet.
  - Empty state when nothing was sold.
- `home.js` (manager):
  - P&L gains an indented row "Channel commissions −฿x" after waste. Gross profit = revenue − food cost − waste − commissions, matching the server's `grossProfit` minus waste as today.
  - New card "Revenue by channel": `barList` with revenue and a sub-line showing margin after commission.
  - New card "Needs attention" (only when `attention.length`): each row reads "{dish}: {pct} % food cost on {channel}; suggested {price}". Tapping opens Menu → Pricing with that channel selected.
- Menu hub gains the Analysis segment (manager+).

- [ ] **Step 1:** i18n keys (quadrant names, recommendations, period labels); run `check_i18n`.
- [ ] **Step 2:** Implement `quadrantChart` and `analysis.js`; add the segment.
- [ ] **Step 3:** Implement the home dashboard additions.
- [ ] **Step 4: Verify in browser** (demo, 375 px, EN/TH, light/dark):
  - The quadrant shows dots in all 4 corners for demo data.
  - The channel filter changes the results.
  - The dashboard's commission line and by-channel card add up to the P&L.
  - Needs attention links to Pricing.
  - Staff see no Analysis.
  - No console errors.
- [ ] **Step 5:** Commit `feat(ui): menu engineering analysis and channel insights on dashboard`.

---

### Task 8: Demo data v3, version 1.4.0, docs

**Files:**
- Modify: `app/js/demo.js`, `app/js/core.js` (`VERSION`), `app/sw.js` (`CACHE`), `tools/tests/smoke.test.js` (expect `1.4.0`), `docs/HANDOVER.md`, `README.md`

**Interfaces / content:**
- Demo key `KEY = 'ro.demo.db.v3'`.
- After the initial settings, the seed creates channels via `channels.save`:
  - Dine-in (dineIn, 0 %, packaging 0)
  - Takeaway (takeaway, 0 %, packaging 4)
  - Grab (delivery, 30 %, packaging 6)
  - LINE MAN (delivery, 30 %, packaging 6)
  - Thai names: ทานที่ร้าน, กลับบ้าน, Grab, LINE MAN.
  - The first two replace the migrated defaults: rename or update the auto-created rows rather than adding duplicates, and deactivate the migrated "Delivery" row.
- Channel prices: Grab and LINE MAN at base × 1.2, rounded up to 5, on every dish except Cola and Thai Iced Tea, which keep the base price. That leaves at least 2 dishes not meeting the target on Grab, so Needs attention and the Pricing tab have content.
- Daily sales split by channel: about 50 % dine-in, 10 % takeaway, 25 % Grab, 15 % LINE MAN, using the seeded `rng`, with `channelId`.
- Food cost % on menu price must stay 20–40 % for most dishes, as in v1.3.
- **HANDOVER updates:**
  - Section 4: Channels and MenuPrices tabs, plus the new Sales columns and their meaning.
  - Section 5: channel economics formulas, rounding rules, commission snapshot, P&L line, menu-engineering rules, attention.
  - Section 6: `channels.save`, `menu.applyPrices`, `menu.analysis`, plus the changed `sales.add`, `menu.save` and `reports.summary`.
  - Section 3: `pricing.js` → `Pricing.gs`.
  - Header version 1.4.0, dated 2026-11-14, with a Layer 2 status note.
- **README updates:** rows for Sales channels, Channel pricing and Menu analysis; "How the numbers work" covers commission, CM, suggested price and the menu-engineering classes.

- [ ] **Step 1:** Update the smoke test to expect 1.4.0; run and see it FAIL; bump the versions; run and see it PASS.
- [ ] **Step 2:** Implement the demo changes.
- [ ] **Step 3: Verify** (browser with cleared storage, EN and TH; or a scratchpad Node seed run):
  - No seed errors.
  - Dashboard shows commissions and the 4 channels.
  - Needs attention has entries.
  - The Analysis quadrant has dishes in at least 3 classes.
  - Report the per-dish food cost % and the Grab CM per dish.
- [ ] **Step 4:** Update the docs.
- [ ] **Step 5:** Run `node tools/test_core.js`, `python tools/check_i18n.py` and `python tools/build_backend.py`; all must succeed.
- [ ] **Step 6:** Commit `feat: v1.4.0 channel pricing and menu analysis demo data and docs`.
