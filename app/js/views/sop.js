// SOP manuals: step-by-step kitchen instructions built from each dish's or prep's recipe.
import { call } from '../api.js';
import { html, raw, mount, icon, number, $$, openSheet, toast, busy, emptyState, unitLabel } from '../ui.js';
import { t } from '../i18n.js';

const C = () => window.RestoCosting;
// Always read steps fresh: another manager may have changed them, and the editor's save is version-checked
// against the dish or prep, so showing old steps could silently undo their work.
const allSteps = () => call('sop.list', {});
// Links shown on an SOP must be web links, even if a value was typed straight into the sheet.
const safeHref = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');

/** { kind: 'dish' | 'prep', item } for an id, or null. */
function ownerOf(boot, id) {
  const dish = boot.menu.find((m) => m.id === id);
  if (dish) return { kind: 'dish', item: dish };
  const prep = boot.ingredients.find((i) => i.id === id && i.kind === 'prep');
  return prep ? { kind: 'prep', item: prep } : null;
}
const allergensOf = (o) => (o.kind === 'dish' ? o.item.allergens : o.item.allergensAll) || [];

export function allergenPills(codes) {
  return codes.length ? html`${codes.map((c) => html`<span class="pill warn" style="margin:0 6px 6px 0">${icon('alert')}${t(`allergen.${c}`)}</span>`)}`
    : html`<span class="small muted">${t('sop.noAllergens')}</span>`;
}

/** Recipe lines as { name, qty, unit } scaled by n portions / batches. */
function scaledLines(boot, o, n) {
  const ings = Object.fromEntries(boot.ingredients.map((i) => [i.id, i]));
  const lines = o.kind === 'dish'
    ? o.item.recipe.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit || l.stockUnit }))
    : (o.item.prepLines || []).map((l) => {
      const ing = ings[l.ingredientId] || {};
      return { name: ing.name || '?', qty: l.qty, unit: l.unit || ing.unit || '' };
    });
  return lines.map((l) => {
    const h = C().humanQty(l.qty * n, l.unit);
    return { name: l.name, qty: h.qty, unit: h.unit };
  });
}

/** The SOP itself, shared by the sheet and the printout. */
function sopBody(boot, o, steps, n) {
  const it = o.item;
  const minutes = (Number(it.prepMinutes) || 0) + steps.reduce((a, s) => a + (Number(s.minutes) || 0), 0);
  const yieldText = o.kind === 'dish' ? t('sop.yieldDish', { n })
    : (() => { const h = C().humanQty((Number(it.batchQty) || 0) * n, it.unit); return t('sop.yieldPrep', { n, qty: number(h.qty, 3), unit: unitLabel(h.unit) }); })();
  const notes = [['sop.portionNote', it.portionNote], ['sop.holdingNote', it.holdingNote], ['sop.equipment', it.equipment]].filter(([, v]) => v);
  return html`
    <div class="sop-head"><h3 style="margin:0 0 4px">${it.name}</h3>
      <div class="small muted">${yieldText}${minutes ? ` · ${t('sop.minutes', { n: minutes })}` : ''}${o.kind === 'prep' && it.shelfLifeDays ? ` · ${t('sop.shelfLife', { n: it.shelfLifeDays })}` : ''}</div>
      ${safeHref(it.photoUrl) ? html`<a class="link small no-print" href="${safeHref(it.photoUrl)}" target="_blank" rel="noopener">${icon('info')} ${t('sop.photo')}</a>` : ''}</div>
    <div class="section-head" style="margin-top:12px"><h2 style="font-size:15px">${t('sop.allergens')}</h2></div>
    <div>${allergenPills(allergensOf(o))}</div>
    <div class="section-head" style="margin-top:12px"><h2 style="font-size:15px">${t('sop.ingredients')}</h2></div>
    <div class="card"><ul class="list">${scaledLines(boot, o, n).map((l) => html`<li class="pl-row"><span>${l.name}</span>
      <b class="tabular">${number(l.qty, 3)} ${unitLabel(l.unit)}</b></li>`)}</ul></div>
    <div class="section-head" style="margin-top:12px"><h2 style="font-size:15px">${t('sop.steps')}</h2></div>
    ${steps.length ? html`<ol class="sop-steps">${steps.map((s) => html`<li class="sop-step${s.critical ? ' critical' : ''}">
      <div>${s.critical ? html`<span class="pill bad" style="margin-right:6px">${icon('alert')}${t('sop.critical')}</span>` : ''}${s.text}</div>
      ${s.minutes || s.imageUrl ? html`<div class="small muted" style="margin-top:4px">${s.minutes ? t('sop.minutes', { n: s.minutes }) : ''}
        ${safeHref(s.imageUrl) ? html`<a class="link no-print" href="${safeHref(s.imageUrl)}" target="_blank" rel="noopener" style="margin-left:6px">${t('sop.photo')}</a>` : ''}</div>` : ''}
    </li>`)}</ol>` : html`<p class="small muted">${t('sop.noSteps')}</p>`}
    ${notes.length ? html`<div class="card" style="margin-top:12px">${notes.map(([k, v]) => html`<div class="pl-row" style="align-items:flex-start"><span>${t(k)}</span><span style="text-align:right">${v}</span></div>`)}</div>` : ''}`;
}

function shareText(boot, o, steps, n) {
  const lines = scaledLines(boot, o, n).map((l) => `• ${l.name}: ${number(l.qty, 3)} ${unitLabel(l.unit)}`);
  const st = steps.map((s, i) => `${i + 1}. ${s.critical ? '⚠ ' : ''}${s.text}`);
  const al = allergensOf(o).map((c) => t(`allergen.${c}`)).join(', ') || t('sop.noAllergens');
  return [o.item.name, `${t('sop.allergens')}: ${al}`, '', t('sop.ingredients'), ...lines, '', t('sop.steps'), ...st].join('\n');
}

/** Print one or more SOPs, one per page; only the SOPs appear on paper. */
export function printSops(boot, ids, stepsMap, n = 1) {
  document.getElementById('print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  mount(root, html`${ids.map((id) => { const o = ownerOf(boot, id); return o ? html`<section class="sop-print">${sopBody(boot, o, stepsMap[id] || [], n)}</section>` : ''; })}`);
  document.body.append(root);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

export async function sopSheet(ctx, id) {
  const boot = ctx.state.boot;
  const o = ownerOf(boot, id);
  if (!o) return toast(t('sop.notFound'), 'bad');
  const steps = (await allSteps())[id] || [];
  let n = 1;
  openSheet({
    title: t('sop.title'),
    body: html`<div class="field" style="display:flex;gap:10px;align-items:center;justify-content:space-between">
        <span class="label" style="margin:0">${o.kind === 'dish' ? t('sop.portions') : t('sop.batches')}</span>
        <div class="stepper has-value"><button type="button" data-n="-1" aria-label="${t('sop.fewer')}">${icon('minus')}</button>
          <input type="number" inputmode="numeric" min="1" max="50" step="1" value="1" id="sop-n" aria-label="${o.kind === 'dish' ? t('sop.portions') : t('sop.batches')}">
          <button type="button" data-n="1" aria-label="${t('sop.more')}">${icon('plus')}</button></div></div>
      <div id="sop-body"></div>`,
    foot: html`<button class="btn" data-sop="print">${t('sop.print')}</button><button class="btn" data-sop="share">${t('sop.share')}</button>
      ${ctx.can('manager') ? html`<button class="btn primary" data-sop="edit">${icon('edit')}${t('sop.edit')}</button>` : ''}`,
    onMount(el, close) {
      const draw = () => mount(el.querySelector('#sop-body'), sopBody(boot, o, steps, n));
      const input = el.querySelector('#sop-n');
      const set = (v) => { n = Math.min(50, Math.max(1, Math.round(Number(v) || 1))); input.value = n; draw(); };
      $$('[data-n]', el).forEach((b) => b.addEventListener('click', () => set(n + Number(b.dataset.n))));
      input.addEventListener('input', () => set(input.value));
      $$('[data-sop]', el).forEach((b) => b.addEventListener('click', async () => {
        if (b.dataset.sop === 'print') return printSops(boot, [id], { [id]: steps }, n);
        if (b.dataset.sop === 'edit') { close(); return sopEditor(ctx, id); }
        const text = shareText(boot, o, steps, n);
        try {
          if (navigator.share) await navigator.share({ title: o.item.name, text });
          else { await navigator.clipboard.writeText(text); toast(t('sop.copied')); }
        } catch (e) { if (e && e.name !== 'AbortError') toast(t('sop.shareFailed'), 'bad'); }
      }));
      draw();
    },
  });
}

export async function sopEditor(ctx, id, onSaved) {
  const boot = ctx.state.boot;
  const o = ownerOf(boot, id);
  if (!o) return;
  const it = o.item;
  let steps = ((await allSteps())[id] || []).map((s) => ({ ...s }));
  const stepHtml = (s, i) => html`<div class="line-item" data-step="${i}">
    <div class="line-head"><span>${t('sop.stepN', { n: i + 1 })}</span>
      <span><button type="button" class="icon-btn" data-mv="-1" aria-label="${t('sop.moveUp', { n: i + 1 })}" ${i === 0 ? raw('disabled') : ''}>${icon('chevL')}</button>
      <button type="button" class="icon-btn" data-mv="1" aria-label="${t('sop.moveDown', { n: i + 1 })}" ${i === steps.length - 1 ? raw('disabled') : ''}>${icon('chevR')}</button>
      <button type="button" class="icon-btn" data-rm aria-label="${t('sop.removeStep', { n: i + 1 })}">${icon('x')}</button></span></div>
    <textarea class="textarea" data-f="text" maxlength="500" aria-label="${t('sop.stepN', { n: i + 1 })}" placeholder="${t('sop.stepPlaceholder')}">${s.text || ''}</textarea>
    <div class="form-row" style="margin-top:8px">
      <label><span class="label small muted">${t('sop.stepMinutes')}</span><input class="input" data-f="minutes" type="number" inputmode="numeric" min="0" step="1" value="${s.minutes ?? ''}"></label>
      <label><span class="label small muted">${t('sop.imageLink')}</span><input class="input" data-f="imageUrl" type="url" value="${s.imageUrl || ''}" placeholder="https://"></label>
    </div>
    <label class="check"><input type="checkbox" data-f="critical" ${s.critical ? raw('checked') : ''}> ${t('sop.criticalCheck')}</label>
  </div>`;
  openSheet({
    title: t('sop.editTitle', { name: it.name }),
    body: html`<form id="sf" novalidate>
      <div class="form-row">
        <label class="field"><span class="label">${t('sop.prepMinutes')}</span><input class="input" name="prepMinutes" type="number" inputmode="numeric" min="0" step="1" value="${it.prepMinutes ?? ''}"></label>
        <label class="field"><span class="label">${t('sop.photoLink')}</span><input class="input" name="photoUrl" type="url" value="${it.photoUrl || ''}" placeholder="https://"></label>
      </div>
      <label class="field"><span class="label">${t('sop.portionNote')}</span><input class="input" name="portionNote" maxlength="300" value="${it.portionNote || ''}"></label>
      <label class="field"><span class="label">${t('sop.holdingNote')}</span><input class="input" name="holdingNote" maxlength="300" value="${it.holdingNote || ''}"></label>
      <label class="field"><span class="label">${t('sop.equipment')}</span><input class="input" name="equipment" maxlength="300" value="${it.equipment || ''}"></label>
      <div class="section-head" style="margin-top:6px"><h2 style="font-size:15px">${t('sop.steps')}</h2></div>
      <p class="small muted" style="margin:-4px 2px 10px">${t('sop.stepsHelp')}</p>
      <div id="steps"></div>
      <button type="button" class="btn sm" id="add-step">${icon('plus')}${t('sop.addStep')}</button>
      <p class="small muted" style="margin:12px 2px 0">${t('sop.allergenHelp')}</p>
    </form>`,
    foot: html`<button class="btn primary block" id="save">${t('common.saveChanges')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#sf');
      const host = el.querySelector('#steps');
      const read = () => $$('[data-step]', host).map((w) => ({
        text: w.querySelector('[data-f=text]').value, minutes: w.querySelector('[data-f=minutes]').value,
        imageUrl: w.querySelector('[data-f=imageUrl]').value, critical: w.querySelector('[data-f=critical]').checked,
      }));
      const draw = () => {
        mount(host, html`${steps.map((s, i) => stepHtml(s, i))}`);
        $$('[data-step]', host).forEach((w) => {
          const i = Number(w.dataset.step);
          w.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', () => {
            steps = read();
            const j = i + Number(b.dataset.mv);
            [steps[i], steps[j]] = [steps[j], steps[i]];
            draw();
            host.querySelector(`[data-step="${j}"] [data-f=text]`).focus();
          }));
          w.querySelector('[data-rm]').addEventListener('click', () => { steps = read(); steps.splice(i, 1); draw(); });
        });
      };
      el.querySelector('#add-step').addEventListener('click', () => {
        steps = read(); steps.push({ text: '' }); draw();
        host.querySelector(`[data-step="${steps.length - 1}"] [data-f=text]`).focus();
      });
      draw();
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const payload = { ownerId: id, version: it.version, steps: read().filter((s) => s.text.trim() || s.minutes || s.imageUrl),
          notes: { portionNote: form.portionNote.value, holdingNote: form.holdingNote.value, equipment: form.equipment.value,
            prepMinutes: form.prepMinutes.value, photoUrl: form.photoUrl.value } };
        try { await call('sop.save', payload); } catch (err) { if (err.code === 'CONFLICT') await ctx.refresh(); throw err; }
        close();
        toast(t('sop.saved'));
        await ctx.refresh();
        if (onSaved) onSaved(); else sopSheet(ctx, id);
      }, form));
    },
  });
}

/** More → Kitchen → SOP manual: every dish and prep, with step counts and allergens. */
export async function renderManual(ctx) {
  const { el, setTitle, state } = ctx;
  setTitle(t('sop.manual'), { back: true });
  const boot = state.boot;
  const steps = await allSteps();
  if (ctx.stale()) return;
  const dishes = boot.menu.filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name));
  const preps = boot.ingredients.filter((i) => i.active && i.kind === 'prep').sort((a, b) => a.name.localeCompare(b.name));
  let q = '';
  mount(el, html`
    <p class="small muted" style="margin:4px 4px 12px">${t('sop.manualHelp')}</p>
    <div class="search">${icon('search')}<input class="input" type="search" id="mq" placeholder="${t('sop.search')}" aria-label="${t('sop.search')}"></div>
    <button class="btn block" id="print-all" style="margin-bottom:12px">${t('sop.printAll')}</button>
    <div id="manual"></div>`);
  const row = (o) => {
    const n = (steps[o.item.id] || []).length;
    const al = allergensOf(o);
    return html`<li><button class="row" data-sop="${o.item.id}">
      <span class="grow"><div class="title">${o.item.name}</div>
        <div class="sub">${n ? t('sop.nSteps', { n }) : t('sop.noStepsShort')}${al.length ? ' · ' + al.map((c) => t(`allergen.${c}`)).join(', ') : ''}</div></span>
      ${n ? '' : html`<span class="pill warn">${t('sop.todo')}</span>`}${icon('chevR', 'chev')}</button></li>`;
  };
  const draw = () => {
    const match = (x) => !q || x.name.toLowerCase().includes(q);
    const d = dishes.filter(match).map((item) => ({ kind: 'dish', item }));
    const p = preps.filter(match).map((item) => ({ kind: 'prep', item }));
    mount(el.querySelector('#manual'), d.length || p.length ? html`
      ${d.length ? html`<section class="section"><div class="section-head"><h2>${t('menu.tabDishes')}</h2></div><div class="card"><ul class="list">${d.map(row)}</ul></div></section>` : ''}
      ${p.length ? html`<section class="section"><div class="section-head"><h2>${t('menu.tabPreps')}</h2></div><div class="card"><ul class="list">${p.map(row)}</ul></div></section>` : ''}`
      : html`<div class="card">${emptyState('chef', t('common.noMatch'), '')}</div>`);
    $$('[data-sop]', el).forEach((b) => b.addEventListener('click', () => sopSheet(ctx, b.dataset.sop)));
  };
  el.querySelector('#mq').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
  el.querySelector('#print-all').addEventListener('click', () => printSops(boot, [...dishes, ...preps].map((x) => x.id), steps));
  draw();
}
