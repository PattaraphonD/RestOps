// Stock: levels, low-stock alerts, purchases (stock in), usage, waste, counts, history.
import { call } from '../api.js';
import {
  html, raw, mount, icon, money, number, qty, today, relDay, timeOf, $, $$, openSheet, confirmSheet,
  toast, busy, options, emptyState, statusPill, initials,
} from '../ui.js';
import { list } from '../app.js';
import { t } from '../i18n.js';

const ui = { tab: 'levels', filter: 'all', search: '' };

const TYPE_META = {
  purchase: { icon: 'truck', cls: 'good' },
  usage: { icon: 'fork', cls: '' },
  waste: { icon: 'waste', cls: 'bad' },
  count: { icon: 'clipboard', cls: 'warn' },
  adjustment: { icon: 'sliders', cls: 'warn' },
  sale: { icon: 'receipt', cls: '' },
};
const typeLabel = (type) => t(`type.${type}`);
const WASTE_REASONS = ['stock.reasonSpoiled', 'stock.reasonExpired', 'stock.reasonDropped', 'stock.reasonOverprep', 'stock.reasonReturned'];

const actionTiles = () => ['purchase', 'usage', 'waste', 'count'].map((type) => html`<button class="action-tile" data-act="${type}">
  <span class="avatar brand">${icon(TYPE_META[type].icon)}</span>${type === 'count' ? t('stock.countShort') : typeLabel(type)}</button>`);

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
    <div class="actions-grid" style="margin-top:4px">${actionTiles()}</div>
    <div class="seg" role="group" aria-label="${t('stock.view')}" style="margin-top:18px">
      <button aria-pressed="${ui.tab === 'levels'}" data-tab="levels">${t('stock.levels')}</button>
      <button aria-pressed="${ui.tab === 'history'}" data-tab="history">${t('stock.history')}</button>
    </div>
    <div id="tab"></div>`);
  $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => openEntry(ctx, b.dataset.act)));
  $$('[data-tab]', el).forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(ctx); }));

  if (ui.tab === 'levels') renderLevels(ctx); else await renderHistory(ctx);

  if (['purchase', 'usage', 'waste', 'count', 'adjustment'].includes(action)) openEntry(ctx, action);
  if (action === 'item' && id) itemSheet(ctx, id);
}

/* ---------------------------------------------------------------- levels */

function renderLevels(ctx) {
  const { state } = ctx;
  const all = state.boot.ingredients.filter((i) => i.active);
  const attention = all.filter((i) => i.status !== 'ok');
  const cats = [...new Set(all.map((i) => i.category).filter(Boolean))].sort();
  const tab = $('#tab');
  mount(tab, html`
    <div class="search">${icon('search')}<input class="input" type="search" placeholder="${t('stock.search')}" value="${ui.search}" aria-label="${t('stock.search')}"></div>
    <div class="chips" role="group" aria-label="${t('common.filter')}">
      <button class="chip" data-f="all" aria-pressed="${ui.filter === 'all'}">${t('common.all')}<span class="count">${all.length}</span></button>
      <button class="chip" data-f="attention" aria-pressed="${ui.filter === 'attention'}">${t('stock.needsRestock')}<span class="count">${attention.length}</span></button>
      ${cats.map((c) => html`<button class="chip" data-f="cat:${c}" aria-pressed="${ui.filter === 'cat:' + c}">${c}</button>`)}
    </div>
    <div class="card" id="levels"></div>
    <p class="small muted" style="margin:10px 4px">${t('stock.valueNote', { amount: money(all.reduce((a, i) => a + Math.max(0, i.value), 0)) })}</p>`);
  const draw = () => {
    const q = ui.search.trim().toLowerCase();
    let rows = all;
    if (ui.filter === 'attention') rows = attention;
    else if (ui.filter.startsWith('cat:')) rows = rows.filter((i) => i.category === ui.filter.slice(4));
    if (q) rows = rows.filter((i) => i.name.toLowerCase().includes(q) || (i.supplierName || '').toLowerCase().includes(q));
    rows = rows.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    mount($('#levels'), rows.length ? html`<ul class="list">${rows.map((i) => html`<li>
      <button class="row" data-id="${i.id}">
        <span class="avatar ${i.status === 'out' ? 'bad' : i.status === 'low' ? 'warn' : ''}">${initials(i.name)}</span>
        <span class="grow"><div class="title">${i.name}</div>
          <div class="sub">${t('stock.minShort', { qty: qty(i.minLevel, i.unit) })} · ${i.onOrder ? t('stock.onOrderShort', { qty: qty(i.onOrder, i.unit) }) : `${money(i.costPerUnit)}/${i.unit}`}</div></span>
        <span class="value"><div>${qty(i.onHand, i.unit)}</div><div>${statusPill(i.status)}</div></span>
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
    <span class="value"><div>${sign}${qty(e.qty, e.unit)}</div><div class="sub">${money(Math.abs(e.value))}</div></span>
  </button></li>`;
}

function entrySheet(ctx, e) {
  const canVoid = ctx.can('manager') && !e.voided && e.type !== 'sale';
  const row = (label, value) => html`<li class="pl-row"><span>${label}</span><b style="text-align:right">${value}</b></li>`;
  openSheet({
    title: typeLabel(e.type),
    body: html`<ul class="list">
      ${row(t('stock.ingredient'), e.ingredientName)}
      ${row(t('stock.quantity'), `${e.qty > 0 ? '+' : ''}${qty(e.qty, e.unit)}`)}
      ${e.kind === 'purchase' ? html`${row(t('stock.unitCost'), money(e.unitCost))}${row(t('stock.supplier'), e.supplierName || '—')}${row(t('stock.invoice'), e.invoiceRef || '—')}` : ''}
      ${row(t('stock.value'), money(Math.abs(e.value)))}
      ${row(t('common.date'), relDay(e.date))}
      ${row(t('common.enteredBy'), `${e.createdBy} · ${timeOf(e.createdAt)}`)}
      ${e.reason || e.note ? row(t('common.note'), e.reason || e.note) : ''}
      ${e.voided ? html`<li class="pl-row"><span>${t('common.status')}</span><span class="pill bad">${t('common.voidedCap')}</span></li>` : ''}
    </ul>
    ${e.type === 'sale' ? html`<p class="small muted">${t('stock.saleDeductNote')}</p>` : ''}`,
    foot: canVoid ? html`<button class="btn danger" data-void>${icon('trash')}${t('stock.voidEntry')}</button>` : null,
    onMount(el, close) {
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
          render(ctx);
        });
      });
    },
  });
}

/* ---------------------------------------------------------- item details */

async function itemSheet(ctx, id) {
  const i = ctx.state.boot.ingredients.find((x) => x.id === id);
  if (!i) return toast(t('stock.notFound'), 'bad');
  const sheet = openSheet({
    title: i.name,
    body: html`
      <div class="kpis" style="margin-bottom:14px">
        <div class="card kpi"><div class="label">${t('stock.onHand')}</div><div class="val">${qty(i.onHand, i.unit)}</div><div class="delta">${statusPill(i.status)}</div></div>
        <div class="card kpi"><div class="label">${t('stock.value')}</div><div class="val">${money(i.value)}</div><div class="delta">${money(i.costPerUnit)} / ${i.unit}</div></div>
      </div>
      <ul class="list card" style="margin-bottom:14px">
        <li class="pl-row"><span>${t('stock.minLevel')}</span><b>${qty(i.minLevel, i.unit)}</b></li>
        ${i.parLevel ? html`<li class="pl-row"><span>${t('stock.parLevel')}</span><b>${qty(i.parLevel, i.unit)}</b></li>` : ''}
        ${i.onOrder ? html`<li class="pl-row"><span>${t('stock.onOrder')}</span><b>${qty(i.onOrder, i.unit)}</b></li>` : ''}
        <li class="pl-row"><span>${t('common.category')}</span><b>${i.category || '—'}</b></li>
        <li class="pl-row"><span>${t('stock.supplier')}</span><b>${i.supplierName || '—'}</b></li>
      </ul>
      <div class="actions-grid" style="margin-bottom:16px">${actionTiles()}</div>
      <div class="section-head"><h2 style="font-size:15px">${t('stock.last30')}</h2></div>
      <div class="card" id="item-history"><div class="skeleton" style="height:120px"></div></div>`,
    foot: ctx.can('manager') ? html`<button class="btn" data-edit>${icon('edit')}${t('stock.editIngredient')}</button>` : null,
    onMount(el, close) {
      $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => { close(); openEntry(ctx, b.dataset.act, i.id); }));
      const ed = el.querySelector('[data-edit]');
      if (ed) ed.addEventListener('click', () => { close(); ingredientSheet(ctx, i); });
    },
  });
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
        <span class="value">${e.qty > 0 ? '+' : ''}${qty(Math.round(e.qty * 1000) / 1000, i.unit)}</span></li>`)}</ul>`
      : emptyState('clipboard', t('stock.noItemActivityTitle'), t('stock.noItemActivityText')));
  } catch (e) { toast(e.message, 'bad'); }
}

/* ----------------------------------------------------- entry forms */

function ingredientOptions(ingredients, selected) {
  const groups = {};
  ingredients.filter((i) => i.active).forEach((i) => (groups[i.category || t('common.other')] ||= []).push(i));
  return html`<option value="">${t('stock.chooseIngredient')}</option>${Object.keys(groups).sort().map((g) => html`<optgroup label="${g}">
    ${groups[g].map((i) => html`<option value="${i.id}" ${i.id === selected ? raw('selected') : ''}>${i.name} (${i.unit})</option>`)}</optgroup>`)}`;
}

function openEntry(ctx, type, ingredientId) {
  if (type === 'purchase') return purchaseSheet(ctx, ingredientId);
  if (type === 'adjustment' && !ctx.can('manager')) return toast(t('stock.adjustManagerOnly'), 'bad');
  return movementSheet(ctx, type, ingredientId);
}

function lineEditor(host, { ingredients, fields, initial }) {
  // fields: (ing) => html for the inputs under the ingredient select
  let n = 0;
  const add = (ingredientId = '') => {
    const idx = n++;
    const wrap = document.createElement('div');
    wrap.className = 'line-item';
    wrap.dataset.line = idx;
    const ing = ingredients.find((i) => i.id === ingredientId);
    mount(wrap, html`<div class="line-head"><span>${t('stock.item')}</span>
      <button type="button" class="btn ghost sm" data-remove aria-label="${t('stock.removeItem')}">${icon('x')}</button></div>
      <select class="select" name="ingredientId" aria-label="${t('stock.ingredient')}">${ingredientOptions(ingredients, ingredientId)}</select>
      <div class="form-row" style="margin-top:8px">${fields(ing)}</div>`);
    host.append(wrap);
    wrap.querySelector('[data-remove]').addEventListener('click', () => {
      if (host.querySelectorAll('.line-item').length > 1) wrap.remove();
      else wrap.querySelectorAll('input, select').forEach((x) => { x.value = ''; });
      host.dispatchEvent(new Event('input', { bubbles: true }));
    });
    wrap.querySelector('select').addEventListener('change', (e) => {
      const ing2 = ingredients.find((i) => i.id === e.target.value);
      wrap.querySelectorAll('[data-unit]').forEach((u) => { u.textContent = ing2 ? ing2.unit : t('stock.unit'); });
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
            <span class="addon" data-unit>${ing ? ing.unit : t('stock.unit')}</span></div></label>
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
        close();
        toast(t('stock.purchaseSaved', { n: r.count, total: money(r.total) }));
        await ctx.refresh();
        render(ctx);
      }, form));
    },
  });
}

function movementSheet(ctx, type, ingredientId) {
  const ings = ctx.state.boot.ingredients;
  openSheet({
    title: t(`stock.title.${type}`),
    body: html`<form id="f" novalidate>
      <p class="small muted" style="margin:0 2px 14px">${t(`stock.help.${type}`)}</p>
      <label class="field"><span class="label">${t('common.date')}</span><input class="input" type="date" name="date" value="${today()}" max="${today()}"></label>
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
        ingredients: ings, initial: ingredientId,
        fields: (ing) => html`<label style="grid-column:1/-1"><span class="label small muted">${t(`stock.qtyLabel.${type}`)}</span>
          <div class="input-group"><input class="input" name="qty" type="number" inputmode="decimal" step="any" ${type === 'adjustment' ? '' : raw('min="0"')} placeholder="0">
          <span class="addon" data-unit>${ing ? ing.unit : t('stock.unit')}</span></div>
          ${type === 'count' ? html`<span class="hint small muted" data-onhand>${ing ? t('stock.systemSays', { qty: qty(ing.onHand, ing.unit) }) : ''}</span>` : ''}</label>`,
      });
      host.addEventListener('ingredient', (e) => {
        const h = e.target.querySelector('[data-onhand]');
        if (h) h.textContent = e.detail ? t('stock.systemSays', { qty: qty(e.detail.onHand, e.detail.unit) }) : '';
      });
      $$('[data-reason]', el).forEach((c) => c.addEventListener('click', () => {
        $$('[data-reason]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
        form.reason.value = c.dataset.reason;
      }));
      el.querySelector('#add-line').addEventListener('click', () => editor.add().querySelector('select').focus());
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const r = await call('movements.add', { date: form.date.value, type, reason: form.reason.value, lines: editor.values() });
        close();
        if (type === 'count' && !r.count) toast(t('stock.countMatches'));
        else toast(t(`stock.saved.${type}`) + (r.value ? ' · ' + money(Math.abs(r.value)) : ''));
        await ctx.refresh();
        render(ctx);
      }, form));
    },
  });
}

/* ------------------------------------------------------ ingredient edit */

function ingredientSheet(ctx, item) {
  const boot = ctx.state.boot;
  const s = boot.settings;
  const cats = [...new Set([...list(s.ingredientCategories), ...boot.ingredients.map((i) => i.category).filter(Boolean)])];
  const units = [...new Set([...list(s.units), ...(item ? [item.unit] : [])])];
  const isNew = !item;
  item = item || { active: true };
  openSheet({
    title: isNew ? t('stock.newIngredient') : t('stock.editIngredient'),
    body: html`<form id="f" novalidate>
      <label class="field"><span class="label">${t('common.name')}</span><input class="input" name="name" value="${item.name || ''}" maxlength="80" required></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('stock.unit')}</span><select class="select" name="unit">${options(units, item.unit || units[0])}</select></label>
        <label class="field"><span class="label">${t('common.category')}</span><select class="select" name="category">${options(cats, item.category, { placeholder: t('common.none') })}</select></label>
      </div>
      <div class="form-row">
        <label class="field"><span class="label">${t('stock.costPerUnit')}</span><input class="input" name="costPerUnit" type="number" inputmode="decimal" min="0" step="any" value="${item.costPerUnit ?? ''}" required></label>
        <label class="field"><span class="label">${t('stock.minLevel')}</span><input class="input" name="minLevel" type="number" inputmode="decimal" min="0" step="any" value="${item.minLevel ?? ''}" required></label>
      </div>
      <label class="field"><span class="label">${t('stock.parLevel')}</span><input class="input" name="parLevel" type="number" inputmode="decimal" min="0" step="any" value="${item.parLevel || ''}" placeholder="${item.minLevel ? number(item.minLevel * 2, 3) : ''}"></label>
      <p class="small muted" style="margin:-6px 2px 14px">${t('stock.minHelp')} ${t('stock.parHelp')}</p>
      <label class="field"><span class="label">${t('stock.usualSupplier')}</span>
        <select class="select" name="supplierId">${options(boot.suppliers.filter((x) => x.active || x.id === item.supplierId).map((x) => ({ value: x.id, label: x.name })), item.supplierId, { placeholder: t('common.none') })}</select></label>
      ${isNew ? '' : html`<label class="check"><input type="checkbox" name="active" ${item.active ? raw('checked') : ''}> ${t('stock.activeCheck')}</label>`}
    </form>`,
    foot: html`<button class="btn primary block" id="save">${isNew ? t('stock.addIngredient') : t('common.saveChanges')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = Object.fromEntries(new FormData(form));
        v.active = isNew ? true : form.active.checked;
        try {
          await call('ingredients.save', { item: { ...v, id: item.id, version: item.version } });
        } catch (err) {
          if (err.code === 'CONFLICT') { await ctx.refresh(); }
          throw err;
        }
        close();
        toast(isNew ? t('stock.ingredientAdded') : t('stock.ingredientSaved'));
        await ctx.refresh();
        render(ctx);
      }, form));
    },
  });
}

function addDaysLocal(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}
