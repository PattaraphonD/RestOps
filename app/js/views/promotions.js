// Menu → Promotions: running, upcoming, draft and finished promotions, their profit check, and results.
import { call } from '../api.js';
import { html, mount, icon, money, number, pct, today, fmtDate, $$, openSheet, confirmSheet, toast, busy, emptyState } from '../ui.js';
import { t } from '../i18n.js';
import { promoBuilder, offerCheck, verdictPill, valueText, econTables, reason } from './promo-builder.js';
import { promoChart } from '../charts.js';

const GROUPS = [['active', 'promo.group.active'], ['scheduled', 'promo.group.scheduled'], ['draft', 'promo.group.draft'], ['ended', 'promo.group.ended']];
const RANK = { loss: 0, thin: 1, profitable: 2 };

function when(p) {
  if (p.endDate) return t('promo.until', { date: fmtDate(p.endDate) });
  return t('promo.from', { date: fmtDate(p.startDate) });
}
function channelNames(boot, p) {
  if (!p.channelIds.length) return t('promo.allChannels');
  return p.channelIds.map((id) => ((boot.channels || []).find((c) => c.id === id) || {}).name).filter(Boolean).join(', ');
}

export async function renderPromotions(ctx, host) {
  const boot = ctx.state.boot;
  mount(host, html`<div style="display:flex;gap:10px;margin:2px 0 14px">
      <button class="btn primary grow" id="pr-new">${icon('plus')}${t('promo.new')}</button>
      <button class="btn grow" id="pr-offer">${icon('truck')}${t('offer.short')}</button></div>
    <div id="pr-list"><div class="skeleton" style="height:180px"></div></div>`);
  const redraw = () => renderPromotions(ctx, host);
  host.querySelector('#pr-new').addEventListener('click', () => promoBuilder(ctx, null, { onSaved: redraw }));
  host.querySelector('#pr-offer').addEventListener('click', () => offerCheck(ctx, null, { onSaved: redraw }));
  const rows = await call('promotions.list', { today: today() });
  const box = host.querySelector('#pr-list');
  if (ctx.stale() || !box) return;
  if (!rows.length) { mount(box, html`<div class="card">${emptyState('receipt', t('promo.noneTitle'), t('promo.noneText'))}</div>`); return; }
  const group = (st) => rows.filter((r) => (st === 'ended' ? r.status === 'ended' || r.status === 'cancelled' : r.status === st));
  mount(box, html`${GROUPS.map(([st, label]) => {
    const list = group(st);
    if (!list.length) return '';
    return html`<section class="section"><div class="section-head"><h2>${t(label)}</h2><span class="small muted">${list.length}</span></div>
      <div class="card"><ul class="list">${list.map((p) => {
        const worst = p.economics.slice().sort((a, b) => RANK[a.verdict] - RANK[b.verdict])[0];
        return html`<li><button class="row" data-id="${p.id}" style="${p.status === 'cancelled' ? 'opacity:.6' : ''}">
          <span class="grow"><div class="title">${p.name}</div>
            <div class="sub">${valueText(p)} · ${channelNames(boot, p)} · ${when(p)}</div>
            ${worst && worst.uplift ? html`<div class="sub">${t('promo.reason.uplift', { pct: pct(worst.uplift * 100, 0) })}</div>` : ''}</span>
          <span class="value">${p.status === 'cancelled' ? html`<span class="pill">${t('promo.status.cancelled')}</span>` : worst ? verdictPill(worst.verdict) : ''}</span>
        </button></li>`;
      })}</ul></div></section>`;
  })}`);
  $$('[data-id]', box).forEach((b) => b.addEventListener('click', () => detailSheet(ctx, b.dataset.id, redraw)));
}

async function detailSheet(ctx, id, redraw) {
  const boot = ctx.state.boot;
  const p = await call('promotions.get', { id, today: today() });
  const canEdit = ['draft', 'scheduled', 'active'].includes(p.status);
  const canCancel = ['draft', 'scheduled', 'active'].includes(p.status);
  const hasResults = p.status === 'active' || p.status === 'ended';
  openSheet({
    title: p.name,
    body: html`<div class="card" style="margin-bottom:12px">
        <div class="pl-row"><span>${t('common.status')}</span><b>${t(`promo.status.${p.status}`)}</b></div>
        <div class="pl-row"><span>${t('promo.offer')}</span><b>${valueText(p)}</b></div>
        <div class="pl-row"><span>${t('promo.channels')}</span><span>${channelNames(boot, p)}</span></div>
        <div class="pl-row"><span>${t('promo.dates')}</span><span>${fmtDate(p.startDate)} – ${p.endDate ? fmtDate(p.endDate) : t('promo.noEnd')}</span></div>
        ${p.platformFundedPct ? html`<div class="pl-row"><span>${t('promo.platformShare')}</span><span>${pct(p.platformFundedPct, 0)}</span></div>` : ''}
        ${p.campaignCommissionPct !== null ? html`<div class="pl-row"><span>${t('promo.campaignCommission')}</span><span>${pct(p.campaignCommissionPct, 1)}</span></div>` : ''}
        <div class="pl-row"><span>${t('promo.dishes')}</span><span>${p.items.map((i) => (p.type === 'bundle' && i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)).join(', ')}</span></div>
      </div>
      <div class="section-head" style="margin-top:0"><h2 style="font-size:15px">${t('promo.profitCheck')}</h2></div>
      ${econTables(p.channels)}`,
    foot: html`${hasResults ? html`<button class="btn" data-act="results">${icon('chart')}${t('promo.results')}</button>` : ''}
      ${canEdit ? html`<button class="btn" data-act="edit">${icon('edit')}${t('promo.editShort')}</button>` : ''}
      ${canCancel ? html`<button class="btn danger" data-act="cancel">${t('promo.cancel')}</button>` : ''}`,
    onMount(el, close) {
      $$('[data-act]', el).forEach((b) => b.addEventListener('click', async () => {
        if (b.dataset.act === 'results') { close(); resultsSheet(ctx, p); return; }
        if (b.dataset.act === 'edit') { close(); promoBuilder(ctx, p, { onSaved: redraw }); return; }
        const ok = await confirmSheet({ title: t('promo.cancelTitle'), message: t('promo.cancelMessage', { name: p.name }), confirm: t('promo.cancel'), danger: true });
        if (!ok) return;
        await busy(b, async () => {
          await call('promotions.cancel', { id: p.id });
          close();
          toast(t('promo.cancelled'));
          await ctx.refresh();
          redraw();
        });
      }));
    },
  });
}

const VERDICT = { worked: 'good', soldMoreEarnedLess: 'warn', didNotWork: 'bad', tooEarly: '', noBaseline: '' };
const change = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${number(v, 1)}%`);

export async function resultsSheet(ctx, p) {
  const r = await call('promotions.results', { id: p.id, today: today() });
  const row = (label, a, b, c, fmt) => html`<div class="pl-row"><span>${label}</span>
    <span class="tabular">${fmt(a)} → <b>${fmt(b)}</b> <span class="small ${c === null ? 'muted' : c >= 0 ? 'good-text' : 'bad-text'}" style="color:${c === null ? '' : c >= 0 ? 'var(--good-ink)' : 'var(--bad-ink)'}">${change(c)}</span></span></div>`;
  const m = (v) => money(v, { cents: false });
  const u = (v) => number(v, 1);
  openSheet({
    title: t('promo.resultsTitle', { name: p.name }),
    body: html`
      <div class="card pad" style="margin-bottom:12px">
        <span class="pill ${VERDICT[r.verdict]}">${icon(r.verdict === 'worked' ? 'check' : r.verdict === 'tooEarly' || r.verdict === 'noBaseline' ? 'info' : 'alert')}${t(`promo.result.${r.verdict}`, { pct: change(r.restaurant.change.cm) })}</span>
        <p class="small muted" style="margin:8px 0 0">${t('promo.resultsPeriod', { from: fmtDate(r.period.from), to: fmtDate(r.period.to), days: r.period.days,
          bfrom: fmtDate(r.baseline.from), bto: fmtDate(r.baseline.to) })}</p>
        ${r.weak ? html`<p class="small" style="margin:8px 0 0;color:var(--warn-ink)">${icon('alert')} ${t('promo.weak', { n: r.baseline.daysWithSales })}</p>` : ''}
      </div>
      <div class="section-head" style="margin-top:0"><h2 style="font-size:15px">${t('promo.promotedDishes')}</h2><span class="small muted">${t('promo.perDay')}</span></div>
      <div class="card" style="margin-bottom:12px">
        ${row(t('promo.units'), r.promoted.before.units, r.promoted.during.units, r.promoted.change.units, u)}
        ${row(t('home.revenue'), r.promoted.before.revenue, r.promoted.during.revenue, r.promoted.change.revenue, m)}
        ${row(t('promo.marginRow'), r.promoted.before.cm, r.promoted.during.cm, r.promoted.change.cm, m)}
      </div>
      <div class="section-head" style="margin-top:0"><h2 style="font-size:15px">${t('promo.wholeRestaurant')}</h2><span class="small muted">${t('promo.perDay')}</span></div>
      <div class="card" style="margin-bottom:12px">
        ${row(t('home.revenue'), r.restaurant.before.revenue, r.restaurant.during.revenue, r.restaurant.change.revenue, m)}
        ${row(t('promo.marginRow'), r.restaurant.before.cm, r.restaurant.during.cm, r.restaurant.change.cm, m)}
      </div>
      <p class="small muted" style="margin:-4px 4px 10px">${t('promo.wholeHelp')}</p>
      <div class="card pad"><div id="pr-chart"></div></div>`,
    onMount(el) {
      const c = el.querySelector('#pr-chart');
      if (c) promoChart(c, r.daily, { baseline: r.promoted.before.cm, label: t('promo.chartLabel', { name: p.name }) });
    },
  });
  void reason;
}
