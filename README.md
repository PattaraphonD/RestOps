# Restaurant Ops

A phone app for running a restaurant's back office: **stock, recipe costing, daily sales, expenses, and profit**.

- **App:** an installable web app (PWA). It opens from the home screen like a normal app, works on Android and iPhone from one codebase, and needs no App Store or Play Store approval.
- **Middle layer:** Google Apps Script, published as a small web API. The app never talks to Google Sheets directly, so no Google credentials ever live on a phone. The script checks logins and roles, and locks every write so two people can't overwrite each other.
- **Database:** one Google Spreadsheet, one tab per table.

**English and Thai (ภาษาไทย).** Every screen, message and server error is available in both languages. Switch any time from the sign-in screen or **More → Language**. Each phone remembers its own choice, so the kitchen can use Thai while the owner uses English on the same data.

Try it now with no setup: open the app and tap **Explore with demo data**. It loads two months of sample data for a fictional Thai restaurant, in whichever language is selected. Demo data stays on that device only.

---

## What's in the box

| Area | What it does |
|---|---|
| **Stock** | Log purchases (stock in), usage, waste (with a reason) and stock counts. See live levels and stock value, with low/out-of-stock alerts and a badge on the Stock tab. |
| **Recipe costing** | Each dish lists its ingredients per portion, in any unit that makes sense (grams of basil from a kilo bag, ml of fish sauce from a bottle). Trim loss is counted through each ingredient's yield. You see food cost, food cost %, margin, the share of each ingredient, and the price needed to hit your target %. Selling a dish deducts its ingredients from stock automatically. |
| **Prep & production** | Sauces, stocks and pastes you make in the kitchen are **preps**: a recipe and a batch size, used in dishes like any ingredient. Their cost follows their ingredients. **Stock → Produce** records each batch: ingredients come out of stock, the prep goes in, and you see the real yield and cost. By-products (like chicken fat from stock) are credited. **More → Production log** lists every batch. |
| **Cost tracking** | Each ingredient keeps a cost history. When a delivery changes a cost, the app tells you which dishes now cost more, including dishes that use it through a prep. |
| **Sales** | Daily entry by dish with +/− steppers, per channel (Dine-in, Takeaway, Delivery…). Shows day totals, by-dish breakdown and food cost %. |
| **Expenses** | Rent, wages, utilities and so on, by category and payment method. |
| **Reports** | Dashboard with revenue, today's sales, food cost % vs target, net profit and stock value; daily cash-flow chart (money in vs out); top sellers; monthly profit & loss; 6-month summary. |
| **Purchasing** | Reorder suggestions from stock levels, numbered purchase orders sent to suppliers by LINE, email, SMS or a printable PO, and receiving deliveries against the order (partial deliveries supported). Supplier invoices are matched three ways (ordered, received, invoiced) with exceptions to approve or dispute, and there's a payables view (to pay, overdue, due soon). |
| **Team** | Owner / Manager / Staff roles, per-person logins, password change and reset. |
| **Languages** | English and Thai, switchable per phone. Thai uses Thai number and date formats (Buddhist-era years, ฿). |

### Roles

| | Staff | Manager | Owner |
|---|:-:|:-:|:-:|
| Enter sales, stock in, usage, waste, counts | ✓ | ✓ | ✓ |
| Stock adjustments, voids, expenses, reports | | ✓ | ✓ |
| Edit ingredients, suppliers, menu & recipes | | ✓ | ✓ |
| Team logins and settings | | | ✓ |

### How the numbers work

- **Stock on hand** = all purchases + all stock movements (usage, waste, counts, adjustments, sales deductions). Nothing is ever overwritten, so the history is a complete audit trail. A mistake is **voided** (marked, not deleted).
- **Ingredient cost** updates on every purchase, as a weighted average by default. Settings can switch it to "last purchase price".
- **Units:** a recipe can use any unit in the same family as the stock unit (g or kg, ml or L, pcs or dozen). For other units, add a conversion on the ingredient, such as 1 bottle = 0.7 L, or 1 g = 1/55 pcs for eggs.
- **Yield:** recipes hold the usable amount. An ingredient's yield is the usable share of what you buy (shrimp 85 %, lime juice 45 %). The app takes the bought amount from stock and costs it: usable ÷ yield. So 120 g of shrimp at 85 % uses 141 g.
- **Food cost per dish** = Σ(bought amount of each line × ingredient cost). Each sale stores the dish cost on the day it was sold, so old reports don't change when prices move.
- **Prep cost** = the cost of its recipe ÷ how much one batch makes. It updates when an ingredient inside it changes price. Preps can use other preps (up to 4 levels).
- **Preps in stock or made to order:** a prep kept in stock is made in batches and deducted when a dish sells. A prep made to order (like a sweet coconut cream mixed per dish) deducts its own ingredients instead.
- **Production runs** show the real result of a batch: ingredient cost, minus by-products, ÷ the amount made. A batch below 95 % of the recipe amount is flagged. The real cost is shown next to the recipe cost; dish costs always use the recipe cost.
- **Profit & loss** = Revenue − food cost (recipes) − waste and stock-count differences − operating expenses. Ingredient purchases are stock (an asset) until they're used, so they appear in **cash flow**, not as a P&L cost.
- **Cash flow** = money in (sales) vs money out (purchases + expenses), per day.

### No overwrites when two people work at once

- Every write runs inside an Apps Script `LockService` lock, so requests queue instead of interleaving.
- Stock, sales, purchases and expenses are **append-only ledgers**. Two people logging at the same time both get saved.
- Shared records (ingredients, suppliers, menu, users) carry a `version` number. If someone else saved first, your save is refused with a clear message instead of silently replacing their change.

---

## Project layout

```
app/                      ← the PWA (static files: host these)
  index.html, manifest.webmanifest, sw.js, config.js
  css/app.css             ← design system (light + dark)
  js/core.js              ← ALL business rules (shared with the server)
  js/costing.js           ← costing maths: units, yield, preps (shared with the server)
  js/i18n.js              ← English + Thai text and default lists
  js/api.js               ← API client (Apps Script or demo)
  js/demo.js              ← demo backend + sample data
  js/app.js, ui.js, charts.js, views/*.js
backend/                  ← Google Apps Script project
  Server.gs               ← web API, Sheets storage, locks, sessions, setup()
  Core.gs                 ← GENERATED copy of app/js/core.js
  Costing.gs              ← GENERATED copy of app/js/costing.js
  appsscript.json
tools/
  build_backend.py        ← copies core.js and costing.js → backend/Core.gs, Costing.gs
  test_core.js            ← runs the business-logic tests in tools/tests (Node)
  serve.py                ← local preview server
  make_icons.py           ← regenerates the PNG app icons
  check_i18n.py           ← checks every text exists in English and Thai
```

`app/js/core.js` (with `app/js/costing.js`) is the single source of truth for business logic. The demo and the real server run the **same** code. After changing it, run:

```bash
python tools/build_backend.py
```

---

## Setup (about 15 minutes)

### 1. Create the spreadsheet and the API

1. Create a new Google Sheet and name it after your restaurant (the name becomes the restaurant name in the app).
2. In the sheet: **Extensions → Apps Script**.
3. In the editor:
   - Replace the contents of `Code.gs` with `backend/Server.gs`. You can rename the file to `Server`.
   - Click **+ → Script**, name it `Core`, and paste `backend/Core.gs`. Do the same for `Costing` with `backend/Costing.gs`.
   - **Project Settings (⚙) → Show "appsscript.json" manifest file in editor**, then replace it with `backend/appsscript.json`. Change `timeZone` if you're not in Thailand.
4. Select the `setup` function in the toolbar and click **Run**. Approve the permissions.
   For a Thai restaurant, run **`setupThai`** instead. It is the same, but fills the sales channels, expense, ingredient and menu categories and units with Thai lists.
   It creates all the tabs and the first **owner** login. The temporary password is shown in the **Execution log**.
5. **Deploy → New deployment → Select type: Web app**
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**. The app has its own logins; this setting only lets phones reach the API.
   - Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

> Updating the script later? Use **Deploy → Manage deployments → Edit (pencil) → Version: New version**. This keeps the same URL. A *new* deployment gets a new URL.

### 2. Host the app

The app is plain static files: no build step, no server code. It needs **HTTPS** so it can be installed. Any static host works:

- **Vercel** (what this restaurant uses): import the project and set **Root Directory** to `app` (Settings → Build and Deployment), with no build command. Security and caching headers come from `app/vercel.json`.
- **Netlify Drop**: drag the `app/` folder onto app.netlify.com/drop. Headers come from `app/_headers`.
- **GitHub Pages**, **Cloudflare Pages**, **Firebase Hosting**, or your own web server.

Optional: paste the web-app URL into `app/config.js` (`apiUrl: '…/exec'`) before uploading, so staff don't have to enter it. Otherwise each phone enters it once on the sign-in screen, under *Server connection*.

### 3. First sign-in

1. Open the hosted URL on your phone and sign in as `owner` with the temporary password.
2. **More → My account → Change password.**
3. **More → Settings:** currency, number format, food-cost target, categories, sales channels.
4. **More → Suppliers**, then **Stock → +** for each ingredient (unit, cost, minimum level).
5. **Menu → +** for each dish and its recipe.
6. **More → Team & logins:** create a login for each manager and staff member.
7. Install the app: iPhone → Safari → Share → **Add to Home Screen**. Android → Chrome → ⋮ → **Install app**.

### Daily routine

| When | Who | What |
|---|---|---|
| Stock is low | Manager | Orders → **Reorder** → create the order → **Send** (LINE, email, print) |
| Deliveries arrive | Staff | Orders → **Receive**: count what arrived against the order. Market buys without an order: Stock → **Stock in** |
| Supplier invoice arrives | Manager | Orders → **Invoice**: link it to the order. Anything that doesn't match is flagged to approve or dispute. |
| Bills are due | Manager/Owner | Orders → Invoices → **To pay** → **Mark paid** |
| A sauce or stock is made | Staff | Stock → **Produce** |
| Something is thrown away | Staff | Stock → **Waste** |
| End of day | Staff/Manager | Sales → **Add sales** (one entry per channel) |
| Bills paid | Manager | More → Expenses → **Add expense** |
| Weekly | Manager | Stock → **Count** on high-value items |
| Monthly | Owner | Home → review P&L, food cost %, top sellers |

---

## Local development

```bash
python tools/serve.py
```

Then open http://localhost:5173 and use **Explore with demo data**. The service worker uses network-first loading, so a reload always picks up your edits.

Run the business-logic tests (Node, no install needed):

```bash
node tools/test_core.js
```

## Purchasing (how it works)

1. **Reorder suggestions.** An item is suggested when stock on hand plus quantity already on order is at or below its **minimum**. The suggested quantity tops it up to its **par level** (set per ingredient; twice the minimum if empty). Suggestions are grouped by each ingredient's usual supplier.
2. **Purchase order.** POs are numbered `PO<yymm>-0001`. The delivery date defaults to the supplier's delivery time. A draft can be edited; once sent it's locked.
3. **Send.** Share the order by LINE, the phone's share menu, copy, email, SMS, or print/PDF. Choosing any of these marks the order as *sent*. For orders placed by phone, use "mark as sent".
4. **Receive.** Staff count what arrived. Each received line becomes stock-in (with the PO link) and updates ingredient cost. The order becomes *part received* or *received*. If the rest won't come, a manager **closes** it.
5. **Invoice and 3-way match.** Each invoice line is compared with what was ordered and what was received:
   - billed more than received (or never received)
   - price above the order price by more than the **price tolerance** (Settings, default 2%)
   - item not on the order
   - invoice total ≠ lines + VAT

   A clean invoice is **matched** and can be paid. Otherwise it needs a manager to **approve** it with a note, or **dispute** it. Invoices without an order must be approved manually. The same invoice number from the same supplier can't be entered twice.
6. **Pay.** Mark matched or approved invoices as paid (date, method, reference). The due date comes from the supplier's payment terms. Ingredient cost was already counted when the goods were received, so paying doesn't add an expense.

Saves for orders, deliveries, invoices and payments carry a request ID, so a retry after a timeout never records them twice.

## Languages

- All app text lives in `app/js/i18n.js`, in two dictionaries (`en` and `th`) with the same keys. To change wording, edit it there.
- After adding or renaming text, run `python tools/check_i18n.py`. It fails if any key is missing from either language.
- Server error messages are written in English in `core.js` and translated to Thai at the end of each request (`TH_RULES` in `core.js`). If you add a new error message, add a Thai rule for it.
- **Your data** (ingredient names, dishes, categories, suppliers) is stored exactly as typed, so name things in whichever language your team reads. **Settings → Fill lists with … defaults** replaces the category, channel and unit lists with the selected language's defaults.

## Releasing an update

1. Edit files in `app/`. If you changed `core.js` or `costing.js`, run `node tools/test_core.js` and `python tools/build_backend.py`, and paste the new `Core.gs` and `Costing.gs` into Apps Script (then **Manage deployments → New version**).
2. Bump `CACHE` in `app/sw.js` and `VERSION` in `core.js`. If you changed any text, run `python tools/check_i18n.py`.
3. Re-upload `app/` to your host. Phones pick up the new version the next time the app opens.

## Notes and limits

- **Scale:** every request reads the tabs it needs. This is comfortable for a single restaurant for a year or more (tens of thousands of rows). For multi-year history, copy old rows to an archive spreadsheet once a year and record an opening-stock count.
- **Sessions** last 6 hours after the last activity, then you sign in again.
- **Passwords** are salted and hashed; the plain password is never stored. Five wrong attempts lock that username for 10 minutes. If the owner is locked out, run `resetOwnerPassword` from the Apps Script editor.
- **Offline:** the app opens and shows its screens without signal. Saving needs a connection, and the app tells you clearly when you're offline.
- **A store app later:** the Apps Script API is a plain JSON API (`POST { action, token, payload }`), so a Flutter or React Native app can use the same backend unchanged.
- The **bound-script** setup above uses the minimal `spreadsheets.currentonly` permission. If you deploy the script as a standalone project with `SPREADSHEET_ID` set, change that scope in `appsscript.json` to `https://www.googleapis.com/auth/spreadsheets`.
