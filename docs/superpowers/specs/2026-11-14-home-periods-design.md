# Home: daily and weekly summaries (v1.10.0) — design

**Intent.** Owners and managers want to run the restaurant week by week and check any single day, not only the month. Home gets a **วัน · สัปดาห์ · เดือน** (day · week · month) switch with like-for-like comparisons.

**Goals.** A weekly summary (Monday–Sunday) with the shape of the week; a daily summary for any day; fair comparisons; one tap from a day in the week to that day. The month view stays as it is.
**Non-goals.** Hourly sales (no time-of-sale data); staff Home (unchanged).
**Anti-goals.** Comparing a part-week with a whole week; a daily "net profit" that swings on the day rent was paid without saying so.

## Approaches
1. **One server action `reports.period` for day and week, reusing periodTotals (chosen).** Same maths as the month P&L; one call per screen.
2. Fetch sales.list and compute in the browser. Rejected: no cost/waste/expense totals there; duplicate P&L logic.
3. Extend reports.summary with from/to. Rejected: its six-month trend and cash-flow parts don't fit a day; it would get heavier for every call.

## Decisions (my calls)
- **Week** = Monday–Sunday containing the chosen date. The current week counts up to today ("สัปดาห์นี้ถึงวันนี้").
- **Comparisons**: a day against the same weekday last week; a week against the same days of last week (Mon–today vs Mon–same weekday last week).
- **KPIs**: revenue (hero, with comparison), dishes sold, food cost % against target, gross profit (after food, commission and waste) with margin, and average a day (week) or average a dish (day).
- **Week**: a bar per day, this week against last week as a lighter bar, best day marked; a day list (revenue, dishes, food cost %, closed ✓) where tapping a day opens it.
- **Day**: whether the day was closed (who, when, handover note) or a button to close it; waste for the day (top items by value).
- **Both**: top dishes, sales by channel, a P&L for the period with expenses by category and a note that expenses count on the day they're recorded.
- The chosen view is remembered on the device (`ro.home.period`). The Today and setup cards show whenever the period includes today. Printing stays on the month view.
