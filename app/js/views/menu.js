// Menu & recipe costing: each dish's ingredients, food cost and margin.
import { call } from '../api.js';
import { html, raw, mount, icon, money, number, pct, $, $$, openSheet, toast, busy, options, emptyState, foodCostPill } from '../ui.js';
import { list } from '../app.js';
import { t } from '../i18n.js';

const ui = { search: '', sort: 'name' };

export async function render(ctx) {
  const { el, state, setTitle, setActions, can } = ctx;
  setTitle(t('menu.title'));
  const boot = state.boot;
  const target = Number(boot.settings.targetFoodCostPct) || 30;
  if (can('manager')) {
    setActions(html`<button class="icon-btn" id="new-dish" aria-label="${t('menu.newDish')}">${icon('plus')}</button>`)
      .querySelector('#new-dish').addEventListener('click', () => dishSheet(ctx));
  }
  const active = boot.menu.filter((m) => m.active);
  const priced = active.filter((m) => m.foodCostPct !== null);
  const avg = priced.length ? priced.reduce((a, m) => a + m.foodCostPct, 0) / priced.length : null;
  const over = priced.filter((m) => m.foodCostPct > target).length;

  mount(el, html`
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
      if (can('manager')) dishSheet(ctx, m); else viewSheet(m, target);
    }));
  };
  el.querySelector('.search input').addEventListener('input', (e) => { ui.search = e.target.value; draw(); });
  $$('[data-sort]', el).forEach((b) => b.addEventListener('click', () => {
    ui.sort = b.dataset.sort;
    $$('[data-sort]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  }));
  draw();
}

function viewSheet(m, target) {
  openSheet({
    title: m.name,
    body: html`<div class="card summary-strip" style="margin-bottom:14px">
        <div><div class="val">${money(m.price)}</div><div class="label">${t('menu.price')}</div></div>
        <div><div class="val">${money(m.foodCost)}</div><div class="label">${t('home.foodCost')}</div></div>
        <div><div class="val">${foodCostPill(m.foodCostPct, target)}</div><div class="label">${t('menu.costPct')}</div></div></div>
      <div class="card"><ul class="list">${m.recipe.map((l) => html`<li class="pl-row"><span>${l.name}</span>
        <span class="tabular">${number(l.qty, 4)} ${l.unit} · ${money(l.cost)}</span></li>`)}</ul></div>`,
  });
}

function dishSheet(ctx, item) {
  const boot = ctx.state.boot;
  const target = Number(boot.settings.targetFoodCostPct) || 30;
  const ings = boot.ingredients.filter((i) => i.active || (item && item.recipe.some((l) => l.ingredientId === i.id)));
  const cats = [...new Set([...list(boot.settings.menuCategories), ...boot.menu.map((m) => m.category).filter(Boolean)])];
  const isNew = !item;
  item = item || { active: true, recipe: [] };

  const ingSelect = (selected) => html`<option value="">${t('stock.chooseIngredient')}</option>${ings.map((i) =>
    html`<option value="${i.id}" ${i.id === selected ? raw('selected') : ''}>${i.name} (${i.unit})</option>`)}`;
  const lineHtml = (l = {}) => html`<div class="line-item" data-line>
    <div style="display:flex;gap:8px;align-items:center">
      <select class="select" name="ingredientId" aria-label="${t('stock.ingredient')}">${ingSelect(l.ingredientId)}</select>
      <button type="button" class="icon-btn" data-remove aria-label="${t('menu.removeIngredient')}">${icon('x')}</button></div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
      <div class="input-group grow"><input class="input" name="qty" type="number" inputmode="decimal" min="0" step="any" value="${l.qty ?? ''}" placeholder="${t('menu.qtyPerDish')}" aria-label="${t('menu.qtyPerDish')}">
        <span class="addon" data-unit>${(ings.find((i) => i.id === l.ingredientId) || {}).unit || t('stock.unit')}</span></div>
      <b class="tabular nowrap" data-cost style="min-width:76px;text-align:right">—</b></div>
  </div>`;

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
      <div id="lines">${item.recipe.length ? item.recipe.map((l) => lineHtml(l)) : lineHtml()}</div>
      <button type="button" class="btn sm" id="add-line">${icon('plus')}${t('menu.addIngredient')}</button>
      <div class="card" style="margin-top:16px">
        <div class="pl-row"><span>${t('menu.costPerDish')}</span><b class="tabular" id="cost">—</b></div>
        <div class="pl-row"><span>${t('menu.costPct')}</span><span id="pct">—</span></div>
        <div class="pl-row"><span>${t('menu.marginPerDish')}</span><b class="tabular" id="margin">—</b></div>
        <div class="pl-row"><span>${t('menu.priceForTarget', { n: target })}</span><span class="tabular" id="suggest">—</span></div>
      </div>
      ${isNew ? '' : html`<label class="check" style="margin-top:12px"><input type="checkbox" name="active" ${item.active ? raw('checked') : ''}> ${t('menu.onMenu')}</label>`}
    </form>`,
    foot: html`<button class="btn primary block" id="save">${isNew ? t('menu.addDish') : t('menu.saveDish')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      const host = el.querySelector('#lines');
      const lines = () => $$('[data-line]', host).map((w) => ({
        el: w, ingredientId: w.querySelector('[name=ingredientId]').value, qty: Number(w.querySelector('[name=qty]').value) || 0,
      }));
      const recalc = () => {
        let total = 0;
        lines().forEach((l) => {
          const ing = ings.find((i) => i.id === l.ingredientId);
          l.el.querySelector('[data-unit]').textContent = ing ? ing.unit : t('stock.unit');
          const c = ing ? ing.costPerUnit * l.qty : 0;
          total += c;
          l.el.querySelector('[data-cost]').textContent = ing && l.qty ? money(c) : '—';
        });
        const price = Number(form.price.value) || 0;
        el.querySelector('#cost').textContent = money(total);
        mount(el.querySelector('#pct'), price ? foodCostPill(total / price * 100, target) : '—');
        el.querySelector('#margin').textContent = price ? money(price - total) : '—';
        el.querySelector('#suggest').textContent = total ? money(total / (target / 100)) : '—';
      };
      const wire = (w) => {
        w.querySelector('[data-remove]').addEventListener('click', () => {
          if ($$('[data-line]', host).length > 1) w.remove(); else w.querySelectorAll('input, select').forEach((x) => { x.value = ''; });
          recalc();
        });
      };
      $$('[data-line]', host).forEach(wire);
      host.addEventListener('input', recalc);
      host.addEventListener('change', recalc);
      form.price.addEventListener('input', recalc);
      el.querySelector('#add-line').addEventListener('click', () => {
        const tmp = document.createElement('div');
        mount(tmp, lineHtml());
        const w = tmp.firstElementChild;
        host.append(w);
        wire(w);
        w.querySelector('select').focus();
      });
      recalc();
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const recipe = lines().filter((l) => l.ingredientId || l.qty).map((l) => ({ ingredientId: l.ingredientId, qty: l.qty }));
        try {
          await call('menu.save', {
            item: { id: item.id, version: item.version, name: form.name.value, price: form.price.value, category: form.category.value,
              active: isNew ? true : form.active.checked },
            recipe,
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
