# Stock budget and ordering (Layer B, v1.9.0) — design

**Intent.** "Know before the kitchen runs out" and "how much of this month's ingredient budget is gone". Managers see the month's ingredient budget against spending, what the stock on the shelf is worth, and one tap to the items to order.

**Goals.** A monthly ingredient budget (automatic from expected revenue × food cost target, or set by the owner), spent vs left with a ring and month pace; stock value; a "ต้องสั่ง" (to order) list with a one-tap jump to order suggestions; search by name, code or supplier; an optional ingredient code.
**Non-goals.** Storage locations (Layer D); POS import (Layer C).
**Anti-goals.** A budget figure with no visible basis; "to order" counts that disagree with Home.

## Approaches
1. **Server action for the budget, client for stock value and lists (chosen).** Budget needs Sales and Purchases history the client doesn't hold; stock value and statuses are already in boot.
2. Budget from reports.summary in the client. Rejected: no 28-day average, month-only.
3. Budget only as a fixed owner setting. Rejected: most owners won't keep it current; kept as an optional override.

## Decisions (my calls)
- **Expected revenue** = sales so far this month + average daily sales of the last 28 days (or since the first sale, if newer) × days left in the month.
- **Budget** = owner's `foodBudget` setting if set (> 0), else expected revenue × target food cost %. The card says which.
- **Spent** = non-voided Purchases (stock in, including PO receipts) dated this month up to today.
- **Pace**: `over` when spent > budget; `ahead` when % used > % of month gone + 10; else `ok`. Ring colour teal / yellow / red.
- **Stock value** = Σ max(0, on hand × cost) of active items; "from N items in stock".
- **Chips**: ทั้งหมด · ต้องสั่ง (raw items low or out — same rule as Home's low-stock task) · ต้องทำ (preps low/out, when any) · ของเตรียม · categories. On ต้องสั่ง, managers get "สร้างใบสั่งซื้อ" → order suggestions.
- **Ingredient code**: optional text (≤ 30), unique among active ingredients (case-insensitive); shown before the name in lists and searchable.
- Budget card is manager+; staff see stock value and lists only.
