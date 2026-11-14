# UX: Daily Journeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the owner prefers native execution). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the frictions in `docs/ux/2026-11-14-user-journeys.md` so the app works the way strong restaurant operations run:
- a **Today** screen that tells each role what to do;
- a guided **close the day** routine;
- faster entry, with search and recent items;
- **kitchen mode** for SOPs on a shared tablet;
- a layout that also works on tablets and laptops;
- the expert tools one tap away;
- a first-run setup checklist;
- a printable monthly report.

Ships as v1.7.0.

**Architecture:** One server addition in `core.js`: the `DayCloses` tab, plus `day.close` and `today.summary`. Everything else is in the views and CSS, building on the existing patterns (the `html` template, `openSheet`, the print root from `sop.js`). There are no new libraries.

**Source:** `docs/ux/2026-11-14-user-journeys.md`.

**Devices, as decided by the owner ("as your example"):** staff phones, a shared kitchen tablet, and the owner's laptop.

## Global Constraints

- Thai only: every new text goes in the `th` dictionary in `i18n.js`; `python tools/check_i18n.py` must pass.
- ES5 in `core.js`. Columns are appended only. Every new server message gets a Thai rule (`TH_RULES`).
- All HTML goes through `html`. 44 px touch targets; kitchen mode uses at least 56 px controls and 22 px or larger body text.
- **Responsive:**
  - ≥ 900 px: the bottom nav becomes a left rail (width 220 px), page max-width 1120 px, and dashboard cards flow in 2 columns.
  - < 900 px: unchanged.
- **Navigation (5 tabs):** วันนี้ (home) · สต็อก · เมนู · ยอดขาย · เพิ่มเติม. Orders moves into More (top of the Money section) and stays reachable from Home tasks; the Orders badge moves onto More.
- Daily routines must not get slower. Every existing deep link (`#/orders/...`, `#/stock/...`, `#/sales/new`) keeps working.
- Version 1.7.0 (`VERSION`, `CACHE`), demo key `ro.demo.db.v7`. Commit per task.

## Review Focus

1. **`today.summary` on an empty sheet** (no POs, no channels, no promotions): no errors, an empty task list, and the setup checklist all "to do". → Task 1 test.
2. **Closing a day twice, or closing a future date**: the second close updates who closed and when (no duplicate row); a future date is refused. → Task 1 test.
3. **Staff vs manager tasks**: staff never see invoice tasks. → Task 1 test.
4. **Multi-channel sales entry**: quantities typed on one channel survive switching channel; saving posts one `sales.add` per channel that has quantities; one failure leaves the others saved and says which one failed. → Task 4 browser check.
5. **Kitchen mode** keeps working if the Wake Lock API is missing or refused. → Task 6 browser check.

---

### Task 1: Server — day close and today summary

**Files:** `app/js/core.js`, `tools/tests/today.test.js`.

- **Schema:** `DayCloses: ['id','date','closedBy','closedAt','salesTotal','wasteValue','countLines','note']`, ids prefixed `DAY`; `date` is in TEXT_COLUMNS already.
- **`A['day.close']`** (staff, write): `{ date, note? }`.
  - `date` ≤ today, else `You can't close a day that hasn't happened yet.`
  - It computes the totals for that date: live sales total, the absolute waste value, and the number of count movements.
  - It upserts one row per date (update if one exists) and returns that row.
- **`A['today.summary']`** (staff, read): `{ today }` returns:
  - `day: { date, closed, closedBy, closedAt }` for today;
  - `yesterdayClosed: Boolean`;
  - `tasks: [{ kind, n, items? }]`. `kind` is one of:
    - `deliveries`: POs sent/partial with expectedDate ≤ today;
    - `invoices`: manager+ only, review/exception count;
    - `lowStock`: active non-prep items, status ≠ ok;
    - `preps`: tracked preps with onHand ≤ minLevel, items `{ id, name, onHand, minLevel, unit }`, max 6;
    - `promotionsEnding`: manager+, active with endDate within 3 days, items `{ id, name, endDate }`;
    - `closeYesterday`: when yesterday isn't closed and it had sales.
  - `setup` (owner only): `{ done: n, total: 6, steps: [{ key, done }] }` with keys:
    - `restaurant`: restaurantName ≠ the default and currency set;
    - `channels`: at least one active channel, and every delivery channel has commission > 0;
    - `suppliers` ≥ 1;
    - `ingredients` ≥ 5;
    - `dishes`: ≥ 1 active dish with a recipe;
    - `team`: ≥ 1 active non-owner user.
- [ ] **Step 1: Write the failing tests:**
  - empty api → tasks `[]`, and setup has 6 steps with `team`/`dishes` not done;
  - a sent PO expected yesterday → a `deliveries` task with n 1;
  - a tracked prep below min → listed under `preps`;
  - staff summary has no `invoices` task and no `setup`;
  - `day.close` twice → one row with an updated `closedAt`;
  - a future date → VALIDATION;
  - sales yesterday and no close → `closeYesterday` task;
  - Thai sweep for the new message.
- [ ] **Step 2:** Run (FAIL). **Step 3:** Implement. **Step 4:** Run (PASS) and build.
- [ ] **Step 5:** Commit `feat(core): day close and today summary`.

### Task 2: Navigation and responsive shell

**Files:** `app/js/app.js`, `app/css/app.css`, `app/js/views/more.js`, `app/js/views/menu.js`.

- NAV becomes `home, stock, menu, sales, more`. Orders is a row at the top of More → Money (manager+), with the open-orders count. The badge moves from the Orders tab to More. The aria-current mapping becomes `orders → more`.
- Home's tab label changes to "วันนี้" (`nav.home`).
- **CSS ≥ 900 px:**
  - `.app` becomes a grid with a left rail;
  - `.nav` becomes vertical, sticky and full height, with labels beside the icons;
  - `.page` max-width 1120 px;
  - `.kpis` repeat(4);
  - a new `.grid-2` utility (2 columns ≥ 900 px, 1 below);
  - `.fab` positioning adjusted for the rail;
  - sheets centred (existing rule).
- The Menu hub's `.seg` stops scrolling at ≥ 900 px (it fits).
- [ ] **Browser check by script:** with the viewport emulated at 375 px and at 1280 px, nav items equal the 5 tabs, every old route still renders, and there are no console errors. Commit `feat(ui): five-tab navigation with Menu, wide-screen layout`.

### Task 3: Today screen and setup checklist

**Files:** `app/js/views/home.js`, `app/js/i18n.js`.

- At the top of Home (all roles): a "งานวันนี้" card from `today.summary`.
  - One row per task, with an icon, a Thai sentence and the count. Tapping goes to the place to act: deliveries → `#/orders/receive`, invoices → `#/orders/invoices`, lowStock → `#/stock/low`, preps → `produceSheet` for that prep, promotionsEnding → `#/menu/promotions`, closeYesterday → `#/close/<yesterday>`.
  - With no tasks: "ทุกอย่างเรียบร้อย".
- Below the tasks: a **close the day** button (`#/close`) showing "ปิดยอดวันนี้", or "ปิดยอดแล้ว · {who} {time}" when closed.
- **Owner setup checklist card** (only when `setup.done < total`): a progress bar with `done/total` and each step with a tick or a link (restaurant → `#/more/settings`, channels → `#/more/channels`, suppliers → `#/more/suppliers`, ingredients → `#/stock`, dishes → `#/menu`, team → `#/more/team`). It can be hidden with a "ซ่อน" button (localStorage `ro.setup.hidden`).
- Staff Home keeps today's sales and restock, and adds the tasks plus quick actions: ปิดยอด, รับของ, ของเสีย, คู่มือ SOP.
- Manager Home: the tasks card goes above the KPIs. On wide screens, the cash-flow and top-sellers sections sit side by side, as do the P&L and by-channel sections (`.grid-2`).
- [ ] i18n; implement; browser check by script (owner, manager, staff); commit `feat(ui): today tasks and setup checklist on Home`.

### Task 4: Close the day, and multi-channel sales entry

**Files:** `app/js/views/close.js` (new; route `#/close` and `#/close/<date>` via `app.js` VIEWS), `app/js/views/sales.js`, `app/js/views/stock.js` (export `openEntry`), `i18n.js`, `sw.js`.

- **Sales entry sheet:** quantities are kept per channel (`qtys[channelId][dishId]`). The channel select shows a count badge per channel. The footer total covers all channels. Save posts one `sales.add` per channel with quantities; on a failure it toasts the failed channel's name and keeps that channel's quantities.
  - It accepts `openSales(ctx, { date, onSaved })` (exported) so the close flow can open it for a given date.
- **close.js:** a page titled "ปิดยอดประจำวัน" for the date, with four step cards:
  1. ยอดขาย (shows that date's total; "บันทึก" opens the sales sheet for that date);
  2. ของเสีย (opens the waste entry);
  3. นับสต็อก (opens the count entry pre-filtered to the key items: tracked preps plus the top 10 by stock value);
  4. ตรวจและปิดยอด (a summary of sales total, food cost %, waste value and count lines, a note, then "ปิดยอด" → `day.close`).

  Each card shows done/pending from that date's data. After a close: a success state, with "ดูสรุป" linking to Home.
- [ ] i18n; implement; **browser check by script:**
  - quantities on 2 channels → 2 sales rows;
  - switching channel keeps the quantities;
  - the close flow marks the steps done and closes;
  - Home then shows "ปิดยอดแล้ว".
- [ ] Commit `feat(ui): close the day routine and multi-channel sales entry`.

### Task 5: Faster entry — search and recent items

**Files:** `app/js/views/stock.js` (`lineEditor`, `ingredientOptions`), `app/js/ui.js` (`recent` helpers).

- `ui.js`: `recentIds(key) -> string[]` and `pushRecent(key, id, max=8)`, using localStorage `ro.recent.<key>` and wrapped in try/catch.
- `lineEditor`:
  - Each line gets a search input above the select ("ค้นหาวัตถุดิบ") that filters the options by name or category and auto-selects when exactly one matches.
  - A row of "ล่าสุด" chips (up to 6 recent ingredients) fills the line on tap.
  - Saving a purchase, usage, waste or count pushes the ids used.
- [ ] i18n; implement; browser check by script (search filters; a recent chip appears after a save); commit `feat(ui): ingredient search and recent items in stock entry`.

### Task 6: Kitchen mode for SOPs

**Files:** `app/js/views/sop.js`, `app/css/app.css`, `i18n.js`.

- A "โหมดครัว" button in the SOP sheet foot opens a full-screen overlay (`.kitchen`) showing:
  - the dish name and portions;
  - an "วัตถุดิบ" panel (scaled);
  - **one step at a time** in ≥ 26 px text, with big ก่อนหน้า / ถัดไป buttons (≥ 56 px), "ขั้นตอน n/N", and the critical step highlighted;
  - a timer chip when the step has minutes (tap starts a countdown that vibrates or beeps when done; the timer stops if you leave the step);
  - a close button.
- On wide screens the ingredients and the step sit side by side.
- Wake Lock: `navigator.wakeLock?.request('screen')`, ignoring failure, released on close.
- Keys: ← → move between steps, Esc closes.
- [ ] i18n; implement; browser check by script (next/prev, last step shows "เสร็จแล้ว", it works with `navigator.wakeLock` undefined); commit `feat(ui): kitchen mode for SOPs`.

### Task 7: Printable monthly report

**Files:** `app/js/ui.js` (`printHtml(content)`, generalised from `sop.js` `printSops`, which then uses it), `app/js/views/home.js`, `app/css/app.css`.

- On the manager Home, a "พิมพ์รายงาน" action in the P&L section prints:
  - restaurant name, month, generated date;
  - KPIs (revenue, food cost % vs target, net profit, margin);
  - the P&L lines;
  - sales by channel;
  - the top 10 dishes;
  - the 6-month table.
- A4 portrait, black on white, page-break-safe sections.
- [ ] Implement; browser check by script (the print root contains the P&L and channel table); commit `feat(ui): printable monthly report`.

### Task 8: Demo, version, docs

- `VERSION` 1.7.0, `CACHE` v1.7.0, demo key v7; the smoke test expects 1.7.0 (RED first).
- The demo seeds `day.close` for every past day except yesterday (so the "close yesterday" task shows).
- **Docs:** a HANDOVER table row for DayCloses, the actions, and the navigation change; a README rows update; and the journey doc updated with a "Fixed in v1.7" column.
- Then `node tools/test_core.js`, `check_i18n` and `build_backend`. Commit `feat: v1.7.0 daily journeys`.
