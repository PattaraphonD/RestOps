// Stock: levels, low-stock alerts, purchases (stock in), usage, waste, counts, history.
import { call } from '../api.js';
import {
  html, raw, mount, icon, money, unitMoney, number, qty, pct, today, fmtMonth, relDay, timeOf, $, $$, openSheet, confirmSheet,
  toast, busy, options, emptyState, statusPill, foodCostPill, initials, unitLabel,
  recentIds, pushRecent,
} from '../ui.js';
import { list } from '../app.js';
import { t } from '../i18n.js';
import { sopSheet } from './sop.js';
import { recipeLines } from './recipe-lines.js';
import { produceSheet } from './production.js';
import { sparkline } from '../charts.js';

const ui = { tab: 'levels', filter: 'all', search: '' };

const TYPE_META = {
  purchase: { icon: 'truck', cls: 'good' },
  usage: { icon: 'fork', cls: '' },
  waste: { icon: 'waste', cls: 'bad' },
  count: { icon: 'clipboard', cls: 'warn' },
  adjustment: { icon: 'sliders', cls: 'warn' },
  sale: { icon: 'receipt', cls: '' },
  produce: { icon: 'chef', cls: 'good' },
  production: { icon: 'chef', cls: '' },
  byproduct: { icon: 'chef', cls: 'good' },
};
const PRODUCTION_TYPES = ['production', 'produce', 'byproduct'];
// Sheets exported to other views (Menu → Preps) redraw that view instead of Stock after saving.
const redraw = (ctx) => (ctx.redraw ? ctx.redraw() : render(ctx));
const typeLabel = (type) => t(`type.${type}`);
const WASTE_REASONS = ['stock.reasonSpoiled', 'stock.reasonExpired', 'stock.reasonDropped', 'stock.reasonOverprep', 'stock.reasonReturned'];

const TILE_LABEL = { count: 'stock.countShort', produce: 'stock.produceShort' };
/** Quick-action tiles in a grid sized to how many there are (five fit one row on a phone). */
const actionTiles = (types = ['purchase', 'produce', 'usage', 'waste', 'count']) => html`<div class="actions-grid ${types.length > 4 ? 'dense' : ''}"
  style="grid-template-columns:repeat(${types.length},minmax(0,1fr))">${types.map((type) => html`<button class="action-tile" data-act="${type}">
  <span class="avatar brand">${icon(TYPE_META[type].icon)}</span>${TILE_LABEL[type] ? t(TILE_LABEL[type]) : typeLabel(type)}</button>`)}</div>`;

/** After stock in / receiving: "Pork +8% → 6 dishes cost more, 2 over target", with the dish list one tap away. */
export function impactToast(ctx, impact) {
  if (!impact || !impact.ingredients || !impact.ingredients.length) return;
  const first = impact.ingredients[0];
  const more = impact.ingredients.length - 1;
  const change = `${first.changePct > 0 ? '+' : '−'}${pct(Math.abs(first.changePct))}${more ? ` ${t('stock.impactMore', { n: more })}` : ''}`;
  const dishes = impact.dishes || [];
  const up = dishes.filter((d) => d.newCost > d.oldCost).length;
  const over = dishes.filter((d) => d.overTarget).length;
  const msg = !dishes.length ? t('stock.impactNone', { name: first.name, pct: change })
    : up ? t('stock.impact', { name: first.name, pct: change, n: up, m: over })
      : t('stock.impactDown', { name: first.name, pct: change, n: dishes.length });
  toast(msg, up ? 'warn' : 'info', 9000, { label: dishes.length ? t('stock.seeDishes') : t('stock.seeDetails'), onClick: () => impactSheet(ctx, impact) });
}

function impactSheet(ctx, impact) {
  const target = ctx.state.boot.settings.targetFoodCostPct;
  const change = (v) => (v === null || v === undefined ? '' : html`<span class="${v > 0 ? 'change-up' : 'change-down'}">${v > 0 ? '+' : '−'}${pct(Math.abs(v))}</span>`);
  openSheet({
    title: t('stock.impactTitle'),
    body: html`
      <div class="section-head"><h2 style="font-size:15px">${t('stock.impactCosts')}</h2></div>
      <div class="card" style="margin-bottom:16px"><ul class="list">${impact.ingredients.map((i) => html`<li class="row" style="min-height:52px">
        <span class="grow"><div class="title">${i.name}</div><div class="sub">${unitMoney(i.oldCost)} → ${unitMoney(i.newCost)}</div></span>
        <span class="value">${change(i.changePct)}</span></li>`)}</ul></div>
      <div class="section-head"><h2 style="font-size:15px">${t('stock.impactDishes')}</h2></div>
      <div class="card">${(impact.dishes || []).length ? html`<ul class="list">${impact.dishes.map((d) => html`<li class="row" style="min-height:56px">
        <span class="grow"><div class="title">${d.name}</div><div class="sub">${t('stock.impactDishCost', { old: money(d.oldCost), now: money(d.newCost) })}</div></span>
        <span class="value"><div>${foodCostPill(d.foodCostPct, target)}</div>${d.overTarget ? html`<div class="sub" style="color:var(--bad-ink)">${t('stock.overTarget')}</div>` : ''}</span></li>`)}</ul>`
        : emptyState('check', t('stock.impactNoDishesTitle'), t('stock.impactNoDishesText'))}</div>
      <p class="small muted" style="margin:10px 2px 0">${t('stock.impactNote', { pct: pct(target, 0) })}</p>`,
    foot: html`<button class="btn" data-close>${t('common.close')}</button><button class="btn primary" data-menu>${icon('chef')}${t('stock.openMenu')}</button>`,
    onMount(el, close) {
      el.querySelector('[data-menu]').addEventListener('click', () => { close(); setTimeout(() => { location.hash = '#/menu'; }, 300); });
    },
  });
}

export async function render(ctx) {
  const { el, params, setTitle, setActions, can } = ctx;
  setTitle(t('nav.stock'));
  if (can('manager')) {
    setActions(html`<button class="icon-btn" id="new-ing" aria-label="${t('stock.newIngredient')}">${icon('plus')}</button>`)
      .querySelector('#new-ing').addEventListener('click', () => ingredientSheet(ctx));
  }

  // Deep links: #/stock/low, #/stock/purchase, #/stock/waste, #/stock/item/ID …
  const [action, id] = params;
  if (action) { history.replaceState(null, '', '#/stock'); ctx.params = []; }
  if (action === 'low') { ui.filter = 'attention'; ui.tab = 'levels'; }

  mount(el, html`
    <div style="margin-top:4px">${actionTiles()}</div>
    <div class="seg" role="group" aria-label="${t('stock.view')}" style="margin-top:18px">
      <button aria-pressed="${ui.tab === 'levels'}" data-tab="levels">${t('stock.levels')}</button>
      <button aria-pressed="${ui.tab === 'history'}" data-tab="history">${t('stock.history')}</button>
    </div>
    <div id="tab"></div>`);
  $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => openEntry(ctx, b.dataset.act)));
  $$('[data-tab]', el).forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(ctx); }));

  if (ui.tab === 'levels') renderLevels(ctx); else await renderHistory(ctx);

  if (['purchase', 'produce', 'usage', 'waste', 'count', 'adjustment'].includes(action)) openEntry(ctx, action);
  if (action === 'item' && id) itemSheet(ctx, id);
}

/* ---------------------------------------------------------------- levels */

function renderLevels(ctx) {
  const { state, can } = ctx;
  const all = state.boot.ingredients.filter((i) => i.active);
  // To order: bought items low or out (same rule as Home). To make: preps low or out.
  const attention = all.filter((i) => i.status !== 'ok' && i.kind !== 'prep');
  const toMake = all.filter((i) => i.status !== 'ok' && i.kind === 'prep');
  const preps = all.filter((i) => i.kind === 'prep');
  if (ui.filter === 'preps' && !preps.length) ui.filter = 'all';
  if (ui.filter === 'make' && !toMake.length) ui.filter = 'all';
  const cats = [...new Set(all.map((i) => i.category).filter(Boolean))].sort();
  const stockValue = all.reduce((a, i) => a + Math.max(0, i.value), 0);
  const inStock = all.filter((i) => i.onHand > 0).length;
  const manager = can('manager');
  const tab = $('#tab');
  mount(tab, html`
    <div class="stock-overview${manager ? ' with-budget' : ''}">
      ${manager ? html`<div class="card pad budget-card" id="budget"><div class="skeleton" style="height:120px"></div></div>` : ''}
      <div class="stock-side">
        ${manager ? html`<div class="card pad mini-kpi" id="forecast"><div class="label">${icon('chart')}${t('budget.forecast')}</div><div class="val">—</div></div>` : ''}
        <div class="card pad mini-kpi"><div class="label">${icon('box')}${t('budget.stockValue')}</div>
          <div class="val">${money(stockValue, { cents: false })}</div><div class="sub">${t('budget.stockItems', { n: inStock })}</div></div>
      </div>
    </div>
    <div class="search">${icon('search')}<input class="input" type="search" placeholder="${t('stock.searchCode')}" value="${ui.search}" aria-label="${t('stock.searchCode')}"></div>
    <div class="chips" role="group" aria-label="${t('common.filter')}">
      <button class="chip" data-f="attention" aria-pressed="${ui.filter === 'attention'}">${icon('clipboard')}${t('stock.toOrder')}<span class="count${attention.length ? ' hot' : ''}">${attention.length}</span></button>
      ${toMake.length ? html`<button class="chip" data-f="make" aria-pressed="${ui.filter === 'make'}">${t('stock.toMake')}<span class="count hot">${toMake.length}</span></button>` : ''}
      <button class="chip" data-f="all" aria-pressed="${ui.filter === 'all'}">${icon('box')}${t('common.all')}<span class="count">${all.length}</span></button>
      ${preps.length ? html`<button class="chip" data-f="preps" aria-pressed="${ui.filter === 'preps'}">${t('stock.filterPreps')}<span class="count">${preps.length}</span></button>` : ''}
      ${cats.map((c) => html`<button class="chip" data-f="cat:${c}" aria-pressed="${ui.filter === 'cat:' + c}">${c}</button>`)}
    </div>
    <div id="order-bar"></div>
    <div class="card" id="levels"></div>`);
  if (manager) drawBudget(tab);
  const draw = () => {
    const q = ui.search.trim().toLowerCase();
    let rows = all;
    if (ui.filter === 'attention') rows = attention;
    else if (ui.filter === 'make') rows = toMake;
    else if (ui.filter === 'preps') rows = preps;
    else if (ui.filter.startsWith('cat:')) rows = rows.filter((i) => i.category === ui.filter.slice(4));
    if (q) rows = rows.filter((i) => i.name.toLowerCase().includes(q) || (i.code || '').toLowerCase().includes(q) || (i.supplierName || '').toLowerCase().includes(q));
    mount($('#order-bar'), manager && ui.filter === 'attention' && attention.length
      ? html`<a class="btn primary block" href="#/orders/suggest" style="margin-bottom:12px">${icon('truck')}${t('stock.makePo', { n: attention.length })}</a>` : '');
    rows = rows.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    mount($('#levels'), rows.length ? html`<ul class="list">${rows.map((i) => html`<li>
      <button class="row" data-id="${i.id}">
        <span class="avatar ${i.status === 'out' ? 'bad' : i.status === 'low' ? 'warn' : ''}">${initials(i.name)}</span>
        <span class="grow"><div class="title">${i.code ? html`<span class="code-tag">${i.code}</span>` : ''}${i.name}</div>
          <div class="sub">${i.kind === 'prep' ? html`<span class="pill brand">${t('stock.prepBadge')}</span> ` : ''}${t('stock.minShort', { qty: qty(i.minLevel, unitLabel(i.unit)) })} · ${i.onOrder ? t('stock.onOrderShort', { qty: qty(i.onOrder, unitLabel(i.unit)) }) : `${unitMoney(i.costPerUnit)}/${unitLabel(i.unit)}`}</div></span>
        <span class="value"><div>${qty(i.onHand, unitLabel(i.unit))}</div><div>${statusPill(i.status)}</div></span>
      </button></li>`)}</ul>`
      : ui.filter === 'attention'
        ? emptyState('check', t('stock.allStockedTitle'), t('stock.allStockedText'))
        : emptyState('box', t('stock.noIngredientsTitle'), q ? t('common.noMatch') : t('stock.noIngredientsText')));
    $$('#levels [data-id]').forEach((b) => b.addEventListener('click', () => itemSheet(ctx, b.dataset.id)));
  };
  tab.querySelector('input').addEventListener('input', (e) => { ui.search = e.target.value; draw(); });
  $$('[data-f]', tab).forEach((b) => b.addEventListener('click', () => {
    ui.filter = b.dataset.f;
    $$('[data-f]', tab).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  }));
  draw();
}
const rank = (i) => (i.status === 'out' ? 0 : i.status === 'low' ? 1 : 2);

/** This month's ingredient budget: a ring of what's used, what's left, and the month's pace. */
async function drawBudget(tab) {
  const b = await call('stock.budget', { today: today() }).catch(() => null);
  const box = tab.querySelector('#budget');
  if (!box || !box.isConnected) return;
  if (!b) { box.remove(); tab.querySelector('#forecast')?.remove(); return; }
  const used = b.usedPct === null ? 0 : Math.min(100, b.usedPct);
  const R = 42, C = 2 * Math.PI * R;
  const cls = b.pace === 'over' ? 'bad' : b.pace === 'ahead' ? 'warn' : 'ok';
  mount(box, html`
    <div class="budget-head"><h2>${t('budget.title')}</h2><span class="small muted">${fmtMonth(b.month)}</span></div>
    ${b.budget > 0 ? html`<div class="budget-body">
      <div class="ring ${cls}" role="img" aria-label="${t('budget.ringLabel', { pct: number(b.usedPct || 0, 0) })}">
        <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${R}" class="ring-track"/>
          <circle cx="50" cy="50" r="${R}" class="ring-bar" stroke-dasharray="${(used / 100 * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/>
          <line class="ring-pace" x1="50" y1="2" x2="50" y2="14" transform="rotate(${(b.elapsedPct * 3.6).toFixed(1)} 50 50)"/></svg>
        <div class="ring-text"><b>${number(b.usedPct || 0, 0)}<small>%</small></b><span>${t('budget.used')}</span></div>
      </div>
      <div class="budget-figs">
        <div class="small muted">${b.remaining >= 0 ? t('budget.left') : t('budget.overBy')}</div>
        <div class="budget-left ${b.remaining < 0 ? 'neg' : ''}">${money(Math.abs(b.remaining), { cents: false })}</div>
        <div class="small">${t('budget.spentOf', { spent: money(b.spent, { cents: false }), budget: money(b.budget, { cents: false }) })}</div>
        <div class="pill ${cls === 'ok' ? 'good' : cls}" style="margin-top:8px">${t(`budget.pace.${b.pace}`, { pct: number(b.elapsedPct, 0) })}</div>
      </div></div>
      <p class="small muted" style="margin:12px 0 0">${b.source === 'set' ? t('budget.basisSet') : t('budget.basisAuto', { pct: number(b.targetPct, 1) })}</p>`
    : html`<p class="small muted" style="margin:6px 0 0">${t('budget.noSales')}</p>`}`);
  const f = tab.querySelector('#forecast');
  if (f) mount(f, html`<div class="label">${icon('chart')}${t('budget.forecast')}</div><div class="val">${money(b.forecastRevenue, { cents: false })}</div>
    <div class="sub">${t('budget.forecastHow', { avg: money(b.avgDaily, { cents: false }) })}</div>`);
}

/* --------------------------------------------------------------- history */

async function renderHistory(ctx) {
  const tab = $('#tab');
  mount(tab, html`<div class="skeleton" style="height:300px"></div>`);
  const from = addDaysLocal(today(), -30);
  const [purchases, moves] = await Promise.all([
    call('purchases.list', { from, limit: 200 }),
    call('movements.list', { from, limit: 200 }),
  ]);
  if (ctx.stale() || !tab.isConnected) return;
  const entries = [
    ...purchases.map((p) => ({ ...p, kind: 'purchase', type: 'purchase', qty: p.qty, value: p.total })),
    ...moves.map((m) => ({ ...m, kind: 'movement' })),
  ].sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
  const byDay = {};
  entries.forEach((e) => (byDay[e.date] ||= []).push(e));
  mount(tab, entries.length ? Object.keys(byDay).map((d) => html`
      <div class="section-head" style="margin-top:16px"><h2 style="font-size:15px">${relDay(d)}</h2></div>
      <div class="card"><ul class="list">${byDay[d].map((e) => historyRow(e))}</ul></div>`)
    : html`<div class="card">${emptyState('clipboard', t('stock.noActivityTitle'), t('stock.noActivityText'))}</div>`);
  $$('[data-entry]', tab).forEach((b) => b.addEventListener('click', () => {
    const e = entries.find((x) => x.id === b.dataset.entry);
    entrySheet(ctx, e);
  }));
}

function historyRow(e) {
  const m = TYPE_META[e.type] || TYPE_META.usage;
  const sign = e.qty > 0 ? '+' : '';
  return html`<li><button class="row ${e.voided ? 'voided' : ''}" data-entry="${e.id}">
    <span class="avatar ${m.cls}">${icon(m.icon)}</span>
    <span class="grow"><div class="title">${e.ingredientName}</div>
      <div class="sub">${typeLabel(e.type)}${e.reason ? ' · ' + e.reason : ''}${e.supplierName ? ' · ' + e.supplierName : ''} · ${e.createdBy}${e.voided ? ' · ' + t('common.voided') : ''}</div></span>
    <span class="value"><div>${sign}${qty(Math.round(e.qty * 1000) / 1000, unitLabel(e.unit))}</div><div class="sub">${money(Math.abs(e.value))}</div></span>
  </button></li>`;
}

function entrySheet(ctx, e) {
  const fromRun = PRODUCTION_TYPES.includes(e.type);
  const canVoid = ctx.can('manager') && !e.voided && e.type !== 'sale' && !fromRun;
  const row = (label, value) => html`<li class="pl-row"><span>${label}</span><b style="text-align:right">${value}</b></li>`;
  openSheet({
    title: typeLabel(e.type),
    body: html`<ul class="list">
      ${row(t('stock.ingredient'), e.ingredientName)}
      ${row(t('stock.quantity'), `${e.qty > 0 ? '+' : ''}${qty(Math.round(e.qty * 1000) / 1000, unitLabel(e.unit))}`)}
      ${e.kind === 'purchase' ? html`${row(t('stock.unitCost'), money(e.unitCost))}${row(t('stock.supplier'), e.supplierName || '—')}${row(t('stock.invoice'), e.invoiceRef || '—')}` : ''}
      ${row(t('stock.value'), money(Math.abs(e.value)))}
      ${row(t('common.date'), relDay(e.date))}
      ${row(t('common.enteredBy'), `${e.createdBy} · ${timeOf(e.createdAt)}`)}
      ${e.reason || e.note ? row(t('common.note'), e.reason || e.note) : ''}
      ${e.voided ? html`<li class="pl-row"><span>${t('common.status')}</span><span class="pill bad">${t('common.voidedCap')}</span></li>` : ''}
    </ul>
    ${e.type === 'sale' ? html`<p class="small muted">${t('stock.saleDeductNote')}</p>` : ''}
    ${fromRun ? html`<p class="small muted">${t('stock.fromRunNote', { no: e.reason || '' })}</p>` : ''}`,
    foot: canVoid ? html`<button class="btn danger" data-void>${icon('trash')}${t('stock.voidEntry')}</button>`
      : fromRun ? html`<button class="btn" data-log>${icon('chef')}${t('production.logTitle')}</button>` : null,
    onMount(el, close) {
      const lg = el.querySelector('[data-log]');
      if (lg) lg.addEventListener('click', () => { close(); setTimeout(() => { location.hash = '#/more/production'; }, 300); });
      const v = el.querySelector('[data-void]');
      if (!v) return;
      v.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: t('stock.voidTitle'), message: t('stock.voidMessage'), confirm: t('common.void'), danger: true });
        if (!ok) return;
        await busy(v, async () => {
          await call(e.kind === 'purchase' ? 'purchases.void' : 'movements.void', { id: e.id });
          close();
          toast(t('stock.entryVoided'));
          await ctx.refresh();
          redraw(ctx);
        });
      });
    },
  });
}

/* ---------------------------------------------------------- item details */

export async function itemSheet(ctx, id) {
  const i = ctx.state.boot.ingredients.find((x) => x.id === id);
  if (!i) return toast(t('stock.notFound'), 'bad');
  const isPrep = i.kind === 'prep';
  const showHistory = ctx.can('manager');
  const sheet = openSheet({
    title: i.name,
    body: html`
      <div class="kpis" style="margin-bottom:14px">
        <div class="card kpi"><div class="label">${t('stock.onHand')}</div><div class="val">${qty(i.onHand, unitLabel(i.unit))}</div><div class="delta">${statusPill(i.status)}</div></div>
        <div class="card kpi"><div class="label">${t('stock.value')}</div><div class="val">${money(i.value)}</div><div class="delta">${unitMoney(i.costPerUnit)} / ${unitLabel(i.unit)}</div></div>
      </div>
      <ul class="list card" style="margin-bottom:14px">
        <li class="pl-row"><span>${t('stock.minLevel')}</span><b>${qty(i.minLevel, unitLabel(i.unit))}</b></li>
        ${i.parLevel ? html`<li class="pl-row"><span>${t('stock.parLevel')}</span><b>${qty(i.parLevel, unitLabel(i.unit))}</b></li>` : ''}
        ${i.onOrder ? html`<li class="pl-row"><span>${t('stock.onOrder')}</span><b>${qty(i.onOrder, unitLabel(i.unit))}</b></li>` : ''}
        <li class="pl-row"><span>${t('common.category')}</span><b>${i.category || '—'}</b></li>
        ${i.kind === 'prep' ? html`<li class="pl-row"><span>${t('stock.kind')}</span><span class="pill brand">${t('stock.prepBadge')}</span></li>
          <li class="pl-row"><span>${t('stock.batchQty')}</span><b>${qty(i.batchQty, unitLabel(i.unit))}</b></li>`
          : html`<li class="pl-row"><span>${t('stock.supplier')}</span><b>${i.supplierName || '—'}</b></li>`}
        ${Number(i.yieldPct) !== 100 ? html`<li class="pl-row"><span>${t('stock.yield')}</span><b>${pct(i.yieldPct)}</b></li>` : ''}
        ${(i.conversions || []).map((c) => html`<li class="pl-row"><span>${t('stock.otherUnits')}</span><b>${c.factor > 0 && c.factor < 1
          ? `1 ${unitLabel(i.unit)} = ${number(1 / c.factor, 4)} ${unitLabel(c.unit)}`
          : `1 ${unitLabel(c.unit)} = ${number(c.factor, 4)} ${unitLabel(i.unit)}`}</b></li>`)}
      </ul>
      ${isPrep ? prepCostCard(i) : ''}
      <div style="margin-bottom:16px">${actionTiles(isPrep ? ['usage', 'waste', 'count'] : ['purchase', 'usage', 'waste', 'count'])}</div>
      ${showHistory ? html`<div class="section-head"><h2 style="font-size:15px">${t('stock.costHistory')}</h2></div>
        <div class="card" id="cost-history" style="margin-bottom:16px"><div class="skeleton" style="height:96px"></div></div>` : ''}
      <div class="section-head"><h2 style="font-size:15px">${t('stock.last30')}</h2></div>
      <div class="card" id="item-history"><div class="skeleton" style="height:120px"></div></div>`,
    foot: isPrep || ctx.can('manager') ? html`
      ${ctx.can('manager') ? html`<button class="btn" data-edit>${icon('edit')}${isPrep ? t('stock.editShort') : t('stock.editIngredient')}</button>` : ''}
      ${isPrep ? html`<button class="btn" data-open-sop>${icon('clipboard')}${t('sop.short')}</button>` : ''}
      ${isPrep ? html`<button class="btn primary" data-act="produce">${icon('chef')}${t('stock.produceShort')}</button>` : ''}` : null,
    onMount(el, close) {
      $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => { close(); openEntry(ctx, b.dataset.act, i.id); }));
      const ed = el.querySelector('[data-edit]');
      if (ed) ed.addEventListener('click', () => { close(); ingredientSheet(ctx, i); });
      const so = el.querySelector('[data-open-sop]');
      if (so) so.addEventListener('click', () => { close(); sopSheet(ctx, i.id); });
    },
  });
  if (showHistory) loadCostHistory(sheet.el.querySelector('#cost-history'), i);
  try {
    const from = addDaysLocal(today(), -30);
    const [p, m] = await Promise.all([
      call('purchases.list', { from, ingredientId: id, limit: 50 }),
      call('movements.list', { from, ingredientId: id, includeSales: true, limit: 200 }),
    ]);
    // Collapse per-sale deductions into one line per day to keep it readable.
    const sold = {};
    const rest = [];
    m.forEach((x) => {
      if (x.type === 'sale' && !x.voided) {
        const s = (sold[x.date] ||= { ...x, id: 'sold-' + x.date, qty: 0, value: 0, reason: t('stock.fromSales') });
        s.qty += x.qty; s.value += x.value;
      } else if (x.type !== 'sale') rest.push(x);
    });
    const entries = [...p.map((x) => ({ ...x, type: 'purchase', kind: 'purchase', value: x.total })), ...rest, ...Object.values(sold)]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 40);
    const host = sheet.el.querySelector('#item-history');
    if (host) mount(host, entries.length ? html`<ul class="list">${entries.map((e) => html`<li class="row ${e.voided ? 'voided' : ''}" style="min-height:52px">
        <span class="grow"><div class="title" style="font-weight:600">${typeLabel(e.type)}${e.reason ? html` <span class="muted" style="font-weight:400">· ${e.reason}</span>` : ''}</div>
        <div class="sub">${relDay(e.date)}</div></span>
        <span class="value">${e.qty > 0 ? '+' : ''}${qty(Math.round(e.qty * 1000) / 1000, unitLabel(i.unit))}</span></li>`)}</ul>`
      : emptyState('clipboard', t('stock.noItemActivityTitle'), t('stock.noItemActivityText')));
  } catch (e) { toast(e.message, 'bad'); }
}

/** Prep: recipe (theoretical) cost against what recent batches really cost. */
function prepCostCard(i) {
  const u = unitLabel(i.unit);
  const v = i.costVariancePct;
  const flagged = v !== null && v !== undefined && Math.abs(v) > 10;
  return html`<div class="section-head"><h2 style="font-size:15px">${t('stock.prepCostTitle')}</h2></div>
    <ul class="list card" style="margin-bottom:6px">
      <li class="pl-row"><span>${t('production.recipeCost')}</span><b>${unitMoney(i.costPerUnit)} / ${u}</b></li>
      <li class="pl-row"><span>${t('stock.actualCost')}</span><b>${i.actualUnitCost === null || i.actualUnitCost === undefined ? html`<span class="muted" style="font-weight:500">${t('stock.noRunsYet')}</span>` : `${unitMoney(i.actualUnitCost)} / ${u}`}</b></li>
      ${v === null || v === undefined ? '' : html`<li class="pl-row" style="align-items:center"><span>${t('stock.variance')}</span>
        <span class="pill ${flagged ? 'warn' : 'good'}">${icon(flagged ? 'alert' : 'check')}${v > 0 ? '+' : v < 0 ? '−' : ''}${pct(Math.abs(v))}</span></li>`}
    </ul>
    <p class="small muted" style="margin:0 2px 14px">${flagged ? (v > 0 ? t('stock.varianceHigh') : t('stock.varianceLow')) : t('stock.varianceHelp')}</p>`;
}

const SOURCE_LABEL = { purchase: 'stock.sourcePurchase', prep: 'stock.sourcePrep', manual: 'stock.sourceManual' };

/** Manager+: cost changes of one item, a sparkline of the cost over time and the last 10 changes. */
async function loadCostHistory(host, i) {
  if (!host) return;
  let rows;
  try { rows = await call('ingredients.costHistory', { id: i.id, limit: 30 }); } catch (e) {
    mount(host, html`<div style="padding:14px 16px" class="small muted">${e.message}</div>`);
    return;
  }
  if (!host.isConnected) return;
  if (!rows.length) {
    mount(host, emptyState('chart', t('stock.noCostChangesTitle'), t('stock.noCostChangesText')));
    return;
  }
  const u = unitLabel(i.unit);
  const points = rows.slice().reverse().map((r) => r.newCost);
  mount(host, html`
    ${points.length > 1 ? html`<div style="padding:14px 16px 6px">${sparkline(points, { width: 300, height: 48, format: unitMoney })}
      ${rows[rows.length - 1].date !== rows[0].date ? html`<div class="small muted" style="display:flex;justify-content:space-between;margin-top:4px"><span>${relDay(rows[rows.length - 1].date)}</span><span>${relDay(rows[0].date)}</span></div>` : ''}</div>` : ''}
    <ul class="list">${rows.slice(0, 10).map((r) => html`<li class="row" style="min-height:52px">
      <span class="grow"><div class="title" style="font-weight:600">${unitMoney(r.oldCost)} → ${unitMoney(r.newCost)} <span class="muted small" style="font-weight:400">/ ${u}</span></div>
        <div class="sub">${relDay(r.date)} · ${SOURCE_LABEL[r.source] ? t(SOURCE_LABEL[r.source]) : r.source}</div></span>
      <span class="value">${r.changePct === null ? '—' : html`<span class="${r.changePct > 0 ? 'change-up' : 'change-down'}">${r.changePct > 0 ? '+' : r.changePct < 0 ? '−' : ''}${pct(Math.abs(r.changePct))}</span>`}</span></li>`)}</ul>`);
}

/* ----------------------------------------------------- entry forms */

function ingredientOptions(ingredients, selected) {
  const groups = {};
  ingredients.filter((i) => i.active).forEach((i) => (groups[i.category || t('common.other')] ||= []).push(i));
  return html`<option value="">${t('stock.chooseIngredient')}</option>${Object.keys(groups).sort().map((g) => html`<optgroup label="${g}">
    ${groups[g].map((i) => html`<option value="${i.id}" ${i.id === selected ? raw('selected') : ''}>${i.name} (${unitLabel(i.unit)})</option>`)}</optgroup>`)}`;
}

/** Open a stock entry form. opts (stock in / usage / waste / count): { date, initialIds: [ingredientId], onSaved } */
export function openEntry(ctx, type, ingredientId, opts = {}) {
  if (type === 'purchase') return purchaseSheet(ctx, ingredientId);
  if (type === 'produce') return produceSheet({ ...ctx, redraw: () => redraw(ctx) }, ingredientId);
  if (type === 'adjustment' && !ctx.can('manager')) return toast(t('stock.adjustManagerOnly'), 'bad');
  return movementSheet(ctx, type, ingredientId, opts);
}

function lineEditor(host, { ingredients, fields, initial }) {
  // fields: (ing) => html for the inputs under the ingredient select
  let n = 0;
  // Recently used items: one tap fills the first empty line (or adds a line).
  const recent = recentIds('ingredients').map((id) => ingredients.find((i) => i.id === id && i.active)).filter(Boolean).slice(0, 6);
  if (recent.length) {
    const bar = document.createElement('div');
    mount(bar, html`<div class="small muted" style="margin:0 2px 6px">${t('stock.recent')}</div>
      <div class="chips" role="group" aria-label="${t('stock.recent')}">${recent.map((i) => html`<button type="button" class="chip" data-recent="${i.id}">${i.name}</button>`)}</div>`);
    host.before(bar);
    bar.querySelectorAll('[data-recent]').forEach((b) => b.addEventListener('click', () => {
      const empty = $$('.line-item', host).find((w) => !w.querySelector('select').value);
      const w = empty || add();
      const f = w.querySelector('[data-find]');
      if (f && f.value) { f.value = ''; f.dispatchEvent(new Event('input')); }
      const sel = w.querySelector('select');
      sel.value = b.dataset.recent;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const q = w.querySelector('input[name=qty]');
      if (q) q.focus();
    }));
  }
  const add = (ingredientId = '') => {
    const idx = n++;
    const wrap = document.createElement('div');
    wrap.className = 'line-item';
    wrap.dataset.line = idx;
    const ing = ingredients.find((i) => i.id === ingredientId);
    mount(wrap, html`<div class="line-head"><span>${t('stock.item')}</span>
      <button type="button" class="btn ghost sm" data-remove aria-label="${t('stock.removeItem')}">${icon('x')}</button></div>
      <div class="search" style="margin:0 0 6px">${icon('search')}<input class="input" type="search" data-find placeholder="${t('stock.findIngredient')}" aria-label="${t('stock.findIngredient')}"></div>
      <select class="select" name="ingredientId" aria-label="${t('stock.ingredient')}">${ingredientOptions(ingredients, ingredientId)}</select>
      <div class="form-row" style="margin-top:8px">${fields(ing)}</div>`);
    host.append(wrap);
    wrap.querySelector('[data-remove]').addEventListener('click', () => {
      if (host.querySelectorAll('.line-item').length > 1) wrap.remove();
      else wrap.querySelectorAll('input, select').forEach((x) => { x.value = ''; });
      host.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Type part of a name or category to narrow the list; a single match is picked straight away.
    // iOS ignores hidden options, so the list is rebuilt from a copy of the full one.
    const fullList = wrap.querySelector('select').cloneNode(true);
    wrap.querySelector('[data-find]').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const sel = wrap.querySelector('select');
      const current = sel.value;
      const matches = (o) => {
        if (!o.value) return false;
        const ing2 = ingredients.find((i) => i.id === o.value);
        return !q || (!!ing2 && (ing2.name + ' ' + (ing2.category || '')).toLowerCase().includes(q));
      };
      const keep = (o) => !o.value || o.value === current || matches(o);
      const visible = [];
      const take = (o, into) => { const c = o.cloneNode(true); into.push(c); if (matches(o)) visible.push(c); };
      const kids = [];
      [...fullList.children].forEach((node) => {
        if (node.tagName === 'OPTGROUP') {
          const g = node.cloneNode(false);
          const opts = [];
          [...node.children].forEach((o) => { if (keep(o)) take(o, opts); });
          if (opts.length) { g.append(...opts); kids.push(g); }
        } else if (keep(node)) take(node, kids);
      });
      sel.replaceChildren(...kids);
      sel.value = current;
      if (q && visible.length === 1 && sel.value !== visible[0].value) {
        sel.value = visible[0].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    wrap.querySelector('select').addEventListener('change', (e) => {
      const ing2 = ingredients.find((i) => i.id === e.target.value);
      wrap.querySelectorAll('[data-unit]').forEach((u) => { u.textContent = ing2 ? unitLabel(ing2.unit) : t('stock.unit'); });
      wrap.dispatchEvent(new CustomEvent('ingredient', { detail: ing2, bubbles: true }));
    });
    return wrap;
  };
  add(initial);
  return {
    add,
    values: () => $$('.line-item', host).map((w) => {
      const o = {};
      w.querySelectorAll('[name]').forEach((x) => { o[x.name] = x.value; });
      return o;
    }).filter((l) => l.ingredientId || l.qty),
  };
}

function purchaseSheet(ctx, ingredientId) {
  const boot = ctx.state.boot;
  const ings = boot.ingredients;
  const preset = ings.find((i) => i.id === ingredientId);
  openSheet({
    title: t('stock.purchaseTitle'),
    body: html`<form id="f" novalidate>
      <div class="form-row">
        <label class="field"><span class="label">${t('common.date')}</span><input class="input" type="date" name="date" value="${today()}" max="${today()}"></label>
        <label class="field"><span class="label">${t('stock.invoiceNo')}</span><input class="input" name="invoiceRef" maxlength="60" placeholder="${t('common.optional')}"></label>
      </div>
      <label class="field"><span class="label">${t('stock.supplier')}</span>
        <select class="select" name="supplierId">${options(boot.suppliers.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name })), preset?.supplierId, { placeholder: t('stock.usualSupplierOption') })}</select></label>
      <div id="lines"></div>
      <button type="button" class="btn sm" id="add-line">${icon('plus')}${t('stock.addItem')}</button>
      <label class="field" style="margin-top:14px"><span class="label">${t('common.note')}</span><input class="input" name="note" maxlength="200" placeholder="${t('common.optional')}"></label>
    </form>`,
    foot: html`<div class="grow" style="align-self:center"><div class="small muted">${t('common.total')}</div><b class="tabular" id="total" style="font-size:18px">${money(0)}</b></div>
      <button class="btn primary" id="save">${t('stock.savePurchase')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      const host = el.querySelector('#lines');
      const editor = lineEditor(host, {
        ingredients: ings, initial: ingredientId,
        fields: (ing) => html`
          <label><span class="label small muted">${t('stock.quantity')}</span><div class="input-group"><input class="input" name="qty" type="number" inputmode="decimal" min="0" step="any" placeholder="0">
            <span class="addon" data-unit>${ing ? unitLabel(ing.unit) : t('stock.unit')}</span></div></label>
          <label><span class="label small muted">${t('stock.costPerUnit')}</span><input class="input" name="unitCost" type="number" inputmode="decimal" min="0" step="any" value="${ing ? Math.round(ing.costPerUnit * 100) / 100 : ''}"></label>`,
      });
      const recalc = () => {
        const total = editor.values().reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);
        el.querySelector('#total').textContent = money(total);
      };
      host.addEventListener('input', recalc);
      host.addEventListener('ingredient', (e) => {
        const cost = e.target.querySelector('[name=unitCost]');
        if (e.detail && cost) cost.value = Math.round(e.detail.costPerUnit * 100) / 100;
        recalc();
      });
      el.querySelector('#add-line').addEventListener('click', () => editor.add().querySelector('select').focus());
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const lines = editor.values();
        const r = await call('purchases.add', {
          date: form.date.value, supplierId: form.supplierId.value, invoiceRef: form.invoiceRef.value, note: form.note.value, lines,
        });
        pushRecent('ingredients', lines.map((l) => l.ingredientId));
        close();
        toast(t('stock.purchaseSaved', { n: r.count, total: money(r.total) }));
        impactToast(ctx, r.impact);
        await ctx.refresh();
        redraw(ctx);
      }, form));
    },
  });
}

function movementSheet(ctx, type, ingredientId, opts = {}) {
  const ings = ctx.state.boot.ingredients;
  openSheet({
    title: t(`stock.title.${type}`),
    body: html`<form id="f" novalidate>
      <p class="small muted" style="margin:0 2px 14px">${t(`stock.help.${type}`)}</p>
      <label class="field"><span class="label">${t('common.date')}</span><input class="input" type="date" name="date" value="${opts.date || today()}" max="${today()}"></label>
      <div id="lines"></div>
      <button type="button" class="btn sm" id="add-line">${icon('plus')}${t('stock.addItem')}</button>
      ${type === 'waste' ? html`<div class="field" style="margin-top:16px"><span class="label">${t('stock.reason')}</span>
        <div class="chips" style="flex-wrap:wrap;margin:0;padding:0">${WASTE_REASONS.map((r) => html`<button type="button" class="chip" data-reason="${t(r)}" aria-pressed="false">${t(r)}</button>`)}</div></div>` : ''}
      <label class="field" style="margin-top:${type === 'waste' ? '0' : '16px'}"><span class="label">${type === 'waste' ? t('stock.details') : t('common.note')}</span>
        <input class="input" name="reason" maxlength="200" placeholder="${type === 'waste' ? t('stock.reasonPlaceholder') : t('common.optional')}"></label>
    </form>`,
    foot: html`<button class="btn primary block" id="save">${t('common.save')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      const host = el.querySelector('#lines');
      const editor = lineEditor(host, {
        ingredients: ings, initial: ingredientId || (opts.initialIds || [])[0],
        fields: (ing) => html`<label style="grid-column:1/-1"><span class="label small muted">${t(`stock.qtyLabel.${type}`)}</span>
          <div class="input-group"><input class="input" name="qty" type="number" inputmode="decimal" step="any" ${type === 'adjustment' ? '' : raw('min="0"')} placeholder="0">
          <span class="addon" data-unit>${ing ? unitLabel(ing.unit) : t('stock.unit')}</span></div>
          ${type === 'count' ? html`<span class="hint small muted" data-onhand>${ing ? t('stock.systemSays', { qty: qty(ing.onHand, unitLabel(ing.unit)) }) : ''}</span>` : ''}</label>`,
      });
      (opts.initialIds || []).slice(1).forEach((id) => editor.add(id));
      host.addEventListener('ingredient', (e) => {
        const h = e.target.querySelector('[data-onhand]');
        if (h) h.textContent = e.detail ? t('stock.systemSays', { qty: qty(e.detail.onHand, unitLabel(e.detail.unit)) }) : '';
      });
      $$('[data-reason]', el).forEach((c) => c.addEventListener('click', () => {
        $$('[data-reason]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
        form.reason.value = c.dataset.reason;
      }));
      el.querySelector('#add-line').addEventListener('click', () => editor.add().querySelector('select').focus());
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const lines = editor.values().filter((l) => type !== 'count' || String(l.qty ?? '').trim() !== '');
        const r = await call('movements.add', { date: form.date.value, type, reason: form.reason.value, lines });
        pushRecent('ingredients', lines.map((l) => l.ingredientId));
        close();
        if (type === 'count' && !r.count) toast(t('stock.countMatches'));
        else toast(t(`stock.saved.${type}`) + (r.value ? ' · ' + money(Math.abs(r.value)) : ''));
        await ctx.refresh();
        if (opts.onSaved) opts.onSaved(); else redraw(ctx);
      }, form));
    },
  });
}

/* ------------------------------------------------------ ingredient edit */

const roundSig = (n) => Number(Number(n).toPrecision(6));

/** Text typed in a unit box → value to save: a known code (also from its localized label), else the text. */
function parseUnit(text) {
  const v = String(text || '').trim();
  if (!v) return '';
  const C = window.RestoCosting;
  if (C.unitCode(v)) return v;
  const code = Object.keys(C.UNITS).find((c) => unitLabel(c).toLowerCase() === v.toLowerCase());
  return code || v;
}

/**
 * Add / edit an ingredient or a prep (made in-house from a recipe).
 * preset: { kind: 'prep' } opens a new item as a prep (Menu → Preps).
 */
export function ingredientSheet(ctx, item, preset = {}) {
  const boot = ctx.state.boot;
  const s = boot.settings;
  const C = window.RestoCosting;
  const cats = [...new Set([...list(s.ingredientCategories), ...boot.ingredients.map((i) => i.category).filter(Boolean)])];
  const units = [...new Set([...list(s.units), ...(item ? [item.unit] : [])])];
  const isNew = !item;
  item = item || { active: true, kind: preset.kind === 'prep' ? 'prep' : 'raw', yieldPct: 100, trackStock: true, conversions: [], prepLines: [] };
  let kind = item.kind === 'prep' ? 'prep' : 'raw';
  const unitChoices = [...new Set([...Object.keys(C.UNITS).map((c) => unitLabel(c)), ...list(s.units)])];
  const yieldVal = item.yieldPct === undefined || Number(item.yieldPct) === 100 ? '' : item.yieldPct;
  // A factor below 1 reads better the other way round: "1 pcs = 55 g" rather than "1 g = 0.018 pcs".
  const convHtml = (c = {}) => {
    const flip = Number(c.factor) > 0 && Number(c.factor) < 1;
    const shown = c.factor === undefined ? '' : flip ? roundSig(1 / Number(c.factor)) : c.factor;
    return html`<div class="line-item" data-conv data-flipped="${flip}">
    <div class="rl-head">
      <input class="input" data-f="unit" list="unit-choices" maxlength="20" value="${c.unit ? unitLabel(c.unit) : ''}" placeholder="${t('stock.unitPlaceholder')}" aria-label="${t('stock.unitName')}">
      <button type="button" class="icon-btn" data-flip aria-label="${t('stock.flipUnits')}" title="${t('stock.flipUnits')}">${icon('swap')}</button>
      <button type="button" class="icon-btn" data-remove aria-label="${t('stock.removeUnit')}">${icon('x')}</button>
    </div>
    <div class="unit-eq"><span data-left></span><span aria-hidden="true">=</span>
      <input class="input" data-f="factor" type="number" inputmode="decimal" min="0" step="any" value="${shown}" placeholder="0" aria-label="${t('stock.conversion')}">
      <span data-right></span></div>
  </div>`;
  };

  openSheet({
    title: isNew ? (kind === 'prep' ? t('menu.newPrep') : t('stock.newIngredient')) : t('stock.editIngredient'),
    body: html`<form id="f" novalidate>
      <div class="seg" role="group" aria-label="${t('stock.kind')}">
        <button type="button" data-kind="raw" aria-pressed="${kind === 'raw'}">${t('stock.kindRaw')}</button>
        <button type="button" data-kind="prep" aria-pressed="${kind === 'prep'}">${t('stock.kindPrep')}</button>
      </div>
      <div class="form-row name-code">
        <label class="field"><span class="label">${t('common.name')}</span><input class="input" name="name" value="${item.name || ''}" maxlength="80" required></label>
        <label class="field"><span class="label">${t('stock.code')}</span><input class="input" name="code" value="${item.code || ''}" maxlength="30" placeholder="${t('common.optional')}" autocapitalize="characters"></label>
      </div>
      <div class="form-row">
        <label class="field"><span class="label">${t('stock.unit')}</span><select class="select" name="unit">${options(units.map((u) => ({ value: u, label: u })), item.unit || units[0])}</select></label>
        <label class="field"><span class="label">${t('common.category')}</span><select class="select" name="category">${options(cats, item.category, { placeholder: t('common.none') })}</select></label>
      </div>
      <div class="form-row">
        <label class="field" data-only="raw"><span class="label">${t('stock.costPerUnit')}</span><input class="input" name="costPerUnit" type="number" inputmode="decimal" min="0" step="any" value="${item.kind === 'prep' ? '' : item.costPerUnit ?? ''}" required></label>
        <label class="field" data-only="prep"><span class="label">${t('stock.batchQty')}</span>
          <div class="input-group"><input class="input" name="batchQty" type="number" inputmode="decimal" min="0" step="any" value="${item.batchQty || ''}" placeholder="0"><span class="addon" data-stock-unit></span></div></label>
        <label class="field"><span class="label">${t('stock.minLevel')}</span><input class="input" name="minLevel" type="number" inputmode="decimal" min="0" step="any" value="${item.minLevel ?? ''}" required></label>
      </div>
      <label class="field"><span class="label">${t('stock.parLevel')}</span><input class="input" name="parLevel" type="number" inputmode="decimal" min="0" step="any" value="${item.parLevel || ''}" placeholder="${item.minLevel ? number(item.minLevel * 2, 3) : ''}"></label>
      <p class="small muted" style="margin:-6px 2px 14px">${t('stock.minHelp')} ${t('stock.parHelp')}</p>
      <label class="field" data-only="raw"><span class="label">${t('stock.usualSupplier')}</span>
        <select class="select" name="supplierId">${options(boot.suppliers.filter((x) => x.active || x.id === item.supplierId).map((x) => ({ value: x.id, label: x.name })), item.supplierId, { placeholder: t('common.none') })}</select></label>

      <div data-only="prep">
        <div class="section-head" style="margin-top:6px"><h2 style="font-size:15px">${t('stock.prepRecipe')}</h2></div>
        <p class="small muted" style="margin:-4px 2px 10px">${t('stock.prepRecipeHelp')}</p>
        <div id="prep-lines"></div>
        <button type="button" class="btn sm" id="add-prep-line">${icon('plus')}${t('menu.addIngredient')}</button>
        <div class="card" style="margin-top:14px">
          <div class="pl-row"><span>${t('recipe.batchCost')}</span><b class="tabular" id="batch-cost">—</b></div>
          <div class="pl-row"><span id="cpu-label"></span><b class="tabular" id="cpu">—</b></div>
          <div class="pl-row hidden" id="cost-problem"></div>
        </div>
        <p class="small muted" style="margin:8px 2px 14px">${t('stock.prepCostNote')}</p>
        <label class="check"><input type="checkbox" name="trackStock" ${item.trackStock === false ? '' : raw('checked')}> ${t('stock.trackStock')}</label>
        <p class="small muted" style="margin:0 2px 14px">${t('recipe.trackStockHelp')}</p>
        <label class="field"><span class="label">${t('stock.shelfLife')}</span><input class="input" name="shelfLifeDays" type="number" inputmode="numeric" min="0" step="1" value="${item.shelfLifeDays ?? ''}" placeholder="${t('common.optional')}"></label>
      </div>

      <div class="field">
        <label class="label" for="yield-in">${t('stock.yield')}</label>
        <div style="display:flex;gap:10px;align-items:center">
          <div class="input-group grow"><input class="input" id="yield-in" name="yieldPct" type="number" inputmode="decimal" min="1" max="1000" step="any" value="${yieldVal}" placeholder="100"><span class="addon">%</span></div>
          <button type="button" class="link-btn" id="yield-calc" aria-expanded="false" aria-controls="ycalc">${icon('scale')}${t('stock.yieldCalc')}</button>
        </div>
        <span class="hint">${t('stock.yieldHelp')}</span>
      </div>
      <div class="line-item hidden" id="ycalc" style="margin-top:-4px">
        <p class="small muted" style="margin:0 0 8px">${t('stock.yieldCalcHelp')}</p>
        <div class="form-row">
          <label><span class="label small muted">${t('stock.bought')}</span><div class="input-group"><input class="input" id="y-bought" type="number" inputmode="decimal" min="0" step="any" placeholder="10"><span class="addon" data-stock-unit></span></div></label>
          <label><span class="label small muted">${t('stock.usable')}</span><div class="input-group"><input class="input" id="y-usable" type="number" inputmode="decimal" min="0" step="any" placeholder="7.2"><span class="addon" data-stock-unit></span></div></label>
        </div>
        <div class="small" id="y-result" style="margin-top:8px;min-height:20px" aria-live="polite"></div>
      </div>

      <div class="field"><span class="label" id="al-l">${t('sop.allergens')}</span>
        <div class="chips" role="group" aria-labelledby="al-l" style="flex-wrap:wrap">${window.RestoCosting.ALLERGENS.map((a) =>
          html`<button type="button" class="chip" data-allergen="${a}" aria-pressed="${(item.allergens || []).includes(a)}">${t(`allergen.${a}`)}</button>`)}</div>
        <span class="hint">${t('sop.allergenPick')}${item.kind === 'prep' && (item.allergensAll || []).length
          ? ' ' + t('sop.allergenFromRecipe', { list: item.allergensAll.map((a) => t(`allergen.${a}`)).join(', ') }) : ''}</span></div>
      <div class="section-head" style="margin-top:10px"><h2 style="font-size:15px">${t('stock.otherUnits')}</h2></div>
      <p class="small muted" style="margin:-4px 2px 10px">${t('stock.otherUnitsHelp')}</p>
      <div id="convs">${(item.conversions || []).map((c) => convHtml(c))}</div>
      <datalist id="unit-choices">${unitChoices.map((u) => html`<option value="${u}"></option>`)}</datalist>
      <button type="button" class="btn sm" id="add-conv">${icon('plus')}${t('stock.addUnit')}</button>
      ${isNew ? '' : html`<label class="check" style="margin-top:12px"><input type="checkbox" name="active" ${item.active ? raw('checked') : ''}> ${t('stock.activeCheck')}</label>`}
    </form>`,
    foot: html`<button class="btn primary block" id="save">${isNew ? (kind === 'prep' ? t('stock.addPrep') : t('stock.addIngredient')) : t('common.saveChanges')}</button>`,
    onMount(el, close) {
      $$('[data-allergen]', el).forEach((b) => b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'))));
      const form = el.querySelector('#f');
      const stockUnit = () => unitLabel(form.unit.value);
      let totals = { cost: 0, lines: [], problem: '' };

      const showKind = () => {
        $$('[data-kind]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
        $$('[data-only]', el).forEach((x) => x.classList.toggle('hidden', x.dataset.only !== kind));
        if (isNew) el.querySelector('#save').textContent = kind === 'prep' ? t('stock.addPrep') : t('stock.addIngredient');
      };
      const prepSummary = () => {
        const batch = Number(form.batchQty.value);
        const problem = el.querySelector('#cost-problem');
        el.querySelector('#cpu-label').textContent = t('recipe.costPerUnit', { unit: stockUnit() });
        problem.classList.toggle('hidden', !totals.problem);
        if (totals.problem) {
          mount(problem, html`<span class="warn-text small">${icon('alert')}${t(totals.problem === 'depth' ? 'recipe.depth' : 'recipe.cycle')}</span>`);
          el.querySelector('#batch-cost').textContent = '—';
          el.querySelector('#cpu').textContent = '—';
          return;
        }
        el.querySelector('#batch-cost').textContent = money(totals.cost);
        if (batch > 0) el.querySelector('#cpu').textContent = unitMoney(totals.cost / batch);
        else mount(el.querySelector('#cpu'), html`<span class="muted small" style="font-weight:500">${t('recipe.needBatch')}</span>`);
      };
      const drawConv = (w) => {
        const u = w.querySelector('[data-f=unit]').value.trim() || '…';
        const flipped = w.dataset.flipped === 'true';
        w.querySelector('[data-left]').textContent = `1 ${flipped ? stockUnit() : u}`;
        w.querySelector('[data-right]').textContent = flipped ? u : stockUnit();
      };
      const syncUnits = () => {
        $$('[data-stock-unit]', el).forEach((x) => { x.textContent = stockUnit(); });
        $$('[data-conv]', el).forEach(drawConv);
        prepSummary();
      };
      const wireConv = (w) => {
        w.querySelector('[data-remove]').addEventListener('click', () => w.remove());
        w.querySelector('[data-flip]').addEventListener('click', () => {
          const f = w.querySelector('[data-f=factor]');
          const x = Number(f.value);
          if (x > 0) f.value = roundSig(1 / x);
          w.dataset.flipped = String(w.dataset.flipped !== 'true');
          drawConv(w);
        });
        w.querySelector('[data-f=unit]').addEventListener('input', () => drawConv(w));
      };

      const editor = recipeLines(el.querySelector('#prep-lines'), {
        ingredients: boot.ingredients, lines: item.prepLines || [], excludeId: item.id || '', isPrep: true,
        onChange: (x) => { totals = x; prepSummary(); },
      });
      $$('[data-kind]', el).forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; showKind(); }));
      el.querySelector('#add-prep-line').addEventListener('click', () => editor.add().querySelector('select').focus());
      form.batchQty.addEventListener('input', prepSummary);
      form.unit.addEventListener('change', syncUnits);
      $$('[data-conv]', el).forEach(wireConv);
      el.querySelector('#add-conv').addEventListener('click', () => {
        const tmp = document.createElement('div');
        mount(tmp, convHtml());
        const w = tmp.firstElementChild;
        el.querySelector('#convs').append(w);
        wireConv(w);
        drawConv(w);
        w.querySelector('input').focus();
      });

      // Yield calculator: bought and usable weight → yield %, filled into the field.
      const calc = el.querySelector('#ycalc');
      el.querySelector('#yield-calc').addEventListener('click', (e) => {
        const open = calc.classList.toggle('hidden') === false;
        e.currentTarget.setAttribute('aria-expanded', String(open));
        if (open) el.querySelector('#y-bought').focus();
      });
      const yieldCalc = () => {
        const b = Number(el.querySelector('#y-bought').value);
        const u = Number(el.querySelector('#y-usable').value);
        const out = el.querySelector('#y-result');
        if (!(b > 0) || !(u > 0)) { out.textContent = ''; return; }
        const p = Math.round(u / b * 1000) / 10;
        if (p < 1 || p > 1000) { mount(out, html`<span class="warn-text">${icon('alert')}${t('stock.yieldResult', { pct: pct(p) })}</span>`); return; }
        form.yieldPct.value = p;
        mount(out, html`<span class="pill ${p < 100 ? 'warn' : 'good'}">${t('stock.yieldResult', { pct: pct(p) })}</span>`);
      };
      el.querySelector('#y-bought').addEventListener('input', yieldCalc);
      el.querySelector('#y-usable').addEventListener('input', yieldCalc);

      showKind();
      syncUnits();

      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const f = form;
        const isPrep = kind === 'prep';
        const convs = $$('[data-conv]', el).map((w) => {
          const unit = parseUnit(w.querySelector('[data-f=unit]').value);
          const txt = w.querySelector('[data-f=factor]').value.trim();
          const x = Number(txt);
          const factor = txt === '' ? '' : w.dataset.flipped === 'true' ? (x > 0 ? 1 / x : x) : x;
          return { unit, factor };
        }).filter((c) => c.unit || c.factor !== '');
        const payload = {
          item: {
            id: item.id, version: item.version, name: f.name.value, code: f.code.value, unit: f.unit.value, category: f.category.value,
            costPerUnit: isPrep ? 0 : f.costPerUnit.value, minLevel: f.minLevel.value, parLevel: f.parLevel.value,
            supplierId: isPrep ? '' : f.supplierId.value, active: isNew ? true : f.active.checked,
            yieldPct: f.yieldPct.value.trim(), kind,
            batchQty: isPrep ? f.batchQty.value : '', trackStock: isPrep ? f.trackStock.checked : true,
            shelfLifeDays: isPrep ? f.shelfLifeDays.value : (item.shelfLifeDays ?? ''),
            allergens: $$('[data-allergen]', el).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.allergen),
          },
          units: convs,
          prepRecipe: isPrep ? editor.values() : [],
        };
        try {
          await call('ingredients.save', payload);
        } catch (err) {
          if (err.code === 'CONFLICT') { await ctx.refresh(); }
          throw err;
        }
        close();
        toast(isNew ? t('stock.ingredientAdded') : t('stock.ingredientSaved'));
        await ctx.refresh();
        redraw(ctx);
      }, form));
    },
  });
}

function addDaysLocal(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}
