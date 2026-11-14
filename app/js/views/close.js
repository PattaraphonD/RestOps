// Close the day: the end-of-service routine — sales, waste, a quick count of key items, then close.
import { call } from '../api.js';
import { html, mount, icon, money, pct, number, today, fmtDate, timeOf, $$, toast, busy } from '../ui.js';
import { t } from '../i18n.js';
import { openSales } from './sales.js';
import { openEntry } from './stock.js';

const KEY_ITEMS = 10;
const skipKey = (date, step) => `ro.close.${date}.${step}`;
const skipped = (date, step) => { try { return sessionStorage.getItem(skipKey(date, step)) === '1'; } catch { return false; } };
const skip = (date, step) => { try { sessionStorage.setItem(skipKey(date, step), '1'); } catch { /* ignore */ } };

/** Items worth counting every night: preps kept in stock, then the most valuable stock. */
function keyItems(boot) {
  const active = boot.ingredients.filter((i) => i.active);
  const preps = active.filter((i) => i.kind === 'prep' && i.trackStock);
  const rest = active.filter((i) => i.kind !== 'prep').sort((a, b) => b.value - a.value).slice(0, KEY_ITEMS);
  return [...preps, ...rest];
}

export async function render(ctx) {
  const { el, params, setTitle, state } = ctx;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params[0] || '') && params[0] <= today() ? params[0] : today();
  setTitle(t('close.title'), { back: true, eyebrow: fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }) });
  mount(el, html`<div class="skeleton" style="height:320px;margin-top:8px"></div>`);
  const [sales, waste, counts, status] = await Promise.all([
    call('sales.list', { from: date, to: date }),
    call('movements.list', { from: date, to: date, type: 'waste' }),
    call('movements.list', { from: date, to: date, type: 'count' }),
    call('day.status', { date }),
  ]);
  if (ctx.stale()) return;
  const boot = state.boot;
  const live = (rows) => rows.filter((r) => !r.voided);
  const wasteRows = live(waste), countRows = live(counts);
  const wasteValue = Math.abs(wasteRows.reduce((a, r) => a + r.value, 0));
  const foodPct = sales.total ? sales.cost / sales.total * 100 : null;
  const steps = [
    { key: 'sales', icon: 'receipt', done: sales.dishes > 0, info: sales.dishes ? t('close.salesInfo', { total: money(sales.total), n: number(sales.dishes, 0) }) : t('close.salesNone') },
    { key: 'waste', icon: 'waste', done: wasteRows.length > 0 || skipped(date, 'waste'),
      info: wasteRows.length ? t('close.wasteInfo', { n: wasteRows.length, value: money(wasteValue) }) : skipped(date, 'waste') ? t('close.wasteNone') : t('close.wastePending') },
    { key: 'count', icon: 'clipboard', done: countRows.length > 0 || skipped(date, 'count') || skipped(date, 'counted'),
      info: countRows.length ? t('close.countInfo', { n: countRows.length }) : skipped(date, 'counted') ? t('close.countMatched')
        : skipped(date, 'count') ? t('close.countSkipped') : t('close.countPending', { n: keyItems(boot).length }) },
  ];
  const ready = steps.filter((s) => s.done).length;
  const redraw = () => render(ctx);

  mount(el, html`
    ${status.closed ? html`<div class="card pad" style="margin-top:4px;border-left:4px solid var(--good)">
      <b>${icon('check')} ${t('close.closedBanner', { who: status.closedBy, time: timeOf(status.closedAt) })}</b>
      ${status.note ? html`<div class="small muted" style="margin-top:4px">${status.note}</div>` : ''}
      <div class="small muted" style="margin-top:4px">${t('close.reclose')}</div></div>` : html`<p class="small muted" style="margin:4px 4px 12px">${t('close.help')}</p>`}
    <div class="close-progress" aria-label="${t('close.progress', { done: ready, total: steps.length })}">${steps.map((s) => html`<span class="${s.done ? 'on' : ''}"></span>`)}</div>
    <div class="grid-2">${steps.map((s, i) => html`<section class="card pad close-step${s.done ? ' done' : ''}" style="margin-bottom:12px">
      <div style="display:flex;gap:12px;align-items:flex-start">
        <span class="avatar ${s.done ? 'good' : 'brand'}">${icon(s.done ? 'check' : s.icon)}</span>
        <div class="grow"><div class="small muted">${t('close.stepN', { n: i + 1 })}</div><b>${t(`close.step.${s.key}`)}</b>
          <div class="small" style="margin-top:4px">${s.info}</div></div></div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn ${s.done ? '' : 'primary'} grow" data-go="${s.key}">${t(`close.action.${s.key}`)}</button>
        ${s.key !== 'sales' && !s.done ? html`<button class="btn ghost" data-skip="${s.key}">${t(`close.skip.${s.key}`)}</button>` : ''}
      </div></section>`)}</div>
    <section class="card pad" style="margin-top:4px">
      <b>${t('close.summary')}</b>
      <div class="pl-row" style="padding-left:0;padding-right:0"><span>${t('close.sumSales')}</span><b>${money(sales.total)}</b></div>
      <div class="pl-row" style="padding-left:0;padding-right:0"><span>${t('home.foodCost')}</span><span>${pct(foodPct)}</span></div>
      <div class="pl-row" style="padding-left:0;padding-right:0"><span>${t('close.sumWaste')}</span><span>${money(wasteValue)}</span></div>
      <div class="pl-row" style="padding-left:0;padding-right:0"><span>${t('close.sumCount')}</span><span>${countRows.length}</span></div>
      <label class="field" style="margin-top:8px"><span class="label">${t('close.note')}</span>
        <input class="input" id="close-note" maxlength="300" placeholder="${t('close.notePlaceholder')}" value="${status.note || ''}"></label>
      ${ready < steps.length ? html`<p class="small" style="color:var(--warn-ink);margin:0 0 10px">${icon('alert')} ${t('close.notAllDone')}</p>` : ''}
      <button class="btn primary block" id="do-close">${icon('check')}${status.closed ? t('close.recloseBtn') : t('close.closeBtn')}</button>
    </section>`);

  $$('[data-go]', el).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.go === 'sales') return openSales(ctx, { date, onSaved: redraw });
    if (b.dataset.go === 'waste') return openEntry(ctx, 'waste', null, { date, onSaved: redraw });
    // A count that matches the system records nothing, so remember that it was done.
    return openEntry(ctx, 'count', null, { date, initialIds: keyItems(boot).map((i) => i.id), onSaved: () => { skip(date, 'counted'); redraw(); } });
  }));
  $$('[data-skip]', el).forEach((b) => b.addEventListener('click', () => { skip(date, b.dataset.skip); redraw(); }));
  el.querySelector('#do-close').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    await call('day.close', { date, today: today(), note: el.querySelector('#close-note').value });
    toast(t('close.done'));
    await ctx.refresh();
    redraw();
  }));
}
