// Shared recipe-line editor (dish recipes and prep recipes): ingredient or prep, usable (net)
// quantity in any convertible unit, optional yield override, and a live cost per line.
import { html, raw, mount, icon, money, qty as fmtQty, pct, $$, unitLabel } from '../ui.js';
import { t } from '../i18n.js';

const R = () => window.RestoCosting;
/** Value stored for a unit: its canonical code when known (e.g. 'กก.' → 'kg'), else the text as typed. */
export const unitValue = (u) => R().unitCode(u) || String(u ?? '').trim();
const isBlank = (v) => v === '' || v === null || v === undefined;

function ingredientOptions(pool, selected) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const raws = pool.filter((i) => i.kind !== 'prep').sort(byName);
  const preps = pool.filter((i) => i.kind === 'prep').sort(byName);
  const opt = (i) => html`<option value="${i.id}" ${i.id === selected ? raw('selected') : ''}>${i.name} (${unitLabel(i.unit)})</option>`;
  return html`<option value="">${t('stock.chooseIngredient')}</option>
    ${raws.length ? html`<optgroup label="${t('recipe.groupIngredients')}">${raws.map(opt)}</optgroup>` : ''}
    ${preps.length ? html`<optgroup label="${t('recipe.groupPreps')}">${preps.map(opt)}</optgroup>` : ''}`;
}

/** Units this ingredient converts to first (stock unit selected by default), then the rest of the catalogue. */
function unitOptions(ing, selected) {
  if (!ing) return html`<option value="">${t('recipe.unit')}</option>`;
  const C = R();
  const good = C.unitsFor(ing).map(unitValue);
  const others = Object.keys(C.UNITS).filter((c) => !good.some((v) => C.sameUnit(v, c)));
  const want = String(selected ?? '').trim();
  if (want && !good.concat(others).some((v) => C.sameUnit(v, want))) others.unshift(unitValue(want));
  const pick = want ? good.concat(others).find((v) => C.sameUnit(v, want)) : good[0];
  const opt = (v) => html`<option value="${v}" ${v === pick ? raw('selected') : ''}>${unitLabel(v)}</option>`;
  return html`${good.map(opt)}${others.length ? html`<optgroup label="${t('recipe.groupNeedsConversion')}">${others.map(opt)}</optgroup>` : ''}`;
}

const lineCostText = (c) => (c > 0 && c < 0.005 ? `< ${money(0.01)}` : money(c));

/**
 * recipeLines(host, { ingredients, lines, excludeId, isPrep, onChange })
 *   ingredients: ALL boot ingredient rows (raw and prep, active or not): the costing book, like the server's.
 *                The picker offers only active ones plus any already used in `lines`.
 *   lines:       initial [{ ingredientId, qty, unit, yieldPct, note }]; yieldPct here is an override ('' = none).
 *   excludeId:   the prep being edited: hidden from the picker, and its recipe is replaced by these lines
 *                when costing so nested preps that use it (a cycle) are caught.
 *   isPrep:      the form edits a (new) prep: costing also checks the new lines for cycles / depth.
 * → { values(), totals(), add() }
 */
export function recipeLines(host, { ingredients, lines = [], excludeId = '', isPrep = false, onChange } = {}) {
  const C = R();
  const used = new Set(lines.map((l) => l.ingredientId));
  const pool = ingredients.filter((i) => i.id !== excludeId && (i.active !== false || used.has(i.id)));
  const base = C.buildBook(ingredients);
  const find = (id) => base.byId[id];
  let last = { cost: 0, lines: [], problem: '' };

  const lineHtml = (l = {}) => {
    const ing = find(l.ingredientId);
    const hasOverride = !isBlank(l.yieldPct);
    return html`<div class="line-item rl" data-line data-note="${l.note || ''}">
      <div class="rl-head">
        <select class="select" data-f="ingredientId" aria-label="${t('stock.ingredient')}">${ingredientOptions(pool, l.ingredientId)}</select>
        <button type="button" class="icon-btn" data-remove aria-label="${t('recipe.removeLine')}">${icon('x')}</button>
      </div>
      <div class="rl-row">
        <input class="input" data-f="qty" type="number" inputmode="decimal" min="0" step="any" value="${l.qty ?? ''}" placeholder="0" aria-label="${t('recipe.qty')}">
        <select class="select" data-f="unit" aria-label="${t('recipe.unit')}" ${ing ? '' : raw('disabled')}>${unitOptions(ing, l.unit)}</select>
        <b class="rl-cost" data-cost>—</b>
      </div>
      <div class="warn-text small hidden" data-msg role="status">${icon('alert')}<span>${t('recipe.cantConvert')}</span></div>
      <div class="rl-foot">
        <button type="button" class="link-btn" data-more aria-expanded="${hasOverride}">${hasOverride ? t('recipe.less') : t('recipe.more')}</button>
        <span class="small muted" data-gross></span>
      </div>
      <div class="${hasOverride ? '' : 'hidden'}" data-more-panel>
        <label class="field" style="margin:2px 0 4px"><span class="label">${t('recipe.yieldOverride')}</span>
          <div class="input-group"><input class="input" data-f="yieldPct" type="number" inputmode="decimal" min="1" max="1000" step="any"
            value="${hasOverride ? l.yieldPct : ''}" placeholder="${ing ? ing.yieldPct : 100}" aria-label="${t('recipe.yieldOverride')}"><span class="addon">%</span></div>
          <span class="hint" data-yield-help>${t('recipe.yieldOverrideHelp', { pct: pct(ing ? ing.yieldPct : 100, 1) })}</span></label>
      </div>
    </div>`;
  };

  const rows = () => $$('[data-line]', host).map((w) => ({
    el: w,
    ingredientId: w.querySelector('[data-f=ingredientId]').value,
    qty: w.querySelector('[data-f=qty]').value.trim(),
    unit: w.querySelector('[data-f=unit]').value,
    yieldPct: w.querySelector('[data-f=yieldPct]').value.trim(),
    note: w.dataset.note || '',
  }));
  const asLine = (r) => ({ ingredientId: r.ingredientId, qty: r.qty === '' ? '' : Number(r.qty), unit: r.unit, yieldPct: r.yieldPct,
    ...(r.note ? { note: r.note } : {}) });

  const recalc = () => {
    const rs = rows();
    const own = rs.filter((r) => r.ingredientId).map(asLine);
    let book = base;
    const selfId = excludeId || (isPrep ? '__self__' : '');
    if (selfId) {
      const me = base.byId[selfId] || { id: selfId, name: '', unit: '', kind: 'prep', batchQty: 1, conversions: [] };
      book = { byId: { ...base.byId, [selfId]: { ...me, kind: 'prep', prepLines: own } } };
    }
    let costs = {};
    let problem = '';
    try { costs = C.prepCosts(book); } catch (e) {
      if (e && (e.code === 'CYCLE' || e.code === 'DEPTH')) problem = e.code === 'CYCLE' ? 'cycle' : 'depth'; else throw e;
    }
    const out = [];
    let total = 0;
    rs.forEach((r) => {
      const ing = find(r.ingredientId);
      const costEl = r.el.querySelector('[data-cost]');
      const msg = r.el.querySelector('[data-msg]');
      const gross = r.el.querySelector('[data-gross]');
      if (!ing) {
        costEl.textContent = '—'; msg.classList.add('hidden'); gross.textContent = '';
        return;
      }
      const res = C.lineCost(asLine(r), book, costs);
      const bad = res.error === 'unit';
      msg.classList.toggle('hidden', !bad);
      costEl.classList.toggle('warn-text', bad);
      if (bad) mount(costEl, icon('alert'));
      else costEl.textContent = r.qty === '' ? '—' : lineCostText(res.cost);
      const differs = !C.sameUnit(r.unit, ing.unit) || Math.abs(res.grossQty - res.stockQty) > 1e-9;
      gross.textContent = !bad && r.qty !== '' && Number(r.qty) > 0 && differs
        ? t('recipe.grossHint', { qty: fmtQty(Math.round(res.grossQty * 1000) / 1000, unitLabel(ing.unit)) }) : '';
      total += res.cost;
      out.push({ ingredientId: ing.id, name: ing.name, cost: res.cost, share: 0, error: res.error || '' });
    });
    out.forEach((l) => { l.share = total > 0 ? l.cost / total * 100 : 0; });
    last = { cost: total, lines: out, problem };
    if (onChange) onChange(last);
  };

  const wire = (w) => {
    w.querySelector('[data-remove]').addEventListener('click', () => {
      if ($$('[data-line]', host).length > 1) w.remove();
      else {
        mount(w.querySelector('[data-f=unit]'), unitOptions(null));
        w.querySelector('[data-f=unit]').disabled = true;
        w.querySelectorAll('input, select').forEach((x) => { x.value = ''; });
        w.dataset.note = '';
      }
      recalc();
    });
    w.querySelector('[data-more]').addEventListener('click', (e) => {
      const panel = w.querySelector('[data-more-panel]');
      const open = panel.classList.toggle('hidden') === false;
      e.currentTarget.setAttribute('aria-expanded', String(open));
      e.currentTarget.textContent = open ? t('recipe.less') : t('recipe.more');
      if (open) panel.querySelector('input').focus();
    });
    w.querySelector('[data-f=ingredientId]').addEventListener('change', (e) => {
      const ing = find(e.target.value);
      const unitSel = w.querySelector('[data-f=unit]');
      mount(unitSel, unitOptions(ing));
      unitSel.disabled = !ing;
      const y = w.querySelector('[data-f=yieldPct]');
      y.placeholder = ing ? ing.yieldPct : 100;
      w.querySelector('[data-yield-help]').textContent = t('recipe.yieldOverrideHelp', { pct: pct(ing ? ing.yieldPct : 100, 1) });
      w.dataset.note = '';
    });
  };

  const add = (l) => {
    const tmp = document.createElement('div');
    mount(tmp, lineHtml(l));
    const w = tmp.firstElementChild;
    host.append(w);
    wire(w);
    return w;
  };

  mount(host, '');
  (lines.length ? lines : [{}]).forEach((l) => add(l));
  host.addEventListener('input', recalc);
  host.addEventListener('change', recalc);
  recalc();

  return {
    values: () => rows().filter((r) => r.ingredientId || r.qty !== '').map(asLine),
    totals: () => last,
    add: (l) => { const w = add(l); recalc(); return w; },
    refresh: recalc,
  };
}
