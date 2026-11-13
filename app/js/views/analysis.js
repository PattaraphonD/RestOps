// Menu analysis (menu engineering): which dishes make money and which need adjusting.
import { call } from '../api.js';
import { html, raw, mount, icon, money, number, pct, today, addDays, $$, emptyState } from '../ui.js';
import { t } from '../i18n.js';
import { quadrantChart } from '../charts.js';

const CLASSES = ['star', 'plowhorse', 'puzzle', 'dog'];
const ui = { period: 'last4w', from: '', to: '', channelId: '', includePromo: false };

function range() {
  const d = today();
  if (ui.period === 'thisMonth') return [d.slice(0, 7) + '-01', d];
  if (ui.period === 'lastMonth') {
    const first = d.slice(0, 7) + '-01';
    const last = addDays(first, -1);
    return [last.slice(0, 7) + '-01', last];
  }
  if (ui.period === 'custom' && ui.from && ui.to) return ui.from <= ui.to ? [ui.from, ui.to] : [ui.to, ui.from];
  return [addDays(d, -27), d];
}

export async function renderAnalysis(ctx, host, { openDish } = {}) {
  const boot = ctx.state.boot;
  const [from, to] = range();
  if (ui.period === 'custom' && !ui.from) { ui.from = from; ui.to = to; }
  const channels = boot.channels || [];
  mount(host, html`
    <div class="chips" role="group" aria-label="${t('analysis.period')}" style="margin-top:2px">
      ${['last4w', 'thisMonth', 'lastMonth', 'custom'].map((p) => html`<button class="chip" data-period="${p}" aria-pressed="${ui.period === p}">${t(`analysis.${p}`)}</button>`)}
    </div>
    ${ui.period === 'custom' ? html`<div class="form-row">
      <label class="field"><span class="label">${t('analysis.from')}</span><input class="input" type="date" name="from" value="${ui.from}" max="${today()}"></label>
      <label class="field"><span class="label">${t('analysis.to')}</span><input class="input" type="date" name="to" value="${ui.to}" max="${today()}"></label></div>` : ''}
    <div class="form-row" style="align-items:end">
      <label class="field"><span class="label">${t('analysis.channel')}</span><select class="select" name="channel">
        <option value="">${t('analysis.allChannels')}</option>
        ${channels.map((c) => html`<option value="${c.id}" ${c.id === ui.channelId ? raw('selected') : ''}>${c.name}${c.active ? '' : ` (${t('channels.off')})`}</option>`)}</select></label>
      <label class="check" style="margin-bottom:14px"><input type="checkbox" name="promo" ${ui.includePromo ? raw('checked') : ''}> ${t('analysis.includePromo')}</label>
    </div>
    <div id="an-body"><div class="skeleton" style="height:280px"></div></div>`);
  const redraw = () => renderAnalysis(ctx, host, { openDish });
  $$('[data-period]', host).forEach((b) => b.addEventListener('click', () => { ui.period = b.dataset.period; redraw(); }));
  ['from', 'to'].forEach((n) => { const i = host.querySelector(`[name=${n}]`); if (i) i.addEventListener('change', () => { ui[n] = i.value; redraw(); }); });
  host.querySelector('[name=channel]').addEventListener('change', (e) => { ui.channelId = e.target.value; redraw(); });
  host.querySelector('[name=promo]').addEventListener('change', (e) => { ui.includePromo = e.target.checked; redraw(); });

  const a = await call('menu.analysis', { from, to, channelId: ui.channelId, includePromo: ui.includePromo });
  const body = host.querySelector('#an-body');
  if (ctx.stale() || !body) return;
  if (!a.items.length) { mount(body, html`<div class="card">${emptyState('chart', t('analysis.noneTitle'), t('analysis.noneText'))}</div>`); return; }
  const target = Number(boot.settings.targetFoodCostPct) || 30;
  const labels = Object.fromEntries(CLASSES.map((c) => [c, t(`analysis.cls.${c}`)]));
  const groups = CLASSES.map((c) => ({ c, items: a.items.filter((i) => i.cls === c) })).filter((g) => g.items.length);
  mount(body, html`
    ${a.indicative ? html`<div class="card pad" style="margin-bottom:12px;border-left:4px solid var(--warn)">
      <span class="small">${icon('info')} ${t('analysis.indicative', { n: number(a.dishesSold, 0), days: a.days })}</span></div>` : ''}
    <div class="card pad"><div id="quad"></div>
      <p class="small muted" style="margin:8px 0 0">${t('analysis.lines', { pct: pct(a.threshold), amount: money(a.avgCm) })}</p></div>
    ${groups.map((g) => html`<section class="section">
      <div class="section-head"><h2>${labels[g.c]} <span class="muted small" style="font-weight:400">· ${t(`analysis.hint.${g.c}`)}</span></h2>
        <span class="small muted">${g.items.length}</span></div>
      <p class="small" style="margin:-4px 4px 8px">${t(`analysis.rec.${g.c}`)}</p>
      <div class="card"><ul class="list">${g.items.map((i) => html`<li><button class="row" data-dish="${i.menuItemId}">
        <span class="grow"><div class="title">${i.name}</div>
          <div class="sub">${t('analysis.row', { qty: number(i.qty, 0), mix: pct(i.mixPct), cm: money(i.cmPerDish) })}</div></span>
        <span class="value">${i.overTarget ? html`<span class="pill bad">${icon('alert')}${t('analysis.overTarget', { pct: pct(i.foodCostPct) })}</span>`
          : html`<span class="pill good">${pct(i.foodCostPct)}</span>`}</span></button></li>`)}</ul></div>
    </section>`)}
    <p class="small muted" style="margin:10px 4px">${t('analysis.help', { n: target })}</p>`);
  const quad = body.querySelector('#quad');
  quadrantChart(quad, a.items, {
    avgCm: a.avgCm, threshold: a.threshold,
    labels: { ...labels, x: t('analysis.axisX'), y: t('analysis.axisY'), chart: t('analysis.chartLabel', { n: a.items.length }),
      desc: CLASSES.map((c) => `${labels[c]}: ${a.items.filter((i) => i.cls === c).map((i) => i.name).join(', ') || '—'}`).join('. ') },
  });
  const open = (id) => { const m = boot.menu.find((x) => x.id === id); if (m && openDish) openDish(m); };
  quad.addEventListener('pick', (e) => open(e.detail));
  $$('[data-dish]', body).forEach((b) => b.addEventListener('click', () => open(b.dataset.dish)));
}
