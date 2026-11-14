// Menu hub: dishes (recipes, food cost, margin) and preps (sauces, stocks, pastes made in batches).
import { call } from '../api.js';
import {
  html, raw, mount, icon, money, unitMoney, number, qty, pct, $, $$, openSheet, toast, busy, options, emptyState,
  foodCostPill, statusPill, initials, unitLabel,
} from '../ui.js';
import { list } from '../app.js';
import { t } from '../i18n.js';
import { recipeLines } from './recipe-lines.js';
import { ingredientSheet, itemSheet } from './stock.js';
import { renderPricing, channelPriceEditor, selectChannel } from './pricing-view.js';
import { renderAnalysis } from './analysis.js';
import { renderPromotions } from './promotions.js';
import { sopSheet } from './sop.js';

const ui = { tab: 'dishes', search: '', sort: 'name' };
const VARIANCE_FLAG = 10;

export async function render(ctx) {
  const { el, setTitle, setActions, can } = ctx;
  setTitle(t('menu.title'));
  // Stock sheets opened from here redraw this view (not Stock) after saving.
  const sctx = { ...ctx, redraw: () => render(ctx) };
  // Deep link from the dashboard: #/menu/pricing/<channelId>
  const [tab, arg] = ctx.params || [];
  if (['dishes', 'preps', 'pricing', 'analysis', 'promotions'].includes(tab)) {
    ui.tab = tab;
    if (tab === 'pricing' && arg) selectChannel(arg);
    history.replaceState(null, '', '#/menu');
    ctx.params = [];
  }
  if (!can('manager') && ['pricing', 'analysis', 'promotions'].includes(ui.tab)) ui.tab = 'dishes';
  if (can('manager')) {
    const label = ui.tab === 'preps' ? t('menu.newPrep') : t('menu.newDish');
    setActions(html`<button class="icon-btn" id="new-item" aria-label="${label}">${icon('plus')}</button>`)
      .querySelector('#new-item').addEventListener('click', () => (ui.tab === 'preps' ? ingredientSheet(sctx, null, { kind: 'prep' }) : dishSheet(ctx)));
  } else setActions('');

  mount(el, html`
    <div class="seg${can('manager') ? ' scroll' : ''}" role="group" aria-label="${t('menu.tabs')}" style="margin-top:4px">
      <button aria-pressed="${ui.tab === 'dishes'}" data-tab="dishes">${t('menu.tabDishes')}</button>
      <button aria-pressed="${ui.tab === 'preps'}" data-tab="preps">${t('menu.tabPreps')}</button>
      ${can('manager') ? html`<button aria-pressed="${ui.tab === 'pricing'}" data-tab="pricing">${t('menu.tabPricing')}</button>
        <button aria-pressed="${ui.tab === 'analysis'}" data-tab="analysis">${t('menu.tabAnalysis')}</button>
        <button aria-pressed="${ui.tab === 'promotions'}" data-tab="promotions">${t('menu.tabPromotions')}</button>` : ''}
    </div>
    <div id="menu-tab"></div>`);
  $$('[data-tab]', el).forEach((b) => b.addEventListener('click', () => {
    if (ui.tab === b.dataset.tab) return;
    ui.tab = b.dataset.tab;
    render(ctx);
  }));
  const host = el.querySelector('#menu-tab');
  if (ui.tab === 'preps') renderPreps(sctx, host);
  else if (ui.tab === 'pricing') renderPricing(ctx, host, { openDish: (m) => dishSheet(ctx, m) });
  else if (ui.tab === 'analysis') renderAnalysis(ctx, host, { openDish: (m) => dishSheet(ctx, m) });
  else if (ui.tab === 'promotions') renderPromotions(ctx, host);
  else renderDishes(ctx, host);
}

/* ---------------------------------------------------------------- dishes */

function renderDishes(ctx, host) {
  const { state, can } = ctx;
  const boot = state.boot;
  const target = Number(boot.settings.targetFoodCostPct) || 30;
  const active = boot.menu.filter((m) => m.active);
  const priced = active.filter((m) => m.foodCostPct !== null);
  const avg = priced.length ? priced.reduce((a, m) => a + m.foodCostPct, 0) / priced.length : null;
  const over = priced.filter((m) => m.foodCostPct > target).length;

  mount(host, html`
    <div class="card summary-strip">
      <div><div class="val">${active.length}</div><div class="label">${t('menu.dishes')}</div></div>
      <div><div class="val">${pct(avg)}</div><div class="label">${t('menu.avgFoodCost')}</div></div>
      <div><div class="val" style="${over ? 'color:var(--bad-ink)' : ''}">${over}</div><div class="label">${t('menu.above', { n: target })}</div></div>
    </div>
    <div class="search" style="margin-top:14px">${icon('search')}<input class="input" type="search" placeholder="${t('menu.search')}" value="${ui.search}" aria-label="${t('menu.search')}"></div>
    <div class="chips" role="group" aria-label="${t('menu.sort')}">
      ${[['name', t('menu.sortName')], ['cost', t('menu.sortCost')], ['margin', t('menu.sortMargin')]].map(([k, l]) =>
        html`<button class="chip" data-sort="${k}" aria-pressed="${ui.sort === k}">${l}</button>`)}
    </div>
    <div class="card" id="dishes"></div>
    <p class="small muted" style="margin:10px 4px">${t('menu.note', { n: target })}</p>`);

  const draw = () => {
    const q = ui.search.trim().toLowerCase();
    let rows = boot.menu.filter((m) => m.active || can('manager'));
    if (q) rows = rows.filter((m) => m.name.toLowerCase().includes(q) || (m.category || '').toLowerCase().includes(q));
    rows = rows.slice().sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (ui.sort === 'cost') return (b.foodCostPct ?? -1) - (a.foodCostPct ?? -1);
      if (ui.sort === 'margin') return b.margin - a.margin;
      return a.name.localeCompare(b.name);
    });
    mount($('#dishes'), rows.length ? html`<ul class="list">${rows.map((m) => {
      const p = m.foodCostPct ?? 0;
      const color = m.foodCostPct === null ? 'var(--line-strong)' : p <= target ? 'var(--good)' : p <= target + 5 ? 'var(--warn)' : 'var(--bad)';
      return html`<li><button class="row" data-id="${m.id}" style="${m.active ? '' : 'opacity:.55'}">
        <span class="grow"><div class="title">${m.name}${m.active ? '' : ` (${t('menu.hidden')})`}</div>
          <div class="sub">${money(m.price)} · ${t('menu.costShort', { amount: money(m.foodCost) })}</div>
          <div class="cost-bar" aria-hidden="true"><span style="width:${Math.min(100, p)}%;background:${color}"></span></div></span>
        <span class="value">${m.recipe.length ? foodCostPill(m.foodCostPct, target) : html`<span class="pill warn">${icon('alert')}${t('sales.noRecipe')}</span>`}</span>
      </button></li>`;
    })}</ul>`
      : emptyState('chef', t('menu.noneTitle'), can('manager') ? t('menu.noneText') : t('menu.noneStaff')));
    $$('#dishes [data-id]').forEach((b) => b.addEventListener('click', () => {
      const m = boot.menu.find((x) => x.id === b.dataset.id);
      if (can('manager')) dishSheet(ctx, m); else viewSheet(ctx, m, target);
    }));
  };
  host.querySelector('.search input').addEventListener('input', (e) => { ui.search = e.target.value; draw(); });
  $$('[data-sort]', host).forEach((b) => b.addEventListener('click', () => {
    ui.sort = b.dataset.sort;
    $$('[data-sort]', host).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  }));
  draw();
}

/** Cost breakdown rows, costliest first, each with its share of the dish cost. */
function breakdownHtml(lines) {
  const rows = lines.filter((l) => l.ingredientId || l.name).slice().sort((a, b) => b.cost - a.cost);
  if (!rows.length) return html`<li class="pl-row muted"><span>—</span></li>`;
  return rows.map((l) => html`<li>
    <div class="share-top"><span>${l.name}</span>
      ${l.error === 'unit' ? html`<span class="warn-text small">${icon('alert')}${t('recipe.cantConvert')}</span>`
        : html`<span><b>${money(l.cost)}</b> <span class="muted small">${pct(l.share, 0)}</span></span>`}</div>
    <div class="cost-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, l.share))}%;background:var(--brand)"></span></div>
  </li>`);
}

function viewSheet(ctx, m, target) {
  openSheet({
    title: m.name,
    foot: html`<button class="btn primary block" data-sop>${icon('clipboard')}${t('sop.open')}</button>`,
    onMount(el, close) { el.querySelector('[data-sop]').addEventListener('click', () => { close(); sopSheet(ctx, m.id); }); },
    body: html`<div class="card summary-strip" style="margin-bottom:14px">
        <div><div class="val">${money(m.price)}</div><div class="label">${t('menu.price')}</div></div>
        <div><div class="val">${money(m.foodCost)}</div><div class="label">${t('home.foodCost')}</div></div>
        <div><div class="val">${foodCostPill(m.foodCostPct, target)}</div><div class="label">${t('menu.costPct')}</div></div></div>
      <div class="card"><ul class="list">${m.recipe.map((l) => html`<li class="pl-row"><span>${l.name}</span>
        <span class="tabular">${number(l.qty, 4)} ${unitLabel(l.unit)} · ${money(l.cost)}</span></li>`)}</ul></div>
      ${m.recipe.length ? html`<div class="section-head" style="margin-top:16px"><h2 style="font-size:15px">${t('menu.breakdown')}</h2></div>
        <div class="card"><ul class="list share-list">${breakdownHtml(m.recipe)}</ul></div>` : ''}`,
  });
}

function dishSheet(ctx, item) {
  const boot = ctx.state.boot;
  const target = Number(boot.settings.targetFoodCostPct) || 30;
  const cats = [...new Set([...list(boot.settings.menuCategories), ...boot.menu.map((m) => m.category).filter(Boolean)])];
  const isNew = !item;
  item = item || { active: true, recipe: [], prices: {} };
  const chPrices = channelPriceEditor(boot, item);
  // Boot recipe lines carry the effective yield; only a value that differs from the ingredient's is an override.
  const initial = item.recipe.map((l) => {
    const ing = boot.ingredients.find((i) => i.id === l.ingredientId);
    const override = ing && Number(l.yieldPct) !== Number(ing.yieldPct) ? l.yieldPct : '';
    return { ingredientId: l.ingredientId, qty: l.qty, unit: l.unit, yieldPct: override };
  });

  openSheet({
    title: isNew ? t('menu.newDish') : t('menu.editDish'),
    body: html`<form id="f" novalidate>
      <label class="field"><span class="label">${t('menu.dishName')}</span><input class="input" name="name" value="${item.name || ''}" maxlength="80"></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('menu.sellingPrice')}</span><input class="input" name="price" type="number" inputmode="decimal" min="0" step="any" value="${item.price ?? ''}"></label>
        <label class="field"><span class="label">${t('common.category')}</span><select class="select" name="category">${options(cats, item.category, { placeholder: t('common.none') })}</select></label>
      </div>
      <div class="section-head" style="margin-top:6px"><h2 style="font-size:15px">${t('menu.recipe')}</h2></div>
      <p class="small muted" style="margin:-4px 2px 10px">${t('menu.recipeHelp')}</p>
      <div id="lines"></div>
      <button type="button" class="btn sm" id="add-line">${icon('plus')}${t('menu.addIngredient')}</button>
      <div class="card" style="margin-top:16px">
        <div class="pl-row"><span>${t('menu.costPerDish')}</span><b class="tabular" id="cost">—</b></div>
        <div class="pl-row"><span>${t('menu.costPct')}</span><span id="pct">—</span></div>
        <div class="pl-row"><span>${t('menu.marginPerDish')}</span><b class="tabular" id="margin">—</b></div>
        <div class="pl-row"><span>${t('menu.priceForTarget', { n: target })}</span><span class="tabular" id="suggest">—</span></div>
      </div>
      <div class="section-head" style="margin-top:16px"><h2 style="font-size:15px">${t('menu.breakdown')}</h2></div>
      <div class="card"><ul class="list share-list" id="breakdown"></ul></div>
      ${chPrices.html}
      ${isNew ? '' : html`<label class="check" style="margin-top:12px"><input type="checkbox" name="active" ${item.active ? raw('checked') : ''}> ${t('menu.onMenu')}</label>`}
    </form>`,
    foot: html`${isNew ? '' : html`<button class="btn" id="open-sop">${icon('clipboard')}${t('sop.short')}</button>`}
      <button class="btn primary block" id="save">${isNew ? t('menu.addDish') : t('menu.saveDish')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      const openSop = el.querySelector('#open-sop');
      if (openSop) openSop.addEventListener('click', () => { close(); sopSheet(ctx, item.id); });
      let totals = { cost: 0, lines: [], problem: '' };
      const summary = () => {
        const total = totals.cost;
        const price = Number(form.price.value) || 0;
        if (totals.problem) {
          mount(el.querySelector('#cost'), html`<span class="warn-text small">${icon('alert')}${t(totals.problem === 'depth' ? 'recipe.depth' : 'recipe.cycle')}</span>`);
        } else el.querySelector('#cost').textContent = money(total);
        mount(el.querySelector('#pct'), price ? foodCostPill(total / price * 100, target) : '—');
        el.querySelector('#margin').textContent = price ? money(price - total) : '—';
        el.querySelector('#suggest').textContent = total ? money(total / (target / 100)) : '—';
        mount(el.querySelector('#breakdown'), breakdownHtml(totals.lines));
        if (recalcPrices) recalcPrices();
      };
      let recalcPrices = null;
      const editor = recipeLines(el.querySelector('#lines'), {
        ingredients: boot.ingredients, lines: initial, onChange: (x) => { totals = x; summary(); },
      });
      recalcPrices = chPrices.wire(el, () => (totals.problem ? 0 : totals.cost), () => Number(form.price.value) || 0);
      recalcPrices();
      form.price.addEventListener('input', summary);
      el.querySelector('#add-line').addEventListener('click', () => editor.add().querySelector('select').focus());
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const recipe = editor.values().map((l) => ({ ingredientId: l.ingredientId, qty: l.qty, unit: l.unit, yieldPct: l.yieldPct }));
        try {
          await call('menu.save', {
            item: { id: item.id, version: item.version, name: form.name.value, price: form.price.value, category: form.category.value,
              active: isNew ? true : form.active.checked },
            recipe,
            prices: chPrices.values(el),
          });
        } catch (err) {
          if (err.code === 'CONFLICT') await ctx.refresh();
          throw err;
        }
        close();
        toast(isNew ? t('menu.dishAdded') : t('menu.dishSaved'));
        await ctx.refresh();
        render(ctx);
      }, form));
    },
  });
}

/* ----------------------------------------------------------------- preps */

function renderPreps(ctx, host) {
  const { state, can } = ctx;
  const preps = state.boot.ingredients.filter((i) => i.kind === 'prep' && (i.active || can('manager')));
  const active = preps.filter((p) => p.active);
  const flagged = (p) => p.costVariancePct !== null && p.costVariancePct !== undefined && Math.abs(p.costVariancePct) > VARIANCE_FLAG;

  if (!preps.length) {
    mount(host, html`<div class="card">${emptyState('chef', t('menu.prepsNoneTitle'), can('manager') ? t('menu.prepsNoneText') : t('menu.prepsNoneStaff'),
      can('manager') ? html`<button class="btn primary" id="first-prep">${icon('plus')}${t('menu.newPrep')}</button>` : null)}</div>`);
    const b = host.querySelector('#first-prep');
    if (b) b.addEventListener('click', () => ingredientSheet(ctx, null, { kind: 'prep' }));
    return;
  }
  const rows = preps.slice().sort((a, b) => (a.active !== b.active ? (a.active ? -1 : 1) : a.name.localeCompare(b.name)));
  mount(host, html`
    <div class="card summary-strip">
      <div><div class="val">${active.length}</div><div class="label">${t('menu.tabPreps')}</div></div>
      <div><div class="val">${active.filter((p) => p.trackStock).length}</div><div class="label">${t('menu.prepsTracked')}</div></div>
      <div><div class="val" style="${active.some(flagged) ? 'color:var(--warn-ink)' : ''}">${active.filter(flagged).length}</div><div class="label">${t('menu.prepsFlagged')}</div></div>
    </div>
    <div class="card" style="margin-top:14px"><ul class="list">${rows.map((p) => html`<li>
      <button class="row" data-id="${p.id}" style="${p.active ? '' : 'opacity:.55'}">
        <span class="avatar brand">${initials(p.name)}</span>
        <span class="grow"><div class="title">${p.name}${p.active ? '' : ` (${t('menu.hidden')})`}</div>
          <div class="sub">${unitMoney(p.costPerUnit)} / ${unitLabel(p.unit)}${p.trackStock ? ` · ${t('menu.prepOnHand', { qty: qty(p.onHand, unitLabel(p.unit)) })}` : ''}</div></span>
        <span class="value">${flagged(p)
          ? html`<span class="pill warn">${icon('alert')}${t('menu.prepVariance', { pct: `${p.costVariancePct > 0 ? '+' : ''}${pct(p.costVariancePct, 0)}` })}</span>`
          : p.trackStock ? statusPill(p.status) : ''}</span>
      </button></li>`)}</ul></div>
    <p class="small muted" style="margin:10px 4px">${t('menu.prepsNote')}</p>`);
  $$('[data-id]', host).forEach((b) => b.addEventListener('click', () => itemSheet(ctx, b.dataset.id)));
}
