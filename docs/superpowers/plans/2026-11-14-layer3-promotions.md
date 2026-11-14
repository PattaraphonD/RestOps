# Layer 3: Promotions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers build promotions and check their profit from real cost before they run, check a delivery-app campaign offer before joining it, record promo sales, and see each promotion's results against the previous 4 weeks. Ships as Restaurant Ops v1.5.0.

**Architecture:** The profit engine is pure ES5 in `app/js/pricing.js` (`RestoPricing.promoPrice`, `promoEconomics`, `counterOffer`), next to Layer 2's `channelEconomics`. `core.js` owns the Promotions/PromotionItems tabs, status, validation, promo sale rows and results. Views use the same engine for live verdicts.

**Tech Stack:** Vanilla ES5 (shared logic), ES modules (views), Google Apps Script + Sheets, Node tests (`node tools/test_core.js`), Python tools.

**Spec:** `docs/superpowers/specs/2026-11-13-costing-pricing-promotions-design.md`. Section 7 is this layer; also read section 6.1 (meaning of the Sales columns) and section 9 (UX). Layer 2 already added the Sales columns `promoId, listPrice, discount, platformDiscount`, and `menu.analysis` already leaves out rows with a `promoId`.

## Global Constraints

- `core.js` and `pricing.js` are plain ES5. `RestoPricing` is referenced only inside function bodies. New sheet columns are appended; old rows are never rewritten.
- **Sales row meaning (spec 6.1), per unit:**
  - `listPrice` = the channel price.
  - promo price = what the customer pays.
  - `discount` = the restaurant-funded part of (list − promo).
  - `platformDiscount` = the app-funded part.
  - `unitPrice` = list − `discount`, i.e. what the restaurant is credited.
  - `commission` = rate × base × qty. Rate = the promo's `campaignCommissionPct` when it isn't blank, else the channel rate. Base = promo price if the channel's `commissionOnDiscounted`, else list price.
- **CM before** = list × (1 − channel rate) − food cost − packaging. **CM during** = credited − commission per unit − food cost − packaging.
- **Cost % during** = (food cost + packaging) ÷ (credited − commission) × 100. This uses the same basis as Layer 2's `meetsTarget`. The displayed "food cost %" stays food only.
- **Verdict:**
  - `loss` when CM during < 0.
  - `profitable` when cost % during ≤ target + 5.
  - `thin` otherwise.
- **Break-even uplift** = CM before ÷ CM during − 1. It is `null` when CM during ≤ 0 (can't break even) or CM before ≤ 0.
- **Status:** `draft` and `cancelled` are stored. A saved, non-draft promotion is stored as `scheduled` and shown by date as `scheduled` (start > today), `active`, or `ended` (end < today).
- **Active for a sale** when all of these hold:
  - status is scheduled/active by date;
  - start ≤ date ≤ end (a blank end means open-ended);
  - the date's weekday (0 = Sunday) is in `weekdays` (blank = every day);
  - the channel is in `channelIds` (blank = all).
- **Sales entry stays daily totals per dish.** With no active promotion the screen is unchanged. Promo units are separate lines.
- **Results:**
  - Baseline = the 28 days before startDate, as per-day averages, on the promo's channels (all channels when blank).
  - Promo period = startDate → min(endDate, today), counted in calendar days.
  - Measures: promoted dishes' units/day, revenue/day and CM/day, plus the whole restaurant's revenue/day and CM/day on those channels.
  - CM = total − costTotal − commission.
  - "Weak comparison" when the baseline has fewer than 14 days with sales.
- All text is in EN and TH (`python tools/check_i18n.py`). Every new server message gets a `TH_RULES`/`TH_LABELS` entry, and there is a Thai sweep test.
- HTML only through the escaping `html` template.
- Phone-first, 44 px targets, labelled inputs, colour plus words for verdicts.
- `VERSION` 1.5.0, `CACHE` `resto-ops-v1.5.0`, demo key `ro.demo.db.v4`. Commit per task; never add `Claude outputs/`, `.claude/` or `.superpowers/`.

## Review Focus

1. **Degenerate promos:** 100 % off, an amount above the price, or a fixed price of 0 give a promo price of 0 and verdict `loss`, with no NaN/Infinity. → Task 1 test.
2. **Bundle whose component list prices sum to 0** splits the bundle price equally per unit; a bundle with one component works. → Task 1 test.
3. **Invalid "2+1" strings** (`'2'`, `'0+1'`, `'a+b'`, `'2+0'`) are refused on save with a clear message. → Task 2 test.
4. **A promo sale outside the promo's dates, weekdays or channels**, or for a dish not in it, is refused with a clear message. → Task 3 test.
5. **Results for a promo starting today, or with no baseline sales:** promo days = 1, change % = null, `weak: true`, and no division by zero. → Task 4 test.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `app/js/pricing.js` | modify | `parseBxgy`, `promoPrice`, `promoEconomics`, `counterOffer` |
| `app/js/core.js` | modify | Promotions/PromotionItems schema, status, `promotions.save/list/get/cancel/check/results`, promo lines in `sales.add` |
| `tools/tests/promo_engine.test.js`, `promotions.test.js` | create | Tests |
| `app/js/views/promotions.js` | create | Menu → Promotions tab: grouped list, detail sheet, results view |
| `app/js/views/promo-builder.js` | create | Builder stepper with sticky profit check; delivery-app offer check |
| `app/js/views/sales.js` | modify | Promo chips and promo/bundle lines in sales entry |
| `app/js/views/menu.js`, `channels.js` | modify | Promotions segment; "Check an offer" shortcut on delivery channels |
| `app/js/charts.js` | modify | `promoChart(container, days, baseline)` |
| `app/js/i18n.js`, `app/sw.js`, `app/js/demo.js`, docs | modify | Text, cache, demo promotions, version, HANDOVER/README |

---

### Task 1: Promotion profit engine (`pricing.js`)

**Interfaces, produced on `RestoPricing`:**
- `PROMO_TYPES = ['percentOff','amountOff','fixedPrice','bundle','buyXGetY']`.
- `parseBxgy(value) -> {x, y}|null`. Takes `'X+Y'` with integers X ≥ 1 and Y ≥ 1.
- `promoPrice(type, value, listPrice) -> Number` for per-dish types, never below 0:
  - percentOff: list × (1 − v/100)
  - amountOff: list − v
  - fixedPrice: v
  - buyXGetY: list × x ÷ (x + y)
- `promoEconomics({ type, value, platformFundedPct, campaignCommissionPct, targetPct, channel: { commissionPct, packagingCost, commissionOnDiscounted }, items: [{ id, name, listPrice, foodCost, qty }] })` returns `{ rows: [row], overall: row, worst: [ids] }`.
  - Each **row** is `{ id, name, listPrice, promoPrice, discount, platformDiscount, credited, commission, cmBefore, cmDuring, costPctDuring, foodCostPctDuring, uplift, verdict }`, all per unit (one bundle = one unit). Money is 2 dp; percentages are 1 dp.
  - **Bundle:** one row covering the whole bundle.
    - list = Σ list × qty; food = Σ food × qty; packaging = Σ qty × channel packaging.
    - Promo price = `value`.
    - Component split: by list share, or equal per unit when the list total is 0.
  - **Per-dish types:** one row per item. `overall` = the sums of all rows, with the verdict and uplift recomputed from those sums.
  - `worst` = up to 3 ids with the lowest `cmDuring` among non-`profitable` rows.
- `bundleSplit(items, bundlePrice) -> [{ id, unitPrice }]`: the per-unit promo price of each component, used by sales.
- `counterOffer({ ...same as promoEconomics but type percentOff }) -> { onTarget: { maxPct, excluded: [ids] }, breakEven: { maxPct, excluded: [ids] } }`.
  - Search 0–90 % in 0.5 steps.
  - **onTarget:** dishes not `profitable` at 0 % are excluded; maxPct is the highest % at which every remaining dish is `profitable`.
  - **breakEven:** dishes with CM during < 0 at 0 % are excluded; maxPct is the highest % at which every remaining dish has CM during ≥ 0.
  - `maxPct` is `null` when no dish is left.

- [ ] **Step 1: Write failing tests** in `tools/tests/promo_engine.test.js` (channel: commission 30, packaging 5, on discounted; target 30; dish list 120, food 30):
  - `promoPrice('percentOff',20,120) === 96`, `('amountOff',200,120) === 0`, `('fixedPrice',99,120) === 99`, `('buyXGetY','2+1',120) === 80`.
  - `parseBxgy('2+1')` → `{x:2,y:1}`. `'2'`, `'0+1'`, `'2+0'` and `'a+b'` → `null`.
  - **percentOff 20, platform 50 %:**
    - promo 96, discount 12, platformDiscount 12, credited 108
    - commission 28.8 (30 % × 96)
    - cmBefore 49 (84 − 30 − 5), cmDuring 44.2
    - uplift 0.109 (3 dp in the test via toFixed)
  - **Campaign commission 35 %** overrides: commission 33.6.
  - **commissionOnDiscounted false:** base is list 120, so commission 36.
  - **100 % off, platform 0:** promo 0, credited 0, commission 0, cmDuring −35, verdict `loss`, uplift `null`, no NaN anywhere (check every row value with `Number.isFinite` or `null`).
  - **Bundle** curry (list 139, food 48) + tea (list 55, food 12) at 179:
    - one row, list 194, food 60, packaging 10, promo 179
    - `bundleSplit` sums to 179, curry share ≈ 128.25
    - a bundle whose components all list at 0 splits equally
  - **counterOffer** on one dish (list 200, food 40, packaging 5, commission 30, platform 0): onTarget maxPct = the highest 0.5-step % with cost % ≤ 35. Assert the value against an independent brute-force loop in the test. A dish that is `loss` at 0 % lands in `breakEven.excluded`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run (PASS) and `python tools/build_backend.py`.
- [ ] **Step 5:** Commit `feat(pricing): promotion profit engine and counter-offer`.

---

### Task 2: Promotions as records

**Interfaces:**
- **Schema:**
  - `Promotions: ['id','name','type','value','channelIds','startDate','endDate','weekdays','platformFundedPct','campaignCommissionPct','status','note','createdAt','createdBy','updatedAt','updatedBy','version']`, ids prefixed `PRM`.
  - `PromotionItems: ['id','promoId','menuItemId','qty']`, ids prefixed `PRI`.
  - `TEXT_COLUMNS` gains `'channelIds','weekdays','startDate','endDate'`.
- `promoStatus(row, today) -> 'draft'|'cancelled'|'scheduled'|'active'|'ended'`.
- `promoActiveFor(promo, date, channelId) -> Boolean`.
- `promoRows(today) -> [{ id, name, type, value, channelIds: [], startDate, endDate, weekdays: [Number], platformFundedPct, campaignCommissionPct: Number|null, status, note, version, items: [{ menuItemId, name, qty }] }]`.
- `A['promotions.save']` (manager, write). Payload `{ item: { id?, version?, name, type, value, channelIds[], startDate, endDate?, weekdays[], platformFundedPct?, campaignCommissionPct?, note, draft: Boolean }, items: [{ menuItemId, qty? }] }`.
  - Status saves as `draft` if `draft`, else `scheduled`.
  - It replaces the PromotionItems rows as a whole.
  - It returns the promotion from `promoRows`.
- **Validation messages** (each with a Thai translation):
  - `Unknown promotion type.`
  - `Discount must be between 0 and 100 %.` (percentOff)
  - `Amount must be greater than 0.`
  - `Buy-X-get-Y must look like 2+1.`
  - `Choose at least one dish.`
  - `A bundle needs at least two dishes.` (Σ qty ≥ 2)
  - `End date can't be before the start date.`
  - `Platform share must be between 0 and 100 %.`
  - `Commission must be between 0 and 99.9 %.` (reused)
  - `Promotion "X" already exists.` (active names only, via assertUnique)
  - Dishes and channels must exist (`findOrFail`).
- `A['promotions.cancel']` (manager, write): `{ id }`. Sets `cancelled`. Refuses one already cancelled: `This promotion is already cancelled.`
- `A['promotions.list']` (manager): `{ today }` → `promoRows(today)`, each with an `economics` summary per channel: `{ channelId, verdict, cmBefore, cmDuring, uplift }` from `promoEconomics`, using each dish's channel price and current food cost.
- `A['promotions.get']` (manager): `{ id, today }` → the row plus full `promoEconomics` per channel (channels = `channelIds`, or all active channels when blank).
- `A['promotions.check']` (manager): `{ item, items, channelId }`, unsaved → `{ economics, counterOffer }`. `counterOffer` is only filled for `percentOff`.
- `bootstrap` gains `promotions`: rows whose status is `scheduled` or `active` with endDate blank or ≥ today − 1, without economics, for sales entry.

- [ ] **Step 1: Write failing tests** in `tools/tests/promotions.test.js`:
  - save a percentOff → `status 'scheduled'`, version 1
  - `promoRows` status by date: a future start → scheduled; start today → active; end yesterday → ended
  - draft stays `draft`
  - cancel → `cancelled`; a second cancel → VALIDATION
  - every validation message above
  - bundle with 1 dish × qty 1 → VALIDATION
  - staff save → FORBIDDEN
  - `promotions.get` economics verdict for the Task 1 example matches `RestoPricing.promoEconomics` directly
  - `promotions.check` for percentOff returns `counterOffer`
  - Thai sweep over the new messages
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run (PASS) and build.
- [ ] **Step 5:** Commit `feat(core): promotions with status, validation and profit check`.

---

### Task 3: Promo lines in sales

**Interfaces:** `sales.add` lines accept `{ menuItemId, qty, promoId }` for per-dish promos and `{ promoId, qty }` for a bundle (qty = number of bundles).

- **Server-side checks:**
  - The promo must be `promoActiveFor(promo, date, channel.id)`, else `Promotion "X" isn't running on this date and channel.`
  - The dish must be in the promo, else `Dish isn't in this promotion.`
  - The server never trusts client prices on promo lines; an explicit `unitPrice` is ignored.
- **Per-dish row:** stores `promoId`, `listPrice` (channel price), `discount`, `platformDiscount`, `unitPrice` (credited) and `total`, with commission computed as in Global Constraints.
- **Bundle line:** writes one row per component, qty = bundles × component qty, unit prices from `bundleSplit`. `discount` and `platformDiscount` are per unit, from the component's list price minus its split price. Stock is deducted as normal.
- `sales.list` rows gain `promoId`, `discount`, `platformDiscount`.

- [ ] **Step 1: Write failing tests** (appended to `promotions.test.js`):
  - **percentOff 20 on Grab (platform 50):** 2 units → unitPrice 108, total 216, commission 57.6, discount 12, platformDiscount 12, promoId set.
  - **Bundle × 2** → 2 curry rows + 2 tea rows, Σ total = 358, each with promoId.
  - **buyXGetY 2+1** on dine-in, list 120 → unitPrice 80.
  - **Refusals:** a date outside the promo, a weekday not allowed, a channel not in the promo, a dish not in the promo.
  - **Stock** is deducted for bundle components.
  - **Ignored price:** `unitPrice` sent on a promo line is ignored.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run (PASS) and build.
- [ ] **Step 5:** Commit `feat(core): record promotion sales`.

---

### Task 4: Promotion results

**Interfaces:** `A['promotions.results']` (manager): `{ id, today }` →
```
{ baseline: { from, to, daysWithSales }, period: { from, to, days }, weak,
  promoted: { before: { units, revenue, cm }, during: {...}, change: { units, revenue, cm } },   // per day; change = % (1 dp) or null
  restaurant: { before: { revenue, cm }, during: {...}, change: { revenue, cm } },
  verdict: 'worked' | 'soldMoreEarnedLess' | 'didNotWork' | 'tooEarly',
  daily: [{ date, cm, inPromo }] }   // promoted dishes' CM per day, baseline 28 days + promo days
```
- **Verdict:**
  - `tooEarly` when the promo hasn't started (start > today).
  - `worked` when restaurant CM change ≥ 0.
  - `soldMoreEarnedLess` when promoted units change > 0 and CM change < 0.
  - `didNotWork` otherwise.
  - A null change is treated as 0.
- Promoted dishes = the promo's PromotionItems. Rows count whether or not they were sold at promo price. Channels = `channelIds` (blank = all), resolved with `resolveChannel`.

- [ ] **Step 1: Write failing tests:**
  - **Seeded data:** 28 baseline days at 10/day of dish A on Grab (appended rows), then a 7-day promo with 15/day at the promo price.
    - before units 10, during 15, change +50
    - CM figures independently computed in the test
    - verdict follows the sign
    - `daily.length` = 35
  - **Promo starting today with no baseline sales:**
    - period days 1
    - changes null
    - weak true
    - verdict `worked` (null → 0)
  - **Future promo** → `tooEarly`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run (PASS) and build.
- [ ] **Step 5:** Commit `feat(core): promotion results against the previous 4 weeks`.

---

### Task 5: Promotions tab and builder

**Files:** create `views/promotions.js` and `views/promo-builder.js`; modify `views/menu.js`, `i18n.js` and `sw.js`.

- **Menu hub segments:** Dishes · Preps · Pricing · Analysis · **Promotions** (manager+). Use a horizontally scrolling `.seg` if it overflows at 375 px.
- **List** (`renderPromotions(ctx, host)`):
  - Groups Active · Scheduled · Drafts · Ended (cancelled shown under Ended with a pill).
  - Each card shows the name, type summary (e.g. "20 % off · Grab, LINE MAN · until 30 Nov"), the worst-channel verdict pill (good/warn/bad, with an icon and a word) and uplift ("Needs +38 % orders to break even").
  - Two buttons at the top: "New promotion" and "Check a delivery app offer".
- **Builder** (`promoBuilder(ctx, promo?)`) is a bottom sheet with steps 1–4:
  1. **Type & dishes:** type chips; dish multi-select with search; for a bundle, each dish gets a qty stepper.
  2. **Value:** the input changes by type (%, amount, fixed price, bundle price, "Buy [x] get [y]"), plus "Who pays the discount" (Us / Split [platform %]) and "Campaign commission %" (optional, delivery only), both behind "More options".
  3. **Channels & dates:** channel chips (default: all active), start/end dates, weekday chips.
  4. **Profit check:** a table per channel with each dish's verdict, CM before → during, uplift; the worst offenders; the plain-language reason.
  - A **sticky footer summary**, visible from step 2 on, shows the worst-channel verdict and CM during for the current inputs, updated live with `RestoPricing.promoEconomics`.
  - Footer buttons: Back / Next / "Save as draft" / "Schedule".
- **Detail sheet** (tap a card):
  - Status, dates, channels and dishes.
  - The economics table from `promotions.get`.
  - Buttons: Results (active/ended), Edit (draft/scheduled), Cancel (confirmSheet).
- [ ] i18n EN+TH, `check_i18n`. Implement. **Browser check by script:** create every type; the live verdict changes when the discount changes; a draft saves; schedule; cancel; no console errors. Commit `feat(ui): promotions list and builder with live profit check`.

### Task 6: Delivery-app offer check

**Files:** `views/promo-builder.js` (`offerCheck(ctx, channelId?)`), `views/channels.js` (a "Check an offer" button in a delivery channel's sheet), `i18n.js`.

- **Inputs:**
  - Channel: delivery channels, defaulting to the first or to the given one.
  - Discount: % or amount toggle.
  - Who funds it: you / split with a platform %.
  - Campaign commission %, optional, placeholder = the channel rate.
  - Dishes: default all active dishes with recipes; a "Choose dishes" sheet.
- **Output, live:**
  - The overall verdict pill and sentence ("You'd lose ฿x per order on 3 dishes").
  - A per-dish table (dish, credited, CM before → during, verdict) and the worst offenders.
  - The break-even uplift.
  - The counter-offer card from `RestoPricing.counterOffer`: "Join at up to X % off and stay on target (leave out N dishes)" / "Up to Y % off still breaks even". Server and client use the same engine.
- **"Save as draft promotion"** opens the builder pre-filled with type percentOff or amountOff, the channel, the dishes and the funding.
- [ ] i18n; implement; browser check by script; commit `feat(ui): delivery app offer check with counter-offer`.

### Task 7: Promo lines in sales entry, and results view

**Files:** `views/sales.js`, `views/promotions.js` (results), `charts.js` (`promoChart`), `i18n.js`.

- **Sales entry:**
  - After the date and channel are chosen, the active promotions for that date and channel come from `boot.promotions`, filtered on the client with the same rules as the server (`promoActiveFor` logic duplicated in a tiny client helper; the server re-checks).
  - They appear as a chip row. Tapping a chip adds, under each promoted dish, a promo line ("Pad Thai · Grab 20 % off", promo price shown) with its own stepper. A bundle shows one bundle row ("Curry + Thai tea set ฿179") with a stepper counting bundles.
  - The running total uses promo prices. The payload sends promo lines as in Task 3.
  - Changing channel or date drops the chips that no longer apply, after confirming if they have quantities.
  - With no active promotion the screen is unchanged.
- **Results** (detail sheet → Results):
  - A verdict banner ("Worked: +22 % profit per day" / "Sold more, earned less: −9 % profit per day" / "Didn't lift sales" / "Not started").
  - Two comparison cards: promoted dishes (units, revenue, margin per day, before → during with % change) and the whole restaurant on those channels (revenue, margin per day).
  - The weak-baseline notice.
  - `promoChart`: daily CM bars for promoted dishes, promo days highlighted, the baseline average as a dashed line, an accessible title.
- [ ] i18n; implement; browser check by script (record promo sales and bundle sales; results render); commit `feat(ui): promotion sales entry and results`.

### Task 8: Demo data v4, version 1.5.0, docs

- Demo key `ro.demo.db.v4`; `VERSION` 1.5.0; `CACHE` v1.5.0; smoke test expects 1.5.0 (RED first).
- **Three demo promotions with sales:**
  - **A — ended, profitable:** dine-in "Weekday mango" 15 % off Mango Sticky Rice, Mon–Thu, days −40 → −26. Lifts units about 40 %.
  - **B — ended, loss-making:** Grab 40 % off Pad Thai, funded by us, campaign commission 35 %, days −24 → −15. Units roughly double; margin drops.
  - **C — active:** LINE MAN bundle Green Curry + Thai Iced Tea at ฿179 (list ฿200), from day −6, no end.
  - Promo sales go through `sales.add` promo lines. Normal sales keep their pattern.
- **Docs:**
  - HANDOVER: section 4 (Promotions, PromotionItems; the promo meaning of the Sales columns), section 5 (promo engine formulas, verdicts, status rules, results), section 6 (new actions plus `sales.add` promo lines), version header 1.5.0 with a Layer 3 note.
  - README: a "Promotions" row and a line in "How the numbers work".
- **Verify:** scratchpad seed check (EN and TH: no errors, 3 promos with the expected verdicts and results) plus browser load of the demo. Then `node tools/test_core.js`, `check_i18n`, `build_backend`. Commit `feat: v1.5.0 promotions demo data and docs`.
