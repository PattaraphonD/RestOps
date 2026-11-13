# Expert costing, pricing & promotions: design

**Date:** 2026-11-13 · **Status:** draft for approval · **App version today:** 1.2.0

## 1. Intent

The owner wants Restaurant Ops to work like an expert's tool: the costing, pricing and promotion
controls a professional food-cost controller expects, usable by restaurants anywhere, not only in
Thailand. Today the app covers stock, basic recipe costing, sales, expenses, purchasing and reports.
This work adds the next level: real yields, sub-recipes, unit conversion, production batches,
per-channel prices with delivery commissions, menu engineering, promotions checked against real cost
before they run and measured after, and SOP manuals generated from recipes.

**Who uses it:** owners and managers (costing, pricing, promotions, analysis) and kitchen staff
(production runs, SOPs). Mostly on phones, in English or Thai.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Every dish cost reflects real purchase prices, trim loss and sub-recipe costs, automatically.
2. Every price decision (channel price, promotion, delivery-app campaign) shows its profit impact
   *before* it is made, in plain language, with a clear verdict.
3. Kitchen staff can record a production batch in under a minute and follow an SOP on a phone.
4. Works for any country: delivery apps, commissions, units and currency are configuration, with
   sensible presets (Thai presets when the app is set up in Thai).
5. Same quality bar as the existing app: English + Thai everywhere, light/dark, phone-first,
   append-only ledgers, optimistic concurrency, roles enforced on the server.

**Non-goals (this round)**
- Tax-inclusive revenue accounting (VAT/GST split in the P&L). Prices stay as entered, like today.
- Buying in pack units (e.g. "receive 2 cases") on the stock-in and PO forms. Unit conversion is
  built so this can be added later, but those forms stay in the ingredient's base unit.
- POS integration or automatic import of delivery-app sales/payout reports.
- Photo uploads (Sheets has no file storage). SOP steps may carry an image *link*.
- Time-of-day promotions (happy hour). Promotions are by date range and weekday.

**Anti-goals (would be a failure even if it works)**
- Numbers that silently change history. Old sales keep their cost snapshot; new snapshots only.
- Screens that show a wall of figures without telling the user what to do. Every analysis ends in a
  verdict or recommendation.
- Making daily staff tasks (sales entry, stock in) slower or more complicated than today.
- Thailand-only assumptions baked into code (channel names, commission rates, unit names).

## 3. Constraints (from the existing architecture, keep them)

- All business rules live in `app/js/core.js` (plain ES5, no DOM), shared by Apps Script and demo.
  Regenerate `backend/Core.gs` with `tools/build_backend.py` after every change.
- Database is one Google Spreadsheet. New tables = new tabs; new columns are **appended** to existing
  tabs so live sheets upgrade in place (`prepareTab_()` in `Server.gs`).
- Ledgers are append-only with `voided`; master data carries `version`; every write is locked.
- Vanilla JS ES modules, no build step, no framework. UI via the escaping `html` template in `ui.js`.
- Every text key exists in English and Thai (`tools/check_i18n.py` must pass).
- Apps Script performance: whole-tab reads per request; keep computations O(rows), avoid per-row reads.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | **Four layers, each shipped and usable before the next:** 1 costing foundation → 2 pricing & analysis → 3 promotions → 4 SOPs | Every later feature reads costs from layer 1, so numbers are right from the first screen the user sees. Slower to show the flashy parts. |
| B | One big release with all features | Fewer handovers, but one huge change that is hard to test; any problem blocks everything. |
| C | Visible features first (promotions, pricing), foundation later | Faster demo, but every price and promo figure shifts once yield and sub-recipes land, undermining trust. |

The owner chose **A**. Each layer bumps the minor version (1.3 → 1.6) and the service-worker cache.

## 5. Layer 1: costing foundation (v1.3)

### 5.1 Units and conversion

Today units are free text (`kg`, `กก.`, `pcs`) and recipes must use the ingredient's own unit.

- **Built-in unit catalogue** in `core.js`: a code, a family and a factor to the family's base.
  - mass (base g): `mg, g, kg, oz, lb`
  - volume (base ml): `ml, l, tsp, tbsp, cup, floz, pt, qt, gal` (US measures; label says so)
  - count (base pcs): `pcs, dozen`
  - **Aliases** map existing free text to codes, case-insensitive: `kg, kilo, กก., กิโลกรัม → kg`;
    `g, gram, กรัม → g`; `L, liter, litre, ลิตร → l`; `ml, มล. → ml`; `pcs, piece, ชิ้น, ฟอง, ลูก → pcs`, etc.
    Unknown text (e.g. `pack`, `bottle`, `ขวด`) is a **custom unit** of its own.
  - Display labels come from `i18n.js` (English and Thai), so users still see `กก.` in Thai.
- **Per-ingredient conversions** (new tab `IngredientUnits`): `1 <unit> = <factor> <ingredient unit>`.
  Examples: `1 bottle = 0.7 l` for an ingredient stocked in L; `1 pcs = 55 g` for eggs stocked in pcs
  (bridges families); `1 case = 24 bottle`. Edited in the ingredient sheet ("Other units" section).
- `convert(qty, fromUnit, ingredient)` → quantity in the ingredient's stock unit, or a `VALIDATION`
  error ("Can't convert tbsp to pcs for Eggs. Add a conversion on the ingredient.").
- Stock, purchases and costPerUnit stay in the ingredient's stock unit (no migration of numbers).

### 5.2 Yield (trim loss)

- Ingredients get `yieldPct` (default 100). Meaning: usable share after trimming/peeling/thawing.
- **Recipe quantities are the usable (net) amount** the cook puts in the dish, the industry
  convention (EP, edible portion). The app derives the gross amount bought (AP):
  `grossQty = netQty ÷ (yield/100)`.
- Recipe lines may override yield (`yieldPct` on the line) when a dish trims differently
  (e.g. whole fish filleted vs. whole fish fried). Blank = use the ingredient's yield.
- **Line cost** = `convert(netQty, lineUnit) ÷ yield × costPerUnit`.
- **Stock deducted on sale** = the gross quantity (that's what left the shelf).
- The ingredient sheet shows a small **yield calculator**: "Bought 10 kg, usable 7.2 kg → 72 %".

### 5.3 Sub-recipes (prep items)

A sauce, stock, curry paste or dough is a **prep item**: an ingredient with `kind = 'prep'`.
Because it *is* an ingredient, it already has a unit, stock level, cost, min level, and can be used
in any dish recipe or inside another prep without new plumbing.

- `Ingredients` gets `kind` (`raw` | `prep`, blank = raw), `batchQty` (how much one batch makes,
  in the prep's unit), `shelfLifeDays`, `allergens` (see layer 4).
- New tab `PrepRecipes` (lines of a prep): `id, prepId, ingredientId, qty, unit, yieldPct, note`.
  Lines may reference raw ingredients or other preps. **Max nesting depth 4; cycles rejected** on save
  ("Green curry paste can't contain itself (via Chilli oil).").
- **Theoretical cost per unit** = Σ line costs ÷ batchQty, computed recursively, live.
- **Cost used in dishes (owner's decision): the theoretical recipe cost**, always live. When chilli
  goes up, every dish using chilli sauce updates immediately. The prep's `costPerUnit` column is kept
  equal to the theoretical cost (recomputed whenever a purchase changes any ingredient inside it, and
  on prep save), so stock value and every existing calculation keep working unchanged.
- **Actual cost from production runs is shown as a variance**, never fed into dish cost: the prep
  screen shows the average actual unit cost of the last 5 runs next to the recipe cost and flags a gap
  > 10 % ("Batches came out 14 % dearer than the recipe: check yields or portioning").
- **Stock-tracked or made to order**: prep items have `trackStock` (default TRUE).
  - TRUE: selling a dish deducts the prep from stock (it was produced earlier).
  - FALSE (e.g. a dressing mixed per order): selling a dish deducts the prep's own ingredients
    (exploded through the prep recipe, with yields), and the prep cost is always theoretical.
- Preps appear in Stock like any ingredient, with a "Prep" badge and filter. They can't be bought
  through POs (excluded from reorder suggestions) but can be counted and wasted.

### 5.4 Weighted-average cost: make it visible

Already implemented in `addPurchases`. This layer adds what an expert expects around it:
- **Cost history** on each ingredient: list of cost changes (date, old → new, source: purchase /
  production) built from Purchases + production movements; small sparkline.
- **Impact toast after receiving**: "Pork belly cost +8 % → 6 dishes now cost more. 2 are above your
  30 % target." with a link to the affected dishes. Dishes affected **through preps** count too
  (the prep's cost moves with its ingredients).
- Cost history for a prep is derived from its ingredients' changes (recorded when the prep's
  costPerUnit is recomputed), shown the same way.
- Dish cost on the Menu screen always uses current costs (as today); sale snapshots unchanged.

### 5.5 Production runs (BOM with yield)

Recording that the kitchen made a batch of a prep item.

- New tab `ProductionRuns`: `id, runNo, date, prepId, batches, expectedQty, producedQty, unit,
  inputCost, byproductValue, totalCost, unitCost, yieldPct, producedBy, note, voided, createdAt, createdBy`.
  `runNo` is sequential (`PR-0001`). `producedBy` is the person who cooked (picked from active users,
  defaults to the signed-in user; this is distinct from `createdBy`).
- Ingredient consumption and outputs are **StockMovements** (no new ledger), `refId = run id`:
  - `production` (negative): each input, gross qty after unit conversion, valued at current cost.
  - `produce` (positive): the prep item, qty = producedQty, unitCost = run unit cost.
  - `byproduct` (positive): e.g. pork crackling from rendering lard, bones for stock.
- **Flow (staff can do it):**
  1. Pick the prep, enter number of batches. Inputs pre-fill as recipe × batches (gross, converted).
  2. Adjust any input to what was actually used (optional; most runs won't).
  3. Enter the quantity actually produced (pre-filled with batchQty × batches).
  4. Optionally add by-products (ingredient + qty).
  5. Save → stock moves, prep cost updates.
- **Costing:** `inputCost` = Σ input qty × current costPerUnit. By-products are valued at their current
  costPerUnit (**net realisable value method**: their value is credited against the run). 
  `totalCost = inputCost − byproductValue`; `unitCost = totalCost ÷ producedQty`.
  `yieldPct = producedQty ÷ expectedQty`. Shown with a verdict: under 95 % → warn.
- The run stores its **actual** `unitCost` and the `produce` movement is valued at it (so the
  production log and variance are real), but the prep's `costPerUnit` stays at the theoretical recipe
  cost (5.3). By-product ingredients' costs are **not** changed by the run.
- **Void** (manager): voids the run and all its movements together (like sales voids). It does not
  roll back the weighted-average cost (same as purchase voids today; documented).
- Warnings, not blocks: inputs that would go below zero stock show "Only 1.2 kg on hand" but still
  save (kitchen reality: counts are often behind).

### 5.6 Recipe changes to dishes

- `Recipes` gets appended columns `unit`, `yieldPct`. Blank unit = ingredient unit (old rows work).
- Recipe editor: each line has ingredient (raw or prep, grouped), net qty, unit picker (only units
  convertible for that ingredient), optional yield override behind "More", and live line cost.
- Dish cost breakdown shows the share of each line (bar), so the costliest component is obvious.

## 6. Layer 2: pricing & analysis (v1.4)

### 6.1 Sales channels become real records

- New tab `Channels`: `id, name, type (dineIn | takeaway | delivery | other), commissionPct,
  packagingCost (per dish), commissionOnDiscounted (TRUE/FALSE), active, sortOrder, createdAt,
  updatedAt, updatedBy, version`. **No per-order fees**: sales are entered as daily totals per dish,
  so there is no order count to charge them against.
- **Migration (only demo data exists today):** if `Channels` is empty, create one row per name in
  the existing `salesChannels` setting (type guessed from name, commission 0); old sales keep their
  channel name and get `channelId` by matching that name. The demo seeder is rewritten for the new
  model (bump the demo storage key to `ro.demo.db.v2` so devices reseed). `prepareTab_()` still adds
  new tabs/columns for a fresh sheet; no live-data migration tooling is needed.
- **Presets** (when adding a channel): Grab, LINE MAN, foodpanda, ShopeeFood, Robinhood, Uber Eats,
  DoorDash, Deliveroo, Just Eat, plus "Other delivery app". A preset fills name + type + a typical
  commission the user **must confirm** (label: "Typical rate; check your contract").
  Presets list is data in `i18n.js` defaults, not logic.
- `Sales` gets appended `channelId, commission, promoId, listPrice, discount, platformDiscount`.
  Meaning of the stored numbers (fixed, so history stays right):
  - `unitPrice` / `total` = what the **restaurant is credited** before commission =
    list price − the restaurant-funded part of any discount.
  - `discount` = restaurant-funded discount per unit; `platformDiscount` = the part the app paid.
  - `commission` = snapshot of rate × base × qty, where rate = the promotion's campaign rate if the
    line has a promo that sets one, else the channel rate; base = discounted price if the channel's
    `commissionOnDiscounted`, else list price.
- Reports gain a **"Channel commissions"** P&L line between revenue and gross profit, and
  revenue/profit **by channel**.
- **Food cost % stays on the menu price everywhere** (Menu flags, reports, dashboard), as today, so no
  existing figure shifts. Delivery profitability is expressed as **contribution margin after
  commission**; pricing screens additionally show "food cost % of net revenue" clearly labelled.

### 6.2 Channel prices and suggested prices

- New tab `MenuPrices`: `id, menuItemId, channelId, price` (blank row = use base price).
- Sales entry uses the channel's price automatically (still overridable as today).
- **Per dish × channel economics** (shown in the dish sheet "Prices" section as a compact table):
  - net revenue = price × (1 − commission%)
  - contribution margin (CM) = net revenue − food cost − packaging
  - food cost % of net revenue
  - **suggested price** = (food cost + packaging) ÷ (target% × (1 − commission%)), then rounded by the
    `priceRounding` setting (`none | 1 | 5 | 10 | 0.99 | 9-ending`), default by currency (THB → 5).
  - A one-tap "Use suggested" per channel, and "Apply to all dishes on this channel" with a preview
    list (old → new) before saving.
- Target: existing `targetFoodCostPct`. New optional setting `targetMarginPct` is **not** added;
  one target keeps it simple and matches how the app already flags dishes.

### 6.3 Menu profitability analysis (menu engineering)

New screen **Menu → Analysis** (manager+). Period (this month / last month / last 4 weeks / custom)
and channel filter (all or one).

- Uses sales snapshots: per dish units sold, revenue, food cost, commission, **CM per dish** =
  (revenue − cost − commission) ÷ units.
- **Promo-price sales are excluded by default** (so a campaign doesn't turn a Star into a
  Plowhorse), with an "Include promotion sales" switch.
- Classic **Kasavana–Smith matrix**:
  - Popular if menu mix % ≥ 70 % × (1 ÷ number of dishes sold in period).
  - High margin if CM per dish ≥ the sales-weighted average CM.
  - **Star** (popular, high margin): keep, protect quality, feature.
  - **Plowhorse** (popular, low margin): re-cost: check portion, yield, price +5–10 %.
  - **Puzzle** (unpopular, high margin): promote: reposition on menu, staff upsell, photo.
  - **Dog** (unpopular, low margin): replace or rework.
- UI: 2×2 quadrant chart (bubble = revenue, tap a dot → dish), then a list grouped by quadrant with a
  one-line recommendation and the numbers behind it. Dishes over the food-cost target get a red flag
  everywhere. Fewer than ~5 dishes sold or < 14 days of data → a notice that results are indicative.
- Also a **"Needs attention"** card on the dashboard: top 3 dishes by lost margin vs target
  ("Pad krapow: 41 % food cost on Grab; suggested price ฿95").

## 7. Layer 3: promotions (v1.5)

### 7.1 Data

- `Promotions`: `id, name, type, value, channelIds (csv; blank = all), startDate, endDate, weekdays
  (csv 0–6; blank = every day), platformFundedPct, campaignCommissionPct, status (draft | scheduled |
  active | ended | cancelled; derived from dates except draft/cancelled), note, createdAt, createdBy,
  updatedAt, updatedBy, version`.
- `PromotionItems`: `id, promoId, menuItemId, qty` (the dishes it applies to; for bundles, components).
- **Types:** `percentOff`, `amountOff`, `fixedPrice` (per dish), `bundle` (set of dishes for a fixed
  price, e.g. "curry + rice + drink ฿199"), `buyXGetY` (e.g. buy 2 get 1; value = "2+1").

### 7.2 Profit engine (one function, used by builder, delivery check and results)

`promoEconomics(promo, channel, menu)` → for each item (or the bundle as a whole):
- list price on that channel, promo price, discount
- restaurant-funded discount = discount × (1 − platformFundedPct)
- commission = rate × (discounted price if `commissionOnDiscounted`, else list price);
  rate = `campaignCommissionPct` if set (apps often charge more during campaigns), else channel rate
- CM before and CM during, food cost % during
- **break-even uplift** = CM before ÷ CM during − 1 ("You need 38 % more orders to earn the same profit")
- **Verdict:** `profitable` (CM during ≥ 0 and food cost % ≤ target + 5), `thin` (CM ≥ 0 but above
  that), `loss` (CM < 0). Shown as green / amber / red with the reason in words.

### 7.3 Promotion builder (Menu → Promotions)

Stepper in a bottom sheet: **1 Type & dishes → 2 Value → 3 Channels & dates → 4 Profit check → Save**.
The profit check is always visible as a sticky summary at the bottom once dishes are chosen, so the
user sees the verdict change as they type the discount. Save as draft or schedule. List screen groups
**Active · Scheduled · Drafts · Ended**, each card showing the verdict pill.

### 7.4 Delivery-app promotion check

A focused calculator for the moment the app's account manager calls with an offer:
"Should I join Grab's 20 % off campaign?" Entry points: Menu → Promotions → "Check a delivery app
offer", and a shortcut on each delivery channel.

Inputs: channel, discount (% or amount), who funds it (you / split %), campaign commission rate,
which dishes (default: all on that channel). Output: per dish verdict table, overall verdict, worst
offenders, break-even uplift, and **a suggested counter-offer**: the maximum discount at which every
selected dish still meets the target ("Join at up to 12 % off, or exclude 3 dishes"). One tap saves it
as a draft promotion.

### 7.5 Applying promotions to sales

- Sales entry stays **daily totals per dish** (no order count; the daily flow must not get slower).
- After choosing date + channel, active promotions for that day/channel appear as a chip row.
  Choosing one adds a **separate promo line** under each promoted dish ("Pad thai · Grab 20 % off")
  with its own +/− stepper at the promo price, so a day's units at list price and at promo price are
  recorded side by side. With no active promotion, the screen looks exactly as today.
- **Bundles and buy-X-get-Y are recorded as an effective unit price per dish**: a bundle line's
  stepper counts bundles and writes one sale row per component dish, revenue split in proportion to
  list prices; buy 2 get 1 is priced at 2⁄3 of list per unit.
- Each promo sale row stores `promoId`, `listPrice`, `discount`, `platformDiscount` (6.1). Stock
  deduction is unchanged (real dishes sold).

### 7.6 Promotion results

For an active or ended promotion (Promotions → tap → Results):
- **Baseline** = the **4 weeks (28 days) before startDate**, averaged per day, for the same channels.
  **Promo period** = start → min(end, today), averaged per day.
- For the promoted dishes: units/day, revenue/day, CM/day, before vs during, with % change.
- For the whole restaurant on those channels: revenue/day and CM/day (catches cannibalisation: the
  promo sold more of dish A but less of everything else).
- Verdict: "Worked: +22 % profit per day" / "Sold more, earned less: −9 % profit per day".
- Small chart: daily CM, baseline average as a dashed line, promo days highlighted.
- If the baseline has < 14 days of sales, show a notice that the comparison is weak.

## 8. Layer 4: SOP manuals (v1.6)

Generated from recipes, completed by the manager, read by staff.

- `Menu` and `Ingredients` (preps) get appended: `portionNote` (plating/portion), `holdingNote`
  (temperature/holding), `equipment`, `prepMinutes`. Ingredients get `allergens` (csv of codes).
- New tab `SopSteps`: `id, ownerId (dish or prep id), stepNo, text, minutes, imageUrl, critical (TRUE =
  food-safety/critical control point)`.
- **Allergens:** the 14 major allergens (EU list, also covers the US big-9 except sesame, which is
  already in the 14) as codes with EN/TH labels. A dish's allergens are derived from its ingredients
  and preps recursively, never typed by hand.
- **SOP view** (Menu → dish → SOP, Stock → prep → SOP, and an "SOP manual" index under Kitchen):
  header (name, photo link, yield/portion, time), allergen badges, **ingredients with quantities
  scaled** by a portions/batches stepper (unit-aware: 1,500 g shows as 1.5 kg), numbered steps with
  critical steps highlighted, plating/holding notes, shelf life for preps.
- **Print / share:** clean print stylesheet (one SOP per A4, or the whole manual), and share via the
  Web Share API where available.
- Staff: view only. Manager: edit steps with drag-to-reorder (up/down buttons as the accessible path).

## 9. Navigation & UX

Bottom nav stays (Home · Stock · Orders · Sales · More). Daily staff flows are not changed.

- **Menu** becomes a hub with a segmented control: **Dishes · Preps · Pricing · Analysis · Promotions**
  (staff see Dishes and Preps only). Reached from More → Kitchen (as today) and from dashboard cards.
- **Stock:** "Produce batch" joins the existing quick actions (Stock in / Usage / Waste / Count);
  prep items have a badge and filter; ingredient sheet gains yield, other units, cost history.
- **More → Setup → Sales channels** (manager+) replaces the comma list in Settings.
- **More → Kitchen → SOP manual** and **Production log**.
- **Home (manager):** "Needs attention" card (dishes over target, promos losing money, low yields).

**UX principles for every new screen** (follow the existing design system in `app.css`):
- Live numbers: every input that affects cost or profit updates the result immediately.
- Verdict first, numbers second: a coloured pill + one sentence, then the breakdown.
- Plain words with an expert term in small text where it helps ("Plowhorse · popular, low margin").
- Progressive disclosure: advanced fields (yield override, by-products, campaign commission) behind
  "More options".
- Destructive or bulk actions show a preview (old → new) and confirm.
- Empty states that teach ("No preps yet. A prep is a sauce or stock you make in batches…").
- Accessible: 44 px targets, labels on every input, colour never the only signal (icons + words).

## 10. Demo data

`demo.js` seeds, in both languages: unit aliases on existing items, yields (fish 45 %, onions 90 %,
chicken thigh 80 %…), 4 preps (green curry paste, chicken stock, nam jim seafood sauce, chilli oil,
one nested), 8 weeks of production runs with realistic yield variance and a by-product (chicken
bones → stock), channels Dine-in / Takeaway / Grab 30 % / LINE MAN 30 % with channel prices on most
dishes, sales spread across channels, 3 promotions (one profitable ended, one loss-making ended,
one active), SOP steps for 4 dishes and 2 preps, allergens on ingredients.

## 11. API additions (all through `A[...]` in core.js)

| Action | Role | Write |
|---|---|---|
| `ingredients.save` (extended: kind, yieldPct, batchQty, trackStock, shelfLifeDays, allergens, units[], prepRecipe[]) | manager | ✓ |
| `ingredients.costHistory` | manager | |
| `production.add` / `.list` / `.void` | staff / staff / manager | ✓ / – / ✓ |
| `menu.save` (extended: recipe lines with unit, yieldPct; prices[]; SOP fields) | manager | ✓ |
| `channels.save` | manager | ✓ |
| `menu.analysis` (period, channelId) | manager | |
| `promotions.save` / `.list` / `.get` / `.cancel` | manager | ✓ / – / – / ✓ |
| `promotions.check` (unsaved promo → economics) | manager | |
| `promotions.results` (id, today) | manager | |
| `sop.save` (ownerId, steps[]) / `sop.get` | manager / staff | ✓ / – |
| `sales.add` (extended: channelId, promoId per line) | staff | ✓ |
| `reports.summary` (extended: commissions, by-channel) | manager | |

`bootstrap` additionally returns channels, menu prices and active promotions; heavy data (analysis,
results, cost history, production list) is fetched on demand.

## 12. Testing & verification

- `core.js` is pure; add a Node test script (`tools/test_core.js`, no dependencies, runs core with an
  in-memory db) covering: unit conversion and aliases, yield maths, recursive prep cost and cycle
  detection, production run costing incl. by-products and void, channel economics and suggested price
  rounding, promo economics for every type, menu-engineering classification, promo results baseline.
- `tools/check_i18n.py` passes; `build_backend.py` run.
- Each layer is checked in demo mode in a browser at phone width, in English and Thai, light and dark.
- `Server.gs` `prepareTab_()` handles new tabs/columns; verify with a sheet that has v1.2 headers.

## 13. Decided by the owner

- Build in four layers, costing foundation first (approach A).
- Aim: expert-grade and usable globally; Thai presets stay as defaults when set up in Thai.
- Prep cost used in dishes = **theoretical recipe cost**; actual production cost shown as variance.
- Only demo data exists, so no live-data migration is needed.

## 14. Calls made by the designer (check these)

- Recipe quantities are **net (usable)**; stock deducts gross. (Industry standard.)
- By-products valued at their current cost and credited to the run (net realisable value).
- Sales stay daily totals per dish; promo units are separate lines; no per-order fees; bundles and
  buy-X-get-Y become an effective price per dish.
- Sale revenue = what the restaurant is credited; commission snapshotted per sale (campaign rate when
  set), shown as its own P&L line.
- Food cost % stays on menu price everywhere; delivery profit shown as margin after commission;
  suggested channel price targets food cost % of net revenue.
- Menu analysis excludes promo sales by default (switch to include).
- Promotion baseline = the 28 days before the start, per-day averages, same channels.
- 14-allergen list; allergens derived, never typed per dish.
- Non-goals listed in section 2 (tax-inclusive accounting, pack-unit purchasing, POS import, photos,
  time-of-day promos).

## 15. Left to the builder

File/module split for new views; exact chart styling within the existing palette; the unit alias
table contents beyond those listed; preset commission figures (must be marked "typical"); ordering of
work inside a layer; test harness shape.
