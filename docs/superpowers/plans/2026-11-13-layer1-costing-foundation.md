# Layer 1: Costing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unit conversion, trim yield, sub-recipes (prep items), visible weighted-average cost history with impact alerts, and production runs with by-products, as Restaurant Ops v1.3.0.

**Architecture:** Pure costing maths goes in a new shared file `app/js/costing.js` (global `RestoCosting`, ES5, no DOM), loaded before `core.js` in the browser and copied to `backend/Costing.gs` for Apps Script. `core.js` uses it for storage-aware actions (schema, validation, ledgers). Views use the same `RestoCosting` for live costing in forms. A Node test runner exercises `core.js` with an in-memory db.

**Tech Stack:** Vanilla ES5 (shared logic), ES modules (views), Google Apps Script + Sheets, Node 24 (tests only, no packages), Python 3 (existing tools).

**Spec:** `docs/superpowers/specs/2026-11-13-costing-pricing-promotions-design.md` (sections 3, 5, 9, 10, 12 apply to this layer). Also read `docs/HANDOVER.md` sections 2, 4, 6, 8.

## Global Constraints

- `app/js/core.js` and `app/js/costing.js` stay plain ES5: `var`, `function`, no arrow functions, no `let/const`, no template literals, no DOM, no Google APIs.
- `core.js` may reference `RestoCosting` **only inside function bodies**, never at IIFE top level (Apps Script file load order is not guaranteed).
- New sheet columns are **appended** to the end of a `SCHEMA` array. Never reorder or insert.
- Ledgers are append-only; mistakes are voided (`voided = TRUE`), never deleted.
- Every user-facing text key exists in both `EN` and `TH` dictionaries in `app/js/i18n.js`; every new English server error message that the Thai UI can see has a `TH_RULES` entry in `core.js`.
- All HTML is built with the `html` tagged template from `ui.js` (escaping). No raw `innerHTML` with data.
- Version string becomes `1.3.0` in `core.js` `VERSION` and `app/sw.js` `CACHE` (`resto-ops-v1.3.0`).
- Demo storage key becomes `ro.demo.db.v2`.
- Unit maths uses **US** measures for tsp/tbsp/cup/floz/pt/qt/gal (label says "US").
- Recipe quantities are **net (usable)**; stock is deducted **gross** = net ÷ (yield/100).
- Prep `costPerUnit` always equals its **theoretical** recipe cost; production runs never change it.
- Yield % accepted range: **1 to 1000** (above 100 allowed: dry rice/beans swell). Blank = 100.
- Prep nesting: **max depth 4**; cycles rejected.
- Commit after each task (`git add` the task's files only; never `Claude outputs/`).

## Review Focus

1. **Free-text units not in the alias table** (`pack`, `bottle`, `ขวด`): a recipe line in the ingredient's own unit must convert 1:1; any other unit without a conversion must give the "Can't convert…" validation error, not `NaN` or `0`.
2. **Thai stored units** (`กก.`, `ลิตร`, `ฟอง`): a recipe line in `g` against an ingredient stocked in `กก.` must convert (alias resolution is case/punctuation-insensitive).
3. **Prep with zero/blank batch quantity, empty recipe or a removed ingredient**: save is refused with a clear message (batch qty) or cost computes as 0 for missing lines; never `Infinity`/`NaN` in `costPerUnit`, boot payload or UI.
4. **Voiding a production run after its output was sold**: void succeeds, stock may go negative, voiding twice gives "already voided".
5. **Raw ingredient price change reaching dishes through a prep**: the purchase impact list includes dishes that use the prep, and the prep's `costPerUnit` and a `CostChanges` row are written in the same request.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `app/js/costing.js` | create | Pure maths: unit catalogue & aliases, conversion, yield, book building, recursive prep cost, cycle/depth check, stock explosion, production run costing |
| `app/js/core.js` | modify | Schema, `ingredients.save` / `menu.save` / `sales.add` / purchases / `production.*` / `ingredients.costHistory`, prep cost sync, impact |
| `tools/test_core.js` | create | Node test runner: loads costing+core, in-memory db, runs `tools/tests/*.test.js` |
| `tools/tests/*.test.js` | create | Tests per task |
| `tools/build_backend.py` | modify | Also writes `backend/Costing.gs` |
| `app/index.html`, `app/sw.js` | modify | Load/cache `costing.js` and new view files; version |
| `app/js/views/recipe-lines.js` | create | Shared recipe-line editor (ingredient/prep select, qty, unit picker, yield override, live cost) used by dish and prep editors |
| `app/js/views/menu.js` | modify | Dish editor uses `recipe-lines.js`; cost breakdown with share bars |
| `app/js/views/stock.js` | modify | Ingredient sheet: kind, yield + calculator, other units, prep recipe; levels: Prep badge & filter; item sheet: cost history, recipe vs actual; "Produce" tile; purchase impact toast |
| `app/js/views/production.js` | create | Produce-batch sheet and production log page (`#/more/production`) |
| `app/js/views/more.js` | modify | Kitchen section link to Production log |
| `app/js/views/purchasing.js` | modify | Impact toast after receiving a PO |
| `app/js/ui.js` | modify | `unitLabel(u)` helper |
| `app/js/charts.js` | modify | `sparkline(points)` for cost history |
| `app/js/i18n.js` | modify | New keys EN+TH, unit labels |
| `app/js/demo.js` | modify | v2 key; yields, preps, conversions, production runs |
| `docs/HANDOVER.md`, `README.md` | modify | Document new tables, actions, rules |

---

### Task 0: Baseline commit and test runner

**Files:**
- Create: `tools/test_core.js`, `tools/tests/smoke.test.js`
- Modify: `.gitignore` (add `Claude outputs/` only if the user confirms it should not be tracked; otherwise leave)

**Interfaces:**
- Produces (in `tools/test_core.js`, exported for test files via `module.exports`):
  - `makeApi() -> { api, db, owner, as(action, payload), asStaff(action, payload) }`: fresh in-memory db shaped like `localDb()` in `app/js/demo.js` (`read`, `append`, `updateWhere`, `removeWhere`, `lock`, `sessions`), `env.now` fixed to `2026-11-13T05:00:00Z`, deterministic `uuid` counter; calls `api.initialize({ ownerUsername:'owner', ownerPassword:'test1234' })`, creates a staff user, and returns `as`/`asStaff` that call `api.runAs` and **throw** the ApiError on failure.
  - `test(name, fn)`, and re-exports `assert` (`node:assert/strict`).
- Runner sets `global.RestoCosting = require('../app/js/costing.js')` **if the file exists**, then `global.RestoCore = require('../app/js/core.js')`, then requires every `tools/tests/*.test.js`, runs tests, prints `N passed, M failed`, exits 1 on any failure.

- [ ] **Step 1:** Ask the user (if not already answered) whether to make a baseline commit of the existing project and whether `Claude outputs/` is tracked. Then `git add .gitignore README.md app backend docs tools` and commit `chore: baseline v1.2.0`.
- [ ] **Step 2: Write smoke test** `tools/tests/smoke.test.js`: `bootstrap` as owner returns `version === '1.2.0'`; `ingredients.save` then `purchases.add` (2 kg @ 100) gives `stock.levels` onHand 2.
- [ ] **Step 3:** Implement `tools/test_core.js`.
- [ ] **Step 4:** Run `node tools/test_core.js`. Expected: `2 passed, 0 failed` (or however many assertions-tests you wrote, all passing).
- [ ] **Step 5:** Commit `test: add node test runner for core`.

---

### Task 1: Units and conversion (`costing.js`)

**Files:**
- Create: `app/js/costing.js`, `tools/tests/units.test.js`
- Modify: `tools/build_backend.py`, `app/index.html` (add `<script src="js/costing.js"></script>` before `core.js`), `app/sw.js` (SHELL list)

**Interfaces:**
- Produces on global `RestoCosting` (and `module.exports` guard like `core.js`):
  - `UNITS`: `{ code: { family: 'mass'|'volume'|'count', factor: Number } }` with base g / ml / pcs. Codes and factors: `mg .001, g 1, kg 1000, oz 28.3495, lb 453.592; ml 1, l 1000, tsp 4.92892, tbsp 14.7868, cup 236.588, floz 29.5735, pt 473.176, qt 946.353, gal 3785.41; pcs 1, dozen 12`.
  - `unitCode(text: String) -> String`: canonical code, or `''` if unknown. Normalise: trim, lowercase, strip trailing `.` and spaces. Aliases at minimum: kg: `kg, kgs, kilo, kilogram, กก, กิโล, กิโลกรัม`; g: `g, gr, gram, grams, กรัม`; ml: `ml, cc, มล, มิลลิลิตร`; l: `l, ltr, liter, litre, ลิตร`; tsp: `tsp, teaspoon, ช้อนชา`; tbsp: `tbsp, tablespoon, ช้อนโต๊ะ`; cup: `cup, cups, ถ้วย`; lb: `lb, lbs, pound`; pcs: `pcs, pc, piece, pieces, ea, each, ชิ้น, ฟอง, ลูก, ตัว, อัน`; dozen: `dozen, doz, โหล`; every code maps to itself.
  - `sameUnit(a, b) -> Boolean`: equal codes when both known, else normalised strings equal.
  - `convertQty(qty: Number, fromUnit: String, ing: {unit, conversions:[{unit, factor}]}) -> Number|null`: quantity in `ing.unit`. Rules in order: blank `fromUnit` or `sameUnit(fromUnit, ing.unit)` → `qty`; same family (both known) → `qty × fromFactor ÷ toFactor`; else for each conversion `c` (meaning *1 c.unit = c.factor × ing.unit*): if `sameUnit(fromUnit, c.unit)` → `qty × c.factor`; if `fromUnit` and `c.unit` share a family → convert to `c.unit` first then × `c.factor`. Otherwise `null`.
  - `unitsFor(ing) -> String[]`: stock unit first, then every code in the stock unit's family, then each conversion unit and every code in its family; de-duplicated with `sameUnit`.

- [ ] **Step 1: Write failing tests** `tools/tests/units.test.js`:
  - `unitCode('กก.') === 'kg'`, `unitCode(' KG ') === 'kg'`, `unitCode('ฟอง') === 'pcs'`, `unitCode('bottle') === ''`.
  - `convertQty(150, 'g', {unit:'กก.', conversions:[]}) === 0.15`.
  - `convertQty(2, 'tbsp', {unit:'L', conversions:[]})` ≈ `0.0295736` (to 6 dp).
  - `convertQty(3, 'bottle', {unit:'bottle', conversions:[]}) === 3`; `convertQty(3, 'pack', {unit:'bottle', conversions:[]}) === null`.
  - Eggs: `convertQty(110, 'g', {unit:'pcs', conversions:[{unit:'g', factor:1/55}]})` ≈ `2`; `convertQty(0.11, 'kg', same)` ≈ `2`.
  - Case: `convertQty(1, 'case', {unit:'bottle', conversions:[{unit:'case', factor:24}]}) === 24`.
  - `unitsFor({unit:'kg', conversions:[]})` starts with `'kg'` and includes `'g'` and `'lb'`, not `'ml'`.
- [ ] **Step 2:** Run `node tools/test_core.js`. Expected: units tests FAIL (`RestoCosting` undefined / functions missing).
- [ ] **Step 3:** Implement the functions above in `app/js/costing.js` as `var RestoCosting = (function () { 'use strict'; ... })();` plus `if (typeof module !== 'undefined' && module.exports) module.exports = RestoCosting;`.
- [ ] **Step 4:** Update `tools/build_backend.py` to also write `backend/Costing.gs` from `app/js/costing.js` with the same GENERATED header; add the script tag and SHELL entry.
- [ ] **Step 5:** Run `node tools/test_core.js` (all PASS) and `python tools/build_backend.py` (prints both files written).
- [ ] **Step 6:** Commit `feat(costing): unit catalogue and conversion`.

---

### Task 2: Yield, book, recursive prep cost, explosion, run costing (`costing.js`)

**Files:**
- Modify: `app/js/costing.js`
- Create: `tools/tests/costing.test.js`

**Interfaces:**
- Consumes: Task 1 functions.
- Produces on `RestoCosting`:
  - `grossQty(netQty, yieldPct) -> Number` = `netQty ÷ (y/100)` where blank/0/invalid `yieldPct` → 100.
  - `buildBook(ingredients: Array) -> { byId: {id: ing} }` where each ing is `{ id, name, unit, costPerUnit, yieldPct, kind ('raw'|'prep'), batchQty, trackStock (Boolean), conversions: [{unit, factor}], prepLines: [{ingredientId, qty, unit, yieldPct}] }`.
  - `lineCost(line: {ingredientId, qty, unit, yieldPct}, book, costs) -> { stockQty, grossQty, cost, error }`: `stockQty = convertQty(qty, unit, ing)`; effective yield = `line.yieldPct` if set else `ing.yieldPct`; `grossQty = grossQty(stockQty, yield)`; `cost = grossQty × unitCost` where `unitCost = costs[id]` for preps (from `prepCosts`) else `ing.costPerUnit`. Missing ingredient → `{ stockQty:0, grossQty:0, cost:0, error:'missing' }`; `null` conversion → `error:'unit'`, cost 0.
  - `prepCosts(book) -> { prepId: costPerUnit }`: memoised DFS; cost = Σ `lineCost` ÷ `batchQty` (batchQty ≤ 0 → 0). Throws `{ code: 'CYCLE', prep: name, via: name }` on a cycle, `{ code: 'DEPTH', prep: name }` when nesting > 4 (a dish → prep is depth 1).
  - `explode(line, multiplier, book) -> [{ ingredientId, qty }]`: stock deductions in stock units (positive numbers = amount to take out). Tracked prep or raw → one entry `grossQty × multiplier`. Prep with `trackStock === false` → recurse into its `prepLines`, scaling by `grossQty ÷ batchQty`. Merge duplicate ids.
  - `runCost({ inputs:[{ingredientId, qty}], byproducts:[{ingredientId, qty}], producedQty }, costOf: (id) -> Number) -> { inputCost, byproductValue, totalCost, unitCost }`; `totalCost = inputCost − byproductValue` (floor at 0); `unitCost = producedQty > 0 ? totalCost ÷ producedQty : 0`. Round money to 2 dp, unit cost to 4 dp.

- [ ] **Step 1: Write failing tests** `tools/tests/costing.test.js`:
  - `grossQty(0.72, 72) === 1`; `grossQty(1, '') === 1`; `grossQty(1, 250) === 0.4`.
  - Book with fish (kg, 200/kg, yield 45): line `{qty:180, unit:'g'}` → `grossQty` = 0.4, `cost` = 80.
  - Line yield override 90 on onion (yield 80) uses 90.
  - Prep "Chilli oil" (L, batchQty 2): 1 L oil @50 + 200 g chili @90 (yield 100) → `prepCosts` = (50 + 18) ÷ 2 = 34.
  - Nested: "Tom yum base" (batch 1 L) uses 0.25 L chilli oil → its cost includes 8.5.
  - Cycle A→B→A throws `code:'CYCLE'`; a 5-level chain throws `code:'DEPTH'`.
  - Batch 0 → cost 0 (not Infinity). Line pointing at unknown id → cost 0, `error:'missing'`.
  - `explode` with tracked prep returns the prep itself; with `trackStock:false` returns its raw ingredients scaled (0.25 L of chilli oil → oil 0.125 L, chili 0.025 kg).
  - `runCost` inputs 10/kg×3 + byproduct value 5, produced 5 → `{ inputCost:30, byproductValue:5, totalCost:25, unitCost:5 }`.
- [ ] **Step 2:** Run tests; expected FAIL on missing functions.
- [ ] **Step 3:** Implement the functions.
- [ ] **Step 4:** Run tests; expected all PASS.
- [ ] **Step 5:** Commit `feat(costing): yield, sub-recipe cost, explosion, production costing`.

---

### Task 3: Schema, ingredient save with yield / units / prep recipes, prep cost sync, cost history

**Files:**
- Modify: `app/js/core.js`
- Create: `tools/tests/ingredients.test.js`

**Interfaces:**
- Consumes: `RestoCosting.buildBook`, `prepCosts`, `unitCode`, `convertQty`.
- Schema changes (append only):
  - `Ingredients` += `yieldPct, kind, batchQty, trackStock, shelfLifeDays`
  - `Recipes` += `unit, yieldPct`
  - New `IngredientUnits: ['id','ingredientId','unit','factor']`
  - New `PrepRecipes: ['id','prepId','ingredientId','qty','unit','yieldPct','note']`
  - New `CostChanges: ['id','date','ingredientId','oldCost','newCost','source','refId','createdAt','createdBy']` (`source` ∈ `purchase|prep|manual|production`… only `purchase|prep|manual` used in this layer)
  - `TEXT_COLUMNS` += `'prepId', 'runNo', 'unit'`
- Produces inside `createApi`:
  - `loadBook() -> book` (joins Ingredients + IngredientUnits + PrepRecipes into `buildBook` input; `kind` blank → `'raw'`; `trackStock` blank → true).
  - `syncPrepCosts(user, source, refId) -> [{ id, name, oldCost, newCost }]`: recompute `prepCosts`, update each prep whose stored cost differs by > 0.0001 (bump `version`), append a `CostChanges` row per change with `source: 'prep'`.
  - `recordCostChange(ingredientId, oldCost, newCost, source, refId, user)`.
  - `ingredients.save` accepts extra item fields `yieldPct, kind, batchQty, trackStock, shelfLifeDays` plus top-level `units: [{unit, factor}]` and `prepRecipe: [{ingredientId, qty, unit, yieldPct, note}]`. Validation messages (exact):
    - `Yield must be between 1 and 1000 %.`
    - `Batch quantity must be greater than 0.` (prep only)
    - `A prep needs at least one recipe line.`
    - `Recipe line N: choose an ingredient.` (existing wording)
    - `Can't convert {unit} to {stockUnit} for {name}. Add a conversion on the ingredient.`
    - `{prep} can't contain itself (via {via}).`, `Preps can be nested at most 4 levels deep.`
    - `{name} is in the recipe twice.` (existing wording)
  - Save replaces the ingredient's `IngredientUnits` and `PrepRecipes` rows wholesale. Raw kind → its `PrepRecipes` rows removed. For a prep, `costPerUnit` from the client is ignored and set from `prepCosts`. A manual cost change on a raw item writes a `CostChanges` row (`manual`). Every save ends with `syncPrepCosts(user, 'prep', savedId)`.
  - `stockLevels()` rows gain: `yieldPct` (Number, default 100), `kind`, `batchQty`, `trackStock`, `shelfLifeDays`, `conversions: [{unit, factor}]`, `prepLines: [{ingredientId, qty, unit, yieldPct, note}]`, `actualUnitCost` (null until Task 6), `costVariancePct` (null until Task 6).
  - `A['ingredients.costHistory']` (manager, read): `{ id, limit? }` → `CostChanges` rows for that id, newest first, `[{ date, oldCost, newCost, changePct, source, refId }]`.
  - `po.suggestions` skips `kind === 'prep'`. `addPurchases` rejects a prep line: `Line N: {name} is made in the kitchen. Record a production run instead.`
  - Add `TH_RULES` regexes for every new message above.

- [ ] **Step 1: Write failing tests** `tools/tests/ingredients.test.js`:
  - Save raw with `yieldPct: 0` → VALIDATION; with 72 → stored, `stock.levels` row `yieldPct === 72`.
  - Save raw "Eggs" (pcs) with `units:[{unit:'g', factor:1/55}]` → levels row `conversions.length === 1`.
  - Save prep "Chilli oil" (L, batch 2, lines oil 1 L + chili 200 g) → levels `kind 'prep'`, `costPerUnit === 34` (oil 50/L, chili 90/kg seeded first).
  - Prep with line `{unit:'pcs'}` on chili (kg) → VALIDATION containing "Can't convert".
  - Prep A containing prep B, then saving B to contain A → VALIDATION containing "can't contain itself".
  - `purchases.add` chili at 120/kg (stock 0 so cost becomes 120) → chilli oil `costPerUnit === 37`; `ingredients.costHistory` for chilli oil has one row `{ oldCost:34, newCost:37, source:'prep' }`.
  - `purchases.add` with a prep line → VALIDATION "made in the kitchen".
  - Raw item save with no new fields on an existing v1.2-shaped row (no `yieldPct` column value) still returns `yieldPct === 100`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement schema + functions above. Call `syncPrepCosts` at the end of `addPurchases` too (source `'prep'`, refId = first purchase id), and write `CostChanges` rows (`purchase`) for raw cost changes inside `addPurchases`.
- [ ] **Step 4:** Run; all PASS (including earlier tasks).
- [ ] **Step 5:** Commit `feat(core): yields, conversions, prep items, cost history`.

---

### Task 4: Dish costing and sales deduction with units, yield and preps

**Files:**
- Modify: `app/js/core.js`
- Create: `tools/tests/menu.test.js`

**Interfaces:**
- Consumes: `loadBook`, `RestoCosting.lineCost`, `prepCosts`, `explode`.
- Produces:
  - `menuWithCost()` recipe lines become `{ ingredientId, name, kind, unit (line unit or stock unit), stockUnit, qty, yieldPct (effective), grossQty (stock unit), cost, share (0–100, % of dish cost), error }`. Dish `foodCost` = Σ line costs (2 dp). Missing ingredient name stays `'(removed ingredient)'`.
  - `menu.save` recipe lines accept `unit, yieldPct`; validate yield range and convertibility with the Task 3 messages; store in `Recipes.unit` / `Recipes.yieldPct` (store `unitCode(unit) || unit`).
  - `sales.add` stock deduction uses `explode(line, qtySold, book)` per recipe line; each deduction is a `sale` movement valued at the item's current cost (preps: their `costPerUnit`). Old `Recipes` rows with blank unit behave exactly as before (net = gross when yield 100).

- [ ] **Step 1: Write failing tests** `tools/tests/menu.test.js`:
  - Dish with fish line 180 g (fish kg 200, yield 45) → `foodCost === 80`, line `grossQty === 0.4`, `share === 100`.
  - Dish using tracked prep "Chilli oil" 50 ml → cost = 0.05 × 34 = 1.7.
  - Selling 2 dishes deducts 0.8 kg fish and 0.1 L chilli oil (`stock.levels` onHand drops accordingly).
  - Prep with `trackStock:false`: selling deducts raw oil and chili, not the prep.
  - Recipe line `{unit:'tbsp'}` on Eggs (pcs, no conversion) → VALIDATION "Can't convert".
  - Legacy line (no unit/yield) on kg ingredient qty 0.15 → cost = 0.15 × costPerUnit (unchanged behaviour).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; all PASS.
- [ ] **Step 5:** Commit `feat(core): dish cost and sales deduction with units, yield, preps`.

---

### Task 5: Purchase impact on dishes

**Files:**
- Modify: `app/js/core.js`
- Create: `tools/tests/impact.test.js`

**Interfaces:**
- Produces: `addPurchases` (and therefore `purchases.add` and `po.receive`) result gains
  `impact: { ingredients: [{ id, name, oldCost, newCost, changePct }], dishes: [{ id, name, oldCost, newCost, foodCostPct, overTarget }] }`.
  - `ingredients` = raw items from this purchase **and** preps changed by `syncPrepCosts`, where |changePct| ≥ 1.
  - `dishes` = active dishes whose recipe contains any of those ids (directly), with cost before (computed from a `menuWithCost()` snapshot taken before the cost update) and after; `overTarget` = `foodCostPct > targetFoodCostPct`. Sorted by cost increase, descending.
  - `po.receive` must pass `impact` through in its return value.

- [ ] **Step 1: Write failing tests:** purchase raising chili 90 → 120 with a dish using chilli oil: `impact.ingredients` contains both chili (+33.3 %) and chilli oil; `impact.dishes` contains the dish with `newCost > oldCost`. A purchase at the same price → `impact.ingredients` empty.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; PASS.
- [ ] **Step 5:** Commit `feat(core): cost impact after receiving goods`.

---

### Task 6: Production runs

**Files:**
- Modify: `app/js/core.js`
- Create: `tools/tests/production.test.js`

**Interfaces:**
- Consumes: `loadBook`, `RestoCosting.explode`, `convertQty`, `runCost`.
- Schema: new `ProductionRuns: ['id','runNo','date','prepId','batches','expectedQty','producedQty','unit','inputCost','byproductValue','totalCost','unitCost','yieldPct','producedBy','note','voided','createdAt','createdBy']`. `MOVEMENT_TYPES` += `'production','produce','byproduct'`.
- Produces:
  - `A['production.add']` (staff, write). Payload `{ date, prepId, batches (>0), producedQty (>0), producedBy (username of an active user; default current user), note, inputs?: [{ingredientId, qty, unit}], byproducts?: [{ingredientId, qty, unit}] }`.
    - Inputs omitted → defaults = Σ over prep lines of `explode(line, batches, book)`. Inputs given → each converted to stock unit with `convertQty` (null → the "Can't convert" message), then a non-tracked prep among them is exploded.
    - By-products must not be the prep itself (`A by-product can't be the item being produced.`).
    - Writes the run row (`runNo` = `PR-` + 4-digit sequence over all runs incl. voided), `production` movements (negative, valued at current cost), one `produce` movement (+producedQty, `unitCost` = run unitCost), `byproduct` movements (+qty, valued at their current cost). All movements `refId` = run id, `reason` = runNo.
    - `expectedQty = batchQty × batches`; `yieldPct = producedQty ÷ expectedQty × 100` (1 dp).
    - Prep `costPerUnit` is **not** changed; by-product costs are not changed.
    - Returns `{ run, warnings: [{ ingredientId, name, onHand, needed }] }` for inputs exceeding on-hand (still saved).
  - `A['production.list']` (staff, read): `{ from?, to?, prepId?, limit? }` → runs newest first with `prepName`, `producedByName`.
  - `A['production.void']` (manager, write): `{ id }` → voids the run (existing `voidRow` semantics, `Production run` label) and all movements with that `refId`. `movements.void` refuses `production|produce|byproduct` rows: `Production entries are removed by voiding the production run.`
  - `stockLevels()` fills `actualUnitCost` = mean `unitCost` of the prep's last 5 non-voided runs (null if none) and `costVariancePct` = `(actual − costPerUnit) ÷ costPerUnit × 100` (1 dp; null if either missing or cost 0).
  - `TH_RULES` entries for the new messages.

- [ ] **Step 1: Write failing tests** `tools/tests/production.test.js`:
  - Chilli oil (batch 2 L: oil 1 L @50, chili 200 g @90). `production.add` batches 2, producedQty 3.8 → movements: oil −2, chili −0.4, chilli oil +3.8; run `inputCost 136`, `unitCost ≈ 35.7895`, `yieldPct 95`; chilli oil `costPerUnit` still 34; `actualUnitCost ≈ 35.79`, `costVariancePct ≈ 5.3`.
  - By-product: chicken stock run with by-product "Chicken fat" 0.5 kg @40 → `byproductValue 20`, `totalCost = inputCost − 20`, fat on hand +0.5.
  - Explicit `inputs` with `{qty:500, unit:'g'}` for chili → −0.5 kg.
  - Second run gets `runNo 'PR-0002'`.
  - Staff can add; staff `production.void` → FORBIDDEN; manager void → all its movements voided, chilli oil on hand back; second void → "already voided".
  - `movements.void` on a `produce` row → VALIDATION.
  - Inputs above on hand → saved, `warnings.length === 1`.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; PASS. Then `python tools/build_backend.py`.
- [ ] **Step 5:** Commit `feat(core): production runs with yield and by-products`.

---

### Task 7: Ingredient & prep editing UI (yield, other units, prep recipe) and shared recipe-line editor

**Files:**
- Create: `app/js/views/recipe-lines.js`
- Modify: `app/js/views/stock.js` (`ingredientSheet`, `renderLevels`), `app/js/views/menu.js` (`dishSheet` uses the shared editor), `app/js/ui.js`, `app/js/i18n.js`, `app/sw.js` (SHELL)

**Interfaces:**
- Consumes: boot `ingredients` rows from Task 3; `RestoCosting.buildBook`, `lineCost`, `prepCosts`, `unitsFor`, `convertQty`.
- Produces:
  - `ui.js`: `unitLabel(u: String) -> String`: if `RestoCosting.unitCode(u)` is known and `t('unit.' + code)` exists → localized label, else `u` as stored.
  - `recipe-lines.js`: `export function recipeLines(host, { ingredients, lines, excludeId, onChange }) -> { values(): [{ingredientId, qty, unit, yieldPct}], totals(): { cost, lines:[{cost, share, error}] }, add() }`.
    - Ingredient `<select>` with two `<optgroup>`s: Ingredients, Preps (excludes `excludeId`, i.e. the prep being edited).
    - Qty input + unit `<select>` populated from `unitsFor(ing)` (labels via `unitLabel`), default stock unit.
    - "More" toggle per line reveals yield override input (placeholder = ingredient's yield).
    - Live line cost via `lineCost` on a book built once from `ingredients`, with the current form's prep lines substituted when editing a prep; a line with `error:'unit'` shows the text `t('recipe.cantConvert')` in warn colour instead of a cost.
    - `onChange(totals)` fires on every input/change.
  - `ingredientSheet` gains: segmented **Raw | Prep** control (`kind`), `yieldPct` field with a "Calculate" link opening a two-field mini calculator (bought qty, usable qty → %), **Other units** list (rows: `1 [unit input] = [factor] [stock unit]`, plus a ⇄ button that flips the direction and stores `1/x`), and for Prep: batch quantity, track-stock checkbox (`recipe.trackStockHelp` text), shelf life (days), recipe lines via `recipeLines`, live "Cost per {unit}" summary. Prep hides the cost-per-unit input (computed) and the supplier field. Saves with `ingredients.save` payload from Task 3.
  - `dishSheet` replaces its private line editor with `recipeLines`; the cost card adds a breakdown list (name, cost, share bar using existing `.cost-bar` styles), sorted by cost.
  - Stock levels: preps show a `pill` "Prep"; filter chips gain "Preps".
  - Menu becomes a hub: a `.seg` control **Dishes | Preps** at the top of `menu.js` (`ui.tab`, default `dishes`; later layers add Pricing, Analysis, Promotions). Preps tab lists preps with cost per unit, on hand, and a warn pill when |`costVariancePct`| > 10; tapping opens the stock `itemSheet` (export it from `stock.js`); managers get a "+" action that opens `ingredientSheet` preset to Prep (export it too).
  - i18n keys (EN+TH), at least: `unit.<code>` for every `UNITS` code (EN: `g`, `kg`, `tsp (US)`, …; TH: `กรัม`, `กก.`, `ช้อนชา`, …), `stock.kindRaw`, `stock.kindPrep`, `stock.yield`, `stock.yieldHelp`, `stock.yieldCalc`, `stock.bought`, `stock.usable`, `stock.otherUnits`, `stock.addUnit`, `stock.batchQty`, `stock.trackStock`, `stock.shelfLife`, `stock.prepBadge`, `stock.filterPreps`, `recipe.more`, `recipe.yieldOverride`, `recipe.cantConvert`, `recipe.trackStockHelp`, `recipe.costPerUnit`, `menu.breakdown`.

- [ ] **Step 1:** Implement `unitLabel` and i18n keys; run `python tools/check_i18n.py`. Expected: passes.
- [ ] **Step 2:** Implement `recipe-lines.js`; switch `dishSheet` to it.
- [ ] **Step 3:** Extend `ingredientSheet` and levels badge/filter.
- [ ] **Step 4: Verify in browser** (`python tools/serve.py`, demo mode, phone width 375): create a prep with a nested prep and a gram line on a kg item: live cost matches what `node` tests compute for the same numbers; a `tbsp` line on Eggs shows the "can't convert" text and Save shows the server message; switch language to Thai and dark theme, recheck labels. No console errors.
- [ ] **Step 5:** Commit `feat(ui): yield, other units, prep items, shared recipe editor`.

---

### Task 8: Production UI, cost history, impact toast

**Files:**
- Create: `app/js/views/production.js`
- Modify: `app/js/views/stock.js` (action tile, `itemSheet`, `purchaseSheet` toast), `app/js/views/purchasing.js` (receive toast), `app/js/views/more.js` (Kitchen link), `app/js/app.js` (route `more/production` if routing needs it), `app/js/charts.js`, `app/js/i18n.js`, `app/sw.js`

**Interfaces:**
- Consumes: `production.add|list|void`, `ingredients.costHistory`, `impact` from Task 5, boot fields from Tasks 3 and 6.
- Produces:
  - `production.js`: `export function produceSheet(ctx, prepId?)` and `export async function renderLog(ctx)`.
    - Sheet flow on one screen, top to bottom: prep select (preps only), batches stepper (default 1), **Ingredients used** list pre-filled from `explode` (read-only rows with an "Edit amounts" toggle that turns them into qty + unit inputs), **Made** qty (pre-filled `batchQty × batches`, unit label) with live yield % pill (≥ 95 good, < 95 warn), "More options": by-products (ingredient + qty + unit rows), produced by (select of active users, default me), note. Sticky summary: run cost, cost per unit vs recipe cost with variance %. Save → toast `production.saved` with runNo; warnings shown as a warn toast listing items.
    - Log page `#/more/production`: list newest first (runNo, prep, qty, yield pill, producedBy, date); tap → detail sheet with inputs/outputs from `movements.list` filtered by refId, and a Void button for managers (uses existing `confirmSheet`).
  - Stock: `actionTiles()` adds `produce` tile (icon `chef`) opening `produceSheet`; `itemSheet` for a prep shows "Recipe cost / Actual (last 5 runs) / Variance" rows with a warn pill if |variance| > 10, plus a "Produce" button; for every item a **Cost history** card: `sparkline` + last 10 changes (date, old → new, ±%, source label), loaded with `ingredients.costHistory` (manager+ only).
  - `charts.js`: `export function sparkline(points: Number[], { width=280, height=48 }) -> html` SVG line using `--series-1`, with an accessible `<title>` summarising first → last.
  - Impact toast: after `purchases.add` or `po.receive`, if `impact.ingredients.length`, show a toast: `stock.impact` ("{name} {±pct} → {n} dishes cost more, {m} over target") with an action "See dishes" that opens a sheet listing `impact.dishes` (name, old → new cost, food cost pill).
  - More → Kitchen: "Production log" row (`#/more/production`).
  - i18n keys (EN+TH) for all new strings, including movement type labels `production`, `produce`, `byproduct` used by history views.

- [ ] **Step 1:** Implement `sparkline` and i18n keys; `python tools/check_i18n.py` passes.
- [ ] **Step 2:** Implement `production.js` and wire tile, route, More link.
- [ ] **Step 3:** Implement item-sheet cost history and prep variance; impact toast in stock-in and PO receive.
- [ ] **Step 4: Verify in browser** (demo, 375 px, EN then TH, light then dark): record a run with an edited input and a by-product; stock levels change as expected; log shows it; manager voids it and stock returns; a stock-in at a higher price shows the impact toast and dish list including a dish that uses a prep; staff login sees Produce but no Void and no cost history. No console errors.
- [ ] **Step 5:** Commit `feat(ui): production runs, cost history, cost impact alerts`.

---

### Task 9: Demo data v2, version bump, docs

**Files:**
- Modify: `app/js/demo.js`, `app/js/core.js` (`VERSION`), `app/sw.js` (`CACHE`), `docs/HANDOVER.md`, `README.md`
- Modify: `tools/tests/smoke.test.js` (expect `1.3.0`)

**Interfaces:**
- Consumes: all actions above.
- Produces demo content (both languages via the existing `tx(en, th)` pattern):
  - `KEY = 'ro.demo.db.v2'`.
  - Yields: shrimp 85, chicken thigh 90, garlic 85, lime 45 (juice), mango 60, basil 70, bean sprouts 95.
  - New raw items: "Whole chicken carcass/bones" (kg), "Chicken fat" (kg); egg conversion `1 g = 1/55 pcs`; fish sauce conversion `1 bottle = 0.7 L`.
  - Preps: **Chilli oil** (L, batch 2, tracked), **Chicken stock** (L, batch 10, from bones + garlic, by-product chicken fat), **Nam jim seafood sauce** (L, batch 1, garlic/chili/lime/fish sauce/sugar, tracked), **Tom yum base** (L, batch 1, uses chilli oil + chicken stock: nested), **Sweet coconut cream** (L, batch 1, `trackStock:false`, coconut milk + sugar).
  - Dish recipes switched to grams/ml where natural (e.g. basil 20 g, chili 10 g, fish sauce 15 ml) and to preps: Tom Yum uses 0.3 L tom yum base; Mango Sticky Rice uses 0.1 L sweet coconut cream; Pad Thai uses 15 ml chilli oil.
  - Production runs over the 62-day history: chilli oil weekly, chicken stock twice a week (with fat by-product), nam jim and tom yum base twice a week; yields vary 88–100 % using the seeded `rng`; `producedBy` alternates staff and manager. Runs happen before the sales that consume them so prep stock stays positive.
- Docs: HANDOVER sections 4 (new tabs/columns, movement types), 5 (yield, conversion, prep cost, production costing rules), 6 (new actions), 3 (costing.js, Costing.gs, test runner); README "What's in the box" rows for Prep & production; version header 1.3.0.

- [ ] **Step 1:** Update smoke test to expect `1.3.0`; run, see FAIL; bump `VERSION` and `CACHE`; run, PASS.
- [ ] **Step 2:** Implement demo seed changes.
- [ ] **Step 3: Verify:** clear site data, load demo in EN and TH: no seed errors in console; Menu shows realistic food cost % (most dishes 20–40 %); Stock shows preps with positive on-hand; production log has ~60 runs; Tom Yum cost breakdown shows the tom yum base line.
- [ ] **Step 4:** Update docs.
- [ ] **Step 5:** Run `node tools/test_core.js`, `python tools/check_i18n.py`, `python tools/build_backend.py`; all succeed.
- [ ] **Step 6:** Commit `feat: v1.3.0 costing foundation demo data and docs`.
