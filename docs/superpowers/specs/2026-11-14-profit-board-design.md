# Menu profit board (Layer A, v1.8.0) — design

**Intent.** Owners should see every dish's cost and profit on every sales channel on one screen, and spot losers at once ("เมนูกำไรบาง เห็นทันทีในหน้าเดียว"). Today Pricing shows one channel at a time.

**Goals.** One board: price, cost, food cost % against target, and profit per dish on each channel. Two profit figures per cell: **real profit** (after the shop's running costs per dish) and **margin before running costs**. Filters with counts: all · real profit below zero · food cost over target · no recipe. A suggested price wherever a channel misses the target or loses money. Wide table on tablet/laptop, one card per dish on a phone.
**Non-goals.** No new data entry; the existing per-channel view and "apply suggested prices" stay.
**Anti-goals.** A real-profit figure that hides how it was worked out; a table that scrolls sideways on a phone.

## Approaches
1. **Board in the Pricing tab, maths in RestoPricing, running cost from a small server action (chosen).** Re-uses channelEconomics; one testable pure function; the server sums expenses and dishes sold.
2. Compute running costs in the browser from reports.summary. Rejected: the monthly report has no dishes-sold-in-30-days figure and the month may be partial.
3. Make the owner type a running cost per dish. Rejected for now: one more setting to keep up to date; the computed figure is shown with its workings instead.

## Decisions (my calls)
- **Running cost per dish** = non-voided Expenses in the last 30 days ÷ dishes sold (non-voided Sales qty) in the same 30 days. Shown above the board with its workings. If nothing was sold, real profit is not shown (margin only).
- **Margin** = channelEconomics `cm` (net after commission − food − packaging). **Real profit** = margin − running cost per dish.
- **Food cost %** column uses the menu (dine-in) price; over target when > target.
- **Suggested price** per channel = the higher of the target price (existing formula) and the break-even price (food + packaging + running cost) ÷ (1 − commission), rounded with the shop's rounding rule; shown only when it is above the current price.
- **"Real profit below zero"** = any channel with real profit < 0.
- Pricing tab gets a switch: **ทุกช่องทาง** (board, default) · **รายช่องทาง** (existing view). Tapping a dish opens the dish editor; tapping a channel header opens that channel's view.
- Sort: name (by category), food cost % highest, real profit lowest.
