# Restaurant Ops: user journeys (v1.6.1)

How each role moves through the app today, step by step, and where it gets clumsy. "Taps" counts taps from opening the app.

## Who uses it

| Role | Where | When | What they need most |
|---|---|---|---|
| Kitchen / floor staff | Own phone, in the kitchen | During service, at close | Record fast with dirty hands; know what to prep and how |
| Manager / head chef | Phone, sometimes laptop | Morning, deliveries, end of day | Orders, receiving, today's prep, costs drifting |
| Owner | Phone or laptop | Weekly, monthly | Profit, food cost %, which dishes and channels earn |

## Journeys

### 1. Staff: opening and prep (morning)
1. Open the app. Home shows today's sales (zero) and the low-stock list.
2. To see what to prep: Stock → find the prep → Produce (3+ taps). Nothing says *what* needs making today.
3. To cook from an SOP: More → SOP manual → dish (3 taps).

**Friction:**
- Home has no "today's prep list" or "deliveries due".
- SOPs are hidden under More.
- Nothing tells staff that a prep is running low before service.

### 2. Staff: receiving a delivery
1. Home → Receive (1 tap) → pick the order → enter quantities → save.

**Works well.** Missing: a photo of the delivery note, temperature checks for chilled goods, and the driver's name.

### 3. Staff: end of day (close)
1. Sales → + → choose channel → steppers for every dish → save.
2. Repeat for **each** channel: 4 channels means 4 separate entries.
3. Waste: Home → Waste → pick an ingredient from a long list → qty → reason.
4. Stock count: Stock → Count → one line at a time.

**Friction:**
- No single "close the day" flow.
- Sales need one entry per channel.
- Waste and count lists aren't grouped or searchable.
- There's no sign that today is "done".

### 4. Manager: morning check
1. Home shows a long dashboard: KPIs, alerts, Needs attention, quick actions, cash flow, top sellers, by channel, P&L, 6 months.

**Friction:**
- No "what needs me today" summary at the top. Deliveries due, invoices to approve, low stock, losing dishes and promotions ending are spread across the page, or in other tabs.

### 5. Manager: ordering
1. Orders → suggestions → create PO → send (LINE/email/print).

**Works well.**

### 6. Manager / owner: pricing, promotions, menu
1. More → Menu (2 taps) → Pricing / Analysis / Promotions tabs.

**Friction:**
- The most valuable expert tools (pricing, analysis, promotions) sit two levels deep under **More**.
- The Menu hub has 5 tabs crammed into a phone-width bar.

### 7. Owner: monthly review
1. Home → change month → scroll P&L and the 6-month table.

**Friction:**
- No printable or shareable monthly report (for an accountant or partner).
- No comparison with target.
- No "food cost % trend" chart.

### 8. Everyone: first real use (empty sheet)
1. Sign in → empty screens everywhere.

**Friction:**
- No setup checklist (restaurant details → channels → suppliers → ingredients → dishes → team).
- Empty states explain each screen, but nothing guides the order.

## Cross-cutting

- **Layout:** phone-only. On a tablet or laptop the app is a stretched single column.
- **Speed of entry:** long selects for ingredients (no search, no recent items, no favourites).
- **Navigation:** five bottom tabs, but Menu (the costing heart of the app) isn't one of them.
- **Feedback:** saves show a toast. There is no undo, and no "last entries" on the forms.
- **Offline:** viewing works offline, but saving needs a connection. Kitchen Wi-Fi is often weak.

## Fixed in v1.7.0

| Friction | Change |
|---|---|
| Home doesn't say what to do today | Home is now **วันนี้**: tasks per role (deliveries, preps to make, invoices, low stock, promotions ending, yesterday not closed), each one tap from the place to act |
| End of day is several screens; one sales entry per channel | **ปิดยอดประจำวัน**: sales (all channels in one entry) → waste → count key items → close, with a handover note; Home shows who closed and when |
| Long ingredient lists | Search box on every stock line, and "ใช้ล่าสุด" chips for recently used items |
| Expert tools two levels deep | **เมนู** is a bottom tab (Dishes · Preps · Pricing · Analysis · Promotions); Orders moved under More |
| No guided first setup | Owner setup checklist on Home (6 steps, with progress) |
| Phone-only layout | Left rail and wide pages from 900 px; kitchen mode for SOPs on a shared tablet |
| No shareable monthly report | **พิมพ์รายงาน** prints an A4 monthly report (KPIs, P&L, channels, top dishes, 6 months) |

Still open: saving offline (a queue for weak kitchen Wi-Fi), quick staff switching on a shared tablet (PIN), a photo of the delivery note.
