# Layer 4: SOP Manuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the owner prefers native execution). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn recipes into standard operating procedures that kitchen staff follow on a phone. Ingredients come straight from the recipe and scale with portions or batches. Allergens are derived automatically. Managers add numbered steps (critical food-safety steps highlighted) and notes. Any SOP, or the whole manual, can be printed or shared. Ships as Restaurant Ops v1.6.0.

**Architecture:** Allergen and quantity-display maths go in `app/js/costing.js` (`RestoCosting.ALLERGENS`, `allergensFor`, `humanQty`), shared by server and client. `core.js` adds SOP columns, an `SopSteps` tab and the `sop.save` / `sop.list` actions. One view module, `app/js/views/sop.js`, holds the SOP sheet, the editor, the manual index and printing.

**Spec:** `docs/superpowers/specs/2026-11-13-costing-pricing-promotions-design.md` section 8 (and 9 for UX).

## Global Constraints

- ES5 only in `core.js`/`costing.js`; `RestoCosting` is referenced only inside function bodies. Columns are appended only.
- **Allergens:** the 14 EU major allergens, as codes: `gluten, crustaceans, eggs, fish, peanuts, soy, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs`. Each has EN and TH labels in `i18n.js` (`allergen.<code>`).
- They are set **only on ingredients** (raw items and preps). A dish's or prep's allergens are derived from its recipe, recursively through preps; they are never typed on a dish.
- **Quantities shown on an SOP** are the recipe's net (usable) amounts, multiplied by the portions/batches stepper. Display: g ≥ 1000 → kg, ml ≥ 1000 → l, kg < 1 → g, l < 1 → ml; other units unchanged. Up to 3 significant decimals.
- **Staff view only; managers edit.** Steps are reordered with up/down buttons (the accessible path for drag-to-reorder).
- **No file uploads.** Photos are links only, and they must start with `http://` or `https://`.
- All text is in EN and TH; every new server message has a Thai rule. All HTML goes through `html`. Phone-first, 44 px targets.
- `VERSION` 1.6.0, `CACHE` v1.6.0, demo key `ro.demo.db.v5`. Commit per task; never add `Claude outputs/`, `.claude/` or `.superpowers/`.

## Review Focus

1. **A prep that contains itself** through a cycle (old data) must not loop forever in `allergensFor`. → Task 1 test.
2. **Unknown allergen codes, bad image links, blank step text and more than 40 steps** are refused with clear messages. → Task 1 test.
3. **`sop.save` on a dish only changes its SOP fields**: the recipe, price and channel prices stay untouched, and the version is checked. → Task 1 test.
4. **Scaling quantity display** across unit boundaries (1500 g → 1.5 kg; 0.25 kg → 250 g; 3 pcs stays pcs) and unknown units. → Task 1 test.
5. **The printout shows only the SOP**, with none of the app chrome. Verified in Task 2 by checking the print root and the `@media print` rules.

---

### Task 1: Allergens and SOP data

**Files:** `app/js/costing.js`, `app/js/core.js`, `tools/tests/sop.test.js`.

**Interfaces:**
- `RestoCosting.ALLERGENS` (the 14 codes in order).
- `RestoCosting.allergensFor(lines, book) -> [codes]`: the codes from each line's ingredient `allergens`, recursing into preps' `prepLines`. It uses a visited set, and returns codes in `ALLERGENS` order.
- `RestoCosting.humanQty(qty, unit) -> { qty, unit }`.
- **Schema:**
  - Ingredients += `portionNote, holdingNote, equipment, prepMinutes, allergens, photoUrl`.
  - Menu += `portionNote, holdingNote, equipment, prepMinutes, photoUrl`.
  - New tab `SopSteps: ['id','ownerId','stepNo','text','minutes','imageUrl','critical']`, ids prefixed `SOP`.
  - `TEXT_COLUMNS` += `'ownerId','allergens'`.
- `buildBook` inputs carry `allergens: [codes]`. In `stockLevels` rows:
  - `allergens` = the item's own codes;
  - `allergensAll` = the derived set for preps (own plus recipe);
  - the SOP fields.
- `menuWithCost` dishes gain `allergens` (derived) and the SOP fields.
- `ingredients.save` accepts `allergens: [codes]` (`Unknown allergen.` for anything else).
- `A['sop.save']` (manager, write): `{ ownerId, version, notes: { portionNote, holdingNote, equipment, prepMinutes, photoUrl }, steps: [{ text, minutes, imageUrl, critical }] }`.
  - The owner is a dish or a prep; `findOrFail` with label `Dish` or `Prep`; a raw ingredient gives `Only dishes and preps have an SOP.`
  - Version check uses the existing CONFLICT message.
  - It updates only the SOP fields on the owner row (version + 1) and replaces that owner's SopSteps.
  - **Validation messages:**
    - `Step N: write what to do.`
    - `Too many steps (max 40).`
    - `Image link must start with http:// or https://.`
    - `Step N minutes` → existing `optInt` wording.
    - `prepMinutes` → `optInt` with label `Prep time (minutes)`.
    - Notes are limited to 300 characters each (`optStr`).
  - It returns `{ version, steps }`.
- `A['sop.list']` (staff, read) → `{ ownerId: [{ stepNo, text, minutes, imageUrl, critical }] }`, sorted by stepNo.

- [ ] **Step 1: Write failing tests:**
  - `humanQty` cases.
  - `allergensFor` through a nested prep, and on a cycle.
  - `ingredients.save` allergens round trip, and an unknown code refused.
  - Dish `allergens` derived through a prep.
  - `sop.save` on a dish:
    - recipe, price and prices are unchanged;
    - version + 1;
    - steps sorted;
    - a stale version gives CONFLICT;
    - each validation message;
    - a raw ingredient owner is refused;
    - staff get FORBIDDEN;
    - staff can `sop.list`.
  - The Thai sweep.
- [ ] **Step 2:** Run (FAIL).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run (PASS) and build.
- [ ] **Step 5:** Commit `feat(core): allergens and SOP steps`.

### Task 2: SOP view, editor, manual and print

**Files:** `app/js/views/sop.js` (new); `views/menu.js`, `views/stock.js`, `views/more.js`, `app/css/app.css`, `i18n.js`, `sw.js`.

- **`sopSheet(ctx, owner, kind)`:**
  - Name, an optional "Photo" link button, and a yield line: dish = 1 portion; prep = batchQty unit; shelf life for preps.
  - Total time: prep minutes plus the step minutes.
  - Allergen badges (warn pills with an icon), or "No major allergens listed".
  - A portions/batches stepper (1–50).
  - The scaled ingredient list (`humanQty`, `unitLabel`).
  - Numbered steps; critical ones get a bad-ink left border and a "Critical" pill. Each step's minutes; an image link opens in a new tab with `rel="noopener"`.
  - Notes (plating/portion, holding, equipment).
  - Foot: Print, Share (Web Share API, falling back to copying the text), and Edit for managers.
- **`sopEditor`:**
  - The note fields, prep time and photo link.
  - The steps: text area, minutes, critical checkbox, image link, up/down/remove, and "Add step".
  - Saves via `sop.save`; CONFLICT triggers a refresh.
- **Allergen chips in `ingredientSheet`:** a multi-select of the 14, saved with `ingredients.save`. For preps, the derived allergens are also shown as read-only text.
- **Entry points:**
  - the dish sheet (manager) and view sheet (staff): an "SOP" button;
  - the stock item sheet for preps: an "SOP" button;
  - More → Kitchen → "SOP manual" (`#/more/sop`).
- **Manual (`renderManual`):** search; dishes and preps with their step count and allergen pills; tap opens the SOP; "Print whole manual".
- **Print:**
  - `printSops(list)` mounts a `#print-root` in `<body>`, calls `window.print()`, and removes it on `afterprint`.
  - `@media print` hides everything except `#print-root`. Each SOP is one page (`break-after: page`), in black on white.
- [ ] i18n EN+TH and `check_i18n`. Implement.
- [ ] **Browser check by script:**
  - Open an SOP, change the portions and check the scaled quantities.
  - Edit and save steps, then reorder them.
  - Staff can't see Edit.
  - Print root markup is created.
  - No console errors.
- [ ] Commit `feat(ui): SOP manuals with scaling, allergens and print`.

### Task 3: Demo data v5, version 1.6.0, docs

- Smoke test expects 1.6.0 (RED first); `VERSION`, `CACHE` and the demo key are bumped.
- **Demo allergens:**
  - shrimp: crustaceans
  - eggs: eggs
  - fish sauce: fish
  - oyster sauce: molluscs, soy, gluten
  - evaporated milk: milk
  - rice noodles: none
  - curry paste: crustaceans (shrimp paste)
- **SOP steps and notes** for 4 dishes (Holy Basil Chicken, Pad Thai, Green Curry, Mango Sticky Rice) and 2 preps (Chicken stock, Chilli oil). Each has a critical step: cook chicken to 75 °C; cool stock to below 5 °C within 2 hours. Notes are in EN and TH via `tx`.
- **Docs:** the HANDOVER tables, rules and actions, plus a Layer 4 status line; the README "SOP manuals" row.
- **Verify:** scratchpad seed check in EN and TH, plus a browser load. Then tests, `check_i18n` and the build. Commit `feat: v1.6.0 SOP manuals demo data and docs`.
