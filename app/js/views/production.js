// Production: record a batch of a prep (ingredients used → quantity made, yield, by-products, real cost)
// and the production log (#/more/production) with run details and void.
import { call, newRequestId } from '../api.js';
import {
  html, raw, mount, icon, money, unitMoney, number, qty, pct, today, addDays, relDay, timeOf, $, $$, openSheet, confirmSheet,
  toast, busy, options, emptyState, unitLabel,
} from '../ui.js';
import { t } from '../i18n.js';
import { unitValue } from './recipe-lines.js';

const R = () => window.RestoCosting;
const round = (n, dp = 4) => { const m = Math.pow(10, dp); return Math.round(n * m) / m; };
const signed = (v, dp = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${pct(Math.abs(v), dp)}`;
// After saving: Stock / Menu pass their own redraw; otherwise re-render the current page.
const redraw = (ctx) => (ctx.redraw ? ctx.redraw() : ctx.rerender());

/** Yield verdict: 95–105 % is on target; under 95 lost product; over 105 the batch size is probably wrong. */
export function yieldPill(y) {
  if (y === '' || y === null || y === undefined || !Number.isFinite(Number(y))) return '';
  const v = Number(y);
  const ok = v >= 95 && v < 105;
  return html`<span class="pill ${ok ? 'good' : 'warn'}">${icon(ok ? 'check' : 'alert')}${t('production.yieldPill', { pct: pct(v, 0) })}</span>`;
}
const yieldVerdict = (v) => (v < 95 ? t('production.yieldLow') : v >= 105 ? t('production.yieldHigh') : t('production.yieldOk'));

/** Default ingredients for `batches` of a prep, as the server works them out: gross, in stock units, merged, 4 dp. */
function defaultInputs(prep, batches, book) {
  const acc = new Map();
  (prep.prepLines || []).forEach((line) => {
    R().explode(line, batches, book).forEach((x) => acc.set(x.ingredientId, (acc.get(x.ingredientId) || 0) + x.qty));
  });
  return [...acc].map(([ingredientId, q]) => ({ ingredientId, qty: round(q) }));
}

function unitOptions(ing, selected) {
  const C = R();
  const units = C.unitsFor(ing).map(unitValue);
  const pick = units.find((u) => C.sameUnit(u, selected)) || units[0];
  return html`${units.map((u) => html`<option value="${u}" ${u === pick ? raw('selected') : ''}>${unitLabel(u)}</option>`)}`;
}
function ingredientPicker(pool, selected) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const raws = pool.filter((i) => i.kind !== 'prep').sort(byName);
  const preps = pool.filter((i) => i.kind === 'prep').sort(byName);
  const opt = (i) => html`<option value="${i.id}" ${i.id === selected ? raw('selected') : ''}>${i.name} (${unitLabel(i.unit)})</option>`;
  return html`<option value="">${t('stock.chooseIngredient')}</option>
    ${raws.length ? html`<optgroup label="${t('recipe.groupIngredients')}">${raws.map(opt)}</optgroup>` : ''}
    ${preps.length ? html`<optgroup label="${t('recipe.groupPreps')}">${preps.map(opt)}</optgroup>` : ''}`;
}

/* ------------------------------------------------------------ produce */

/**
 * Record a production run. One screen: prep → batches → ingredients used → made (with yield) → more options.
 * The foot keeps the run cost and cost per unit against the recipe in view.
 */
export function produceSheet(ctx, prepId) {
  const boot = ctx.state.boot;
  const C = R();
  const book = C.buildBook(boot.ingredients);
  const byId = book.byId;
  const me = boot.user;
  // Made-to-order preps (not kept in stock) are not produced ahead; offer only stocked ones (plus a preset).
  const preps = boot.ingredients.filter((i) => i.kind === 'prep' && ((i.active && i.trackStock !== false) || i.id === prepId))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!preps.length) {
    openSheet({
      title: t('production.title'),
      body: emptyState('chef', t('production.noPrepsTitle'), ctx.can('manager') ? t('production.noPrepsText') : t('menu.prepsNoneStaff')),
    });
    return;
  }
  const rid = newRequestId();
  const pool = boot.ingredients.filter((i) => i.active);
  // Who cooked: the active team (every role gets boot.team); the signed-in user is the default.
  const makers = new Map();
  (boot.team || []).forEach((u) => makers.set(u.username, u.displayName));
  if (!makers.has(me.username)) makers.set(me.username, me.displayName);

  const st = { prep: byId[prepId] || preps[0], batches: 1, editing: false, lines: [], madeTouched: false };

  openSheet({
    title: t('production.title'),
    body: html`<form id="f" novalidate>
      <label class="field"><span class="label">${t('production.prep')}</span>
        <select class="select" name="prepId">${options(preps.map((p) => ({ value: p.id, label: p.name })), st.prep.id)}</select></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('common.date')}</span><input class="input" type="date" name="date" value="${today()}" max="${today()}"></label>
        <div class="field"><span class="label" id="batches-l">${t('production.batches')}</span>
          <div class="stepper has-value" role="group" aria-labelledby="batches-l">
            <button type="button" data-step="-1" aria-label="${t('production.fewer')}">${icon('minus')}</button>
            <input name="batches" type="number" inputmode="decimal" min="0" step="any" value="1" aria-labelledby="batches-l">
            <button type="button" data-step="1" aria-label="${t('production.more')}">${icon('plus')}</button>
          </div></div>
      </div>

      <div class="section-head" style="margin-top:2px"><h2 style="font-size:15px">${t('production.used')}</h2>
        <button type="button" class="link" id="edit-toggle" aria-pressed="false">${t('production.editAmounts')}</button></div>
      <div class="card prod-lines" id="inputs" style="margin-bottom:6px"></div>
      <button type="button" class="btn sm hidden" id="add-input" style="margin-top:4px">${icon('plus')}${t('menu.addIngredient')}</button>
      <p class="small muted" style="margin:6px 2px 16px" id="inputs-help"></p>

      <label class="field" style="margin-bottom:8px"><span class="label">${t('production.made')}</span>
        <div class="input-group"><input class="input" name="producedQty" type="number" inputmode="decimal" min="0" step="any" placeholder="0">
          <span class="addon" id="made-unit"></span></div></label>
      <div class="yield-line" id="yield" aria-live="polite"></div>

      <button type="button" class="link-btn" id="more" aria-expanded="false" aria-controls="more-panel">${icon('sliders')}${t('production.moreOptions')}</button>
      <div class="hidden" id="more-panel">
        <div class="section-head" style="margin-top:6px"><h2 style="font-size:15px">${t('production.byproducts')}</h2></div>
        <p class="small muted" style="margin:-4px 2px 10px">${t('production.byproductsHelp')}</p>
        <div id="byps"></div>
        <button type="button" class="btn sm" id="add-byp">${icon('plus')}${t('production.addByproduct')}</button>
        <label class="field" style="margin-top:14px"><span class="label">${t('production.producedBy')}</span>
          <select class="select" name="producedBy" id="maker"></select></label>
        <label class="field"><span class="label">${t('common.note')}</span><input class="input" name="note" maxlength="200" placeholder="${t('common.optional')}"></label>
      </div>
    </form>`,
    foot: html`<div class="grow" style="align-self:center;min-width:0">
        <div class="small muted" id="sum-label"></div>
        <div class="sum-line"><b id="sum-unit">—</b><span id="sum-var"></span></div>
        <div class="small muted" id="sum-run"></div></div>
      <button class="btn primary" id="save" style="flex:none">${t('production.save')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      const inputsHost = el.querySelector('#inputs');
      const bypsHost = el.querySelector('#byps');
      const costOf = (id) => Number(byId[id] && byId[id].costPerUnit) || 0;

      mount(el.querySelector('#maker'), options([...makers].map(([value, label]) => ({ value, label })), me.username));

      /* -- ingredients used: read-only list (recipe × batches) or editable rows */
      const shortText = (ing, q) => (ing && ing.trackStock !== false && q > (Number(ing.onHand) || 0) + 1e-9
        ? html`<div class="warn-text small" style="margin-top:4px">${icon('alert')}<span>${t('production.onlyOnHand', { qty: qty(round(Math.max(0, ing.onHand), 3), unitLabel(ing.unit)) })}</span></div>` : '');

      const drawReadOnly = () => {
        const rows = st.lines;
        mount(inputsHost, rows.length ? html`<ul class="list">${rows.map((l) => {
          const ing = byId[l.ingredientId];
          return html`<li class="row"><span class="grow"><div class="title">${ing ? ing.name : '?'}</div>${shortText(ing, l.qty)}</span>
            <span class="value"><div>${qty(round(l.qty, 3), unitLabel(ing && ing.unit))}</div><div class="sub">${money(l.qty * costOf(l.ingredientId))}</div></span></li>`;
        })}</ul>`
          : html`<div style="padding:14px 16px"><span class="warn-text small">${icon('alert')}<span>${t('production.noRecipe')}</span></span></div>`);
      };
      const editRow = (l = {}) => {
        const ing = byId[l.ingredientId];
        const w = document.createElement('div');
        w.className = 'line-item';
        w.dataset.in = '';
        mount(w, html`${l.ingredientId
          ? html`<div class="line-head" style="margin-bottom:0"><span style="color:var(--ink);font-size:15px">${ing ? ing.name : '?'}</span></div>
            <input type="hidden" data-f="ingredientId" value="${l.ingredientId}">`
          : html`<select class="select" data-f="ingredientId" aria-label="${t('stock.ingredient')}">${ingredientPicker(pool.filter((i) => i.id !== st.prep.id), '')}</select>`}
          <div class="prod-edit">
            <input class="input" data-f="qty" type="number" inputmode="decimal" min="0" step="any" value="${l.qty === undefined ? '' : round(l.qty, 4)}" placeholder="0" aria-label="${t('stock.quantity')}">
            <select class="select" data-f="unit" aria-label="${t('recipe.unit')}" ${ing ? '' : raw('disabled')}>${ing ? unitOptions(ing, ing.unit) : html`<option value="">${t('recipe.unit')}</option>`}</select>
            <button type="button" class="icon-btn" data-remove aria-label="${t('recipe.removeLine')}">${icon('x')}</button>
          </div>
          <div data-note></div>`);
        return w;
      };
      const drawEditable = () => {
        mount(inputsHost, '');
        const box = document.createElement('div');
        box.style.padding = '12px 12px 2px';
        st.lines.forEach((l) => box.append(editRow(l)));
        inputsHost.append(box);
      };
      const editedLines = () => $$('[data-in]', inputsHost).map((w) => ({
        el: w,
        ingredientId: w.querySelector('[data-f=ingredientId]').value,
        qty: w.querySelector('[data-f=qty]').value.trim(),
        unit: w.querySelector('[data-f=unit]').value,
      }));
      const bypLines = () => $$('[data-byp]', bypsHost).map((w) => ({
        el: w,
        ingredientId: w.querySelector('[data-f=ingredientId]').value,
        qty: w.querySelector('[data-f=qty]').value.trim(),
        unit: w.querySelector('[data-f=unit]').value,
      }));
      /**
       * Rows to send: blank rows (no amount) are dropped; a chosen item with an amount of 0 or less,
       * or an amount without an item, is a problem the cook must fix before saving.
       */
      const sendable = (rows) => rows.filter((r) => r.qty !== '');
      const rowProblem = (r) => (r.qty === '' ? '' : !r.ingredientId ? t('stock.chooseIngredient')
        : !(Number(r.qty) > 0) ? t('production.qtyAboveZero') : '');
      const warnNote = (text) => html`<div class="warn-text small" style="margin-top:6px">${icon('alert')}<span>${text}</span></div>`;
      /** Amount in the ingredient's stock unit, or null when the unit can't be converted. */
      const toStock = (r) => {
        const ing = byId[r.ingredientId];
        if (!ing || r.qty === '') return 0;
        return C.convertQty(Number(r.qty) || 0, r.unit || ing.unit, ing);
      };

      const recalc = () => {
        const prep = st.prep;
        const pu = unitLabel(prep.unit);
        // Inputs and by-products in stock units, with per-row unit problems flagged.
        let inputs;
        if (st.editing) {
          inputs = [];
          editedLines().forEach((r) => {
            const s = toStock(r);
            const ing = byId[r.ingredientId];
            const note = r.el.querySelector('[data-note]');
            const problem = rowProblem(r);
            if (problem) mount(note, warnNote(problem));
            else if (s === null) mount(note, warnNote(t('recipe.cantConvert')));
            else mount(note, shortText(ing, s));
            if (ing && s > 0) inputs.push({ ingredientId: ing.id, qty: s });
          });
        } else inputs = st.lines;
        const byproducts = [];
        bypLines().forEach((r) => {
          const s = toStock(r);
          const note = r.el.querySelector('[data-note]');
          const problem = rowProblem(r);
          mount(note, problem ? warnNote(problem) : s === null ? warnNote(t('recipe.cantConvert')) : '');
          if (r.ingredientId && s > 0) byproducts.push({ ingredientId: r.ingredientId, qty: s });
        });
        const made = Number(form.producedQty.value) || 0;
        const rc = C.runCost({ inputs, byproducts, producedQty: made }, costOf);
        const expected = round((Number(prep.batchQty) || 0) * st.batches);

        el.querySelector('#made-unit').textContent = pu;
        // An empty edited list would make the server fall back to the full recipe: say so, and saving is blocked.
        const noneLeft = st.editing && !inputs.length;
        const help = el.querySelector('#inputs-help');
        if (noneLeft) mount(help, warnNote(t('production.noInputsEdited')));
        else help.textContent = st.editing ? t('production.editHelp') : t('production.usedHelp', { n: number(st.batches, 2) });
        const y = expected > 0 && made > 0 ? round(made / expected * 100, 1) : null;
        mount(el.querySelector('#yield'), y === null
          ? html`<span class="muted">${expected > 0 ? t('production.expected', { qty: qty(expected, pu) }) : t('production.noBatchQty')}</span>`
          : html`${yieldPill(y)}<span>${t('production.expected', { qty: qty(expected, pu) })} · ${yieldVerdict(y)}</span>`);

        const recipe = Number(prep.costPerUnit) || 0;
        el.querySelector('#sum-label').textContent = t('recipe.costPerUnit', { unit: pu });
        el.querySelector('#sum-unit').textContent = made > 0 ? unitMoney(rc.unitCost) : '—';
        const v = made > 0 && recipe > 0 ? (rc.unitCost - recipe) / recipe * 100 : null;
        mount(el.querySelector('#sum-var'), v === null ? ''
          : html`<span class="pill ${Math.abs(v) > 10 ? 'warn' : 'good'}">${Math.abs(v) > 10 ? icon('alert') : icon('check')}${t('production.vsRecipe', { pct: signed(v, 0) })}</span>`);
        el.querySelector('#sum-run').textContent = t('production.runCostLine', { cost: money(rc.totalCost), recipe: unitMoney(recipe) })
          + (rc.byproductValue ? ` · ${t('production.creditLine', { amount: money(rc.byproductValue) })}` : '');
      };

      const reset = () => {
        st.lines = defaultInputs(st.prep, st.batches, book);
        st.editing = false;
        el.querySelector('#edit-toggle').textContent = t('production.editAmounts');
        el.querySelector('#edit-toggle').setAttribute('aria-pressed', 'false');
        el.querySelector('#add-input').classList.add('hidden');
        drawReadOnly();
      };
      const setMade = () => {
        if (!st.madeTouched) form.producedQty.value = round((Number(st.prep.batchQty) || 0) * st.batches) || '';
      };
      const setBatches = (b) => {
        if (!(b > 0)) return;
        const old = st.batches;
        st.batches = round(b, 4);
        if (st.editing) {
          // Keep the cook's edits, scaled to the new number of batches.
          $$('[data-in] [data-f=qty]', inputsHost).forEach((i) => { if (i.value !== '') i.value = round(Number(i.value) * st.batches / old, 4); });
        } else {
          st.lines = defaultInputs(st.prep, st.batches, book);
          drawReadOnly();
        }
        setMade();
        recalc();
      };

      form.prepId.addEventListener('change', () => {
        st.prep = byId[form.prepId.value] || st.prep;
        st.madeTouched = false;
        reset();
        setMade();
        recalc();
      });
      form.batches.addEventListener('input', () => setBatches(Number(form.batches.value)));
      $$('[data-step]', el).forEach((b) => b.addEventListener('click', () => {
        const cur = Number(form.batches.value) || 1;
        const next = Number(b.dataset.step) > 0 ? (cur < 1 ? 1 : Math.floor(cur) + 1) : (cur > 1 ? Math.ceil(cur) - 1 : 0.5);
        form.batches.value = next;
        setBatches(next);
      }));
      form.producedQty.addEventListener('input', () => { st.madeTouched = true; recalc(); });

      el.querySelector('#edit-toggle').addEventListener('click', (e) => {
        if (st.editing) { reset(); recalc(); return; }
        st.editing = true;
        e.currentTarget.textContent = t('production.useRecipe');
        e.currentTarget.setAttribute('aria-pressed', 'true');
        el.querySelector('#add-input').classList.remove('hidden');
        drawEditable();
        recalc();
        const first = inputsHost.querySelector('[data-f=qty]');
        if (first) first.focus();
      });
      const wireRow = (host) => {
        host.addEventListener('input', recalc);
        host.addEventListener('change', (e) => {
          if (e.target.matches('select[data-f=ingredientId]')) {
            const w = e.target.closest('.line-item');
            const ing = byId[e.target.value];
            const u = w.querySelector('[data-f=unit]');
            mount(u, ing ? unitOptions(ing, ing.unit) : html`<option value="">${t('recipe.unit')}</option>`);
            u.disabled = !ing;
          }
          recalc();
        });
        host.addEventListener('click', (e) => {
          const rm = e.target.closest('[data-remove]');
          if (!rm) return;
          rm.closest('.line-item').remove();
          recalc();
        });
      };
      wireRow(inputsHost);
      wireRow(bypsHost);
      el.querySelector('#add-input').addEventListener('click', () => {
        const w = editRow();
        (inputsHost.firstElementChild || inputsHost).append(w);
        w.querySelector('select').focus();
      });
      el.querySelector('#add-byp').addEventListener('click', () => {
        const w = editRow();
        delete w.dataset.in;
        w.dataset.byp = '';
        bypsHost.append(w);
        w.querySelector('select').focus();
      });
      el.querySelector('#more').addEventListener('click', (e) => {
        const open = el.querySelector('#more-panel').classList.toggle('hidden') === false;
        e.currentTarget.setAttribute('aria-expanded', String(open));
      });

      reset();
      setMade();
      recalc();

      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        recalc();
        const pick = ({ ingredientId, qty: q, unit }) => ({ ingredientId, qty: q, unit });
        const ins = st.editing ? sendable(editedLines()) : [];
        const byps = sendable(bypLines());
        if (ins.some(rowProblem) || byps.some(rowProblem)) throw new Error(t('production.fixAmounts'));
        if (st.editing && !ins.length) throw new Error(t('production.noInputsEdited'));
        const payload = {
          date: form.date.value, prepId: st.prep.id, batches: form.batches.value, producedQty: form.producedQty.value,
          producedBy: form.producedBy.value || me.username, note: form.note.value, byproducts: byps.map(pick),
        };
        if (st.editing) payload.inputs = ins.map(pick);
        const r = await call('production.add', payload, { requestId: rid });
        close();
        toast(t('production.saved', { no: r.run.runNo, qty: qty(r.run.producedQty, unitLabel(r.run.unit)) }));
        if (r.warnings && r.warnings.length) {
          toast(t('production.shortWarn', { items: r.warnings.map((w) => w.name).join(', ') }), 'warn', 7000);
        }
        await ctx.refresh();
        redraw(ctx);
      }, form));
    },
  });
}

/* ------------------------------------------------------------ log page */

const logUi = { prep: '' };

export async function renderLog(ctx) {
  const { el, setTitle, setActions } = ctx;
  setTitle(t('production.logTitle'), { back: true });
  const lctx = { ...ctx, redraw: () => renderLog(ctx) };
  setActions(html`<button class="icon-btn" id="new-run" aria-label="${t('production.title')}">${icon('plus')}</button>`)
    .querySelector('#new-run').addEventListener('click', () => produceSheet(lctx, logUi.prep || undefined));
  mount(el, html`<div class="skeleton" style="height:84px;margin-top:4px"></div><div class="skeleton" style="height:260px;margin-top:12px"></div>`);
  const from = addDays(today(), -90);
  const runs = await call('production.list', { from, limit: 300 });
  if (ctx.stale()) return;

  const prepIds = [...new Set(runs.map((r) => r.prepId))];
  if (logUi.prep && !prepIds.includes(logUi.prep)) logUi.prep = '';
  const shown = logUi.prep ? runs.filter((r) => r.prepId === logUi.prep) : runs;
  const live = shown.filter((r) => !r.voided);
  const yields = live.filter((r) => r.yieldPct !== '' && r.yieldPct !== null);
  const avgYield = yields.length ? yields.reduce((a, r) => a + Number(r.yieldPct), 0) / yields.length : null;
  const byDay = {};
  shown.forEach((r) => (byDay[r.date] ||= []).push(r));

  if (!runs.length) {
    mount(el, html`<div class="card" style="margin-top:4px">${emptyState('chef', t('production.emptyTitle'), t('production.emptyText'),
      html`<button class="btn primary" id="first-run">${icon('plus')}${t('production.title')}</button>`)}</div>`);
    $('#first-run', el).addEventListener('click', () => produceSheet(lctx));
    return;
  }
  const names = {};
  runs.forEach((r) => { names[r.prepId] = r.prepName; });
  mount(el, html`
    <div class="card summary-strip" style="margin-top:4px">
      <div><div class="val">${live.length}</div><div class="label">${t('production.runs')}</div></div>
      <div><div class="val">${money(live.reduce((a, r) => a + r.totalCost, 0), { compact: true })}</div><div class="label">${t('production.totalCost')}</div></div>
      <div><div class="val" style="${avgYield !== null && (avgYield < 95 || avgYield >= 105) ? 'color:var(--warn-ink)' : ''}">${avgYield === null ? '—' : pct(avgYield, 0)}</div><div class="label">${t('production.avgYield')}</div></div>
    </div>
    ${prepIds.length > 1 ? html`<div class="chips" role="group" aria-label="${t('common.filter')}" style="margin-top:14px">
      <button class="chip" data-p="" aria-pressed="${!logUi.prep}">${t('common.all')}<span class="count">${runs.length}</span></button>
      ${prepIds.sort((a, b) => names[a].localeCompare(names[b])).map((id) => html`<button class="chip" data-p="${id}" aria-pressed="${logUi.prep === id}">${names[id]}</button>`)}
    </div>` : ''}
    ${Object.keys(byDay).map((d) => html`
      <div class="section-head" style="margin-top:16px"><h2 style="font-size:15px">${relDay(d)}</h2></div>
      <div class="card"><ul class="list">${byDay[d].map((r) => html`<li><button class="row ${r.voided ? 'voided' : ''}" data-run="${r.id}">
        <span class="avatar brand">${icon('chef')}</span>
        <span class="grow"><div class="title">${r.prepName}</div>
          <div class="sub">${r.runNo} · ${r.producedByName}${r.voided ? ' · ' + t('common.voided') : ''}</div></span>
        <span class="value"><div>${qty(r.producedQty, unitLabel(r.unit))}</div><div>${r.voided ? '' : yieldPill(r.yieldPct)}</div></span>
      </button></li>`)}</ul></div>`)}
    <p class="small muted" style="margin:12px 4px">${t('production.logNote')}</p>`);
  $$('[data-p]', el).forEach((b) => b.addEventListener('click', () => { logUi.prep = b.dataset.p; renderLog(ctx); }));
  $$('[data-run]', el).forEach((b) => b.addEventListener('click', () => runSheet(lctx, runs.find((r) => r.id === b.dataset.run))));
}

/** One run: verdict, numbers, then the stock movements it made (from movements.list, matched by refId). */
export async function runSheet(ctx, run) {
  const canVoid = ctx.can('manager') && !run.voided;
  const prep = ctx.state.boot.ingredients.find((i) => i.id === run.prepId);
  const pu = unitLabel(run.unit);
  const row = (label, value) => html`<li class="pl-row"><span>${label}</span><b style="text-align:right">${value}</b></li>`;
  const recipe = prep ? Number(prep.costPerUnit) || 0 : 0;
  const v = recipe > 0 && run.producedQty > 0 ? (run.unitCost - recipe) / recipe * 100 : null;
  const sheet = openSheet({
    title: `${run.prepName} · ${run.runNo}`,
    body: html`
      ${run.voided ? html`<p class="small muted" style="margin:0 2px 12px"><span class="pill bad">${t('common.voidedCap')}</span> ${t('production.voidedNote')}</p>` : ''}
      <div class="kpis" style="margin-bottom:14px">
        <div class="card kpi"><div class="label">${t('production.made')}</div><div class="val">${qty(run.producedQty, pu)}</div>
          <div class="delta">${yieldPill(run.yieldPct)}</div></div>
        <div class="card kpi"><div class="label">${t('recipe.costPerUnit', { unit: pu })}</div><div class="val">${unitMoney(run.unitCost)}</div>
          <div class="delta">${v === null ? '' : html`<span class="pill ${Math.abs(v) > 10 ? 'warn' : 'good'}">${t('production.vsRecipe', { pct: signed(v, 0) })}</span>`}</div></div>
      </div>
      ${run.yieldPct !== '' && !run.voided ? html`<p class="small" style="margin:-4px 2px 14px;color:var(--ink-2)">${yieldVerdict(Number(run.yieldPct))}</p>` : ''}
      <ul class="list card" style="margin-bottom:14px">
        ${row(t('common.date'), relDay(run.date))}
        ${row(t('production.batches'), number(run.batches, 2))}
        ${row(t('production.expectedLabel'), qty(run.expectedQty, pu))}
        ${row(t('production.inputCost'), money(run.inputCost))}
        ${run.byproductValue ? row(t('production.byproductCredit'), `− ${money(run.byproductValue)}`) : ''}
        ${row(t('production.runCost'), money(run.totalCost))}
        ${row(t('production.recipeCost'), recipe ? `${unitMoney(recipe)} / ${pu}` : '—')}
        ${row(t('production.producedBy'), run.producedByName)}
        ${row(t('common.enteredBy'), `${run.createdBy} · ${timeOf(run.createdAt)}`)}
        ${run.note ? row(t('common.note'), run.note) : ''}
      </ul>
      <div id="run-moves"><div class="skeleton" style="height:140px"></div></div>`,
    foot: canVoid ? html`<button class="btn danger" data-void>${icon('trash')}${t('production.void')}</button>` : null,
    onMount(el, close) {
      const b = el.querySelector('[data-void]');
      if (!b) return;
      b.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: t('production.voidTitle', { no: run.runNo }), message: t('production.voidMessage'), confirm: t('common.void'), danger: true });
        if (!ok) return;
        await busy(b, async () => {
          await call('production.void', { id: run.id });
          close();
          toast(t('production.voided', { no: run.runNo }));
          await ctx.refresh();
          redraw(ctx);
        });
      });
    },
  });
  try {
    const moves = (await call('movements.list', { from: run.date, to: run.date, limit: 1000 })).filter((m) => m.refId === run.id);
    const host = sheet.el.querySelector('#run-moves');
    if (!host) return;
    const used = moves.filter((m) => m.type === 'production');
    const out = moves.filter((m) => m.type === 'produce' || m.type === 'byproduct');
    const list = (rows) => html`<div class="card"><ul class="list">${rows.map((m) => html`<li class="row" style="min-height:52px">
      <span class="grow"><div class="title">${m.ingredientName}</div><div class="sub">${t(`type.${m.type}`)}</div></span>
      <span class="value"><div>${m.qty > 0 ? '+' : ''}${qty(round(m.qty, 3), unitLabel(m.unit))}</div><div class="sub">${money(Math.abs(m.value))}</div></span></li>`)}</ul></div>`;
    mount(host, html`
      <div class="section-head"><h2 style="font-size:15px">${t('production.used')}</h2></div>
      ${used.length ? list(used) : html`<div class="card">${emptyState('clipboard', t('production.noInputs'), '')}</div>`}
      <div class="section-head" style="margin-top:16px"><h2 style="font-size:15px">${t('production.outputs')}</h2></div>
      ${list(out)}`);
  } catch (e) { toast(e.message, 'bad'); }
}
