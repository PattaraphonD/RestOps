// Home: dashboard (managers/owners) or today's overview (staff).
import { call } from '../api.js';
import { html, mount, icon, money, pct, today, addDays, fmtMonth, fmtDate, timeOf, number, $, $$, emptyState, printHtml } from '../ui.js';
import { produceSheet } from './production.js';
import { cashFlowChart, barList } from '../charts.js';
import { t } from '../i18n.js';

let month = null;
let anchor = null; // the day shown, or a day in the week shown

const PERIODS = ['day', 'week', 'month'];
function getPeriod() { try { const p = localStorage.getItem('ro.home.period'); return PERIODS.includes(p) ? p : 'month'; } catch { return 'month'; } }
function setPeriod(p) { try { localStorage.setItem('ro.home.period', p); } catch { /* storage blocked */ } }
/** Monday–Sunday of the week containing d. */
function weekOf(d) {
  const dow = new Date(d + 'T00:00:00Z').getUTCDay();
  const from = addDays(d, -((dow + 6) % 7));
  return [from, addDays(from, 6)];
}
function weekLabel(from, to) {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return sameMonth
    ? `${Number(from.slice(8))}–${fmtDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${fmtDate(from, { day: 'numeric', month: 'short' })} – ${fmtDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function greeting(name) {
  const h = new Date().getHours();
  return t(h < 12 ? 'home.morning' : h < 17 ? 'home.afternoon' : 'home.evening', { name });
}

function delta(cur, prev, { lowerIsBetter = false, suffix = t('home.vsLastMonth') } = {}) {
  if (prev === null || prev === undefined || cur === null || cur === undefined) return html`<div class="delta">&nbsp;</div>`;
  if (!prev) return html`<div class="delta">${t('home.noDataLastMonth')}</div>`;
  const change = (cur - prev) / Math.abs(prev) * 100;
  if (Math.abs(change) < 0.05) return html`<div class="delta">${t('home.sameAsLast')}</div>`;
  const up = change > 0;
  const good = lowerIsBetter ? !up : up;
  return html`<div class="delta ${good ? 'up' : 'down'}">${icon(up ? 'arrowUp' : 'arrowDown')}
    ${number(Math.abs(change), 1)}% ${suffix}</div>`;
}

const tile = (href, ic, label) =>
  html`<a class="action-tile" href="${href}" style="text-decoration:none"><span class="avatar brand">${icon(ic)}</span>${label}</a>`;

const quickActions = (canManage) => html`
  <div class="actions-grid">
    ${tile('#/sales/new', 'receipt', t('nav.sales'))}
    ${tile('#/orders/receive', 'truck', t('po.receive'))}
    ${tile('#/stock/waste', 'waste', t('type.waste'))}
    ${canManage ? tile('#/more/expenses/new', 'wallet', t('home.expense')) : tile('#/more/sop', 'clipboard', t('sop.short'))}
  </div>`;

/* ------------------------------------------------------------ today */

const TASK = {
  deliveries: { icon: 'truck', cls: 'warn', href: () => '#/orders/receive' },
  invoices: { icon: 'receipt', cls: 'bad', href: () => '#/orders/invoices' },
  overdueBills: { icon: 'wallet', cls: 'bad', href: () => '#/orders/invoices' },
  lowStock: { icon: 'alert', cls: 'warn', href: () => '#/stock/low' },
  preps: { icon: 'chef', cls: 'warn', href: () => null },
  promotionsEnding: { icon: 'info', cls: '', href: () => '#/menu/promotions' },
  closeYesterday: { icon: 'clipboard', cls: 'bad', href: (x) => `#/close/${x.items[0].date}` },
  backup: { icon: 'download', cls: 'warn', href: () => '#/more/settings' },
};

/** "งานวันนี้": what this person should do now, each row one tap from the place to do it. */
function todayCard(sum, extra = []) {
  if (!sum) return '';
  const tasks = [...sum.tasks, ...extra];
  const row = (x) => {
    const m = TASK[x.kind] || { icon: 'info', cls: '', href: () => null };
    const sub = x.kind === 'preps' ? x.items.map((i) => i.name).join(', ')
      : x.kind === 'promotionsEnding' ? x.items.map((i) => `${i.name} (${fmtDate(i.endDate)})`).join(', ')
        : x.kind === 'closeYesterday' ? fmtDate(x.items[0].date, { weekday: 'long', day: 'numeric', month: 'long' })
          : x.kind === 'backup' ? (x.days === null ? t('today.backupNever') : t('today.backupDays', { n: x.days })) : (x.sub || '');
    const body = html`<span class="avatar ${m.cls}">${icon(m.icon)}</span>
      <span class="grow"><div class="title">${t(`today.task.${x.kind}`, { n: x.n })}</div>${sub ? html`<div class="sub">${sub}</div>` : ''}</span>${icon('chevR', 'chev')}`;
    const href = m.href(x);
    return html`<li>${href ? html`<a class="row" href="${href}">${body}</a>` : html`<button class="row" data-task="${x.kind}">${body}</button>`}</li>`;
  };
  const d = sum.day;
  return html`<section class="section today-card">
    <div class="section-head"><h2>${t('today.title')}</h2><span class="small muted">${fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
    <div class="card">
      ${tasks.length ? html`<ul class="list">${tasks.map(row)}</ul>`
        : html`<div class="row" style="min-height:64px"><span class="avatar good">${icon('check')}</span><span class="grow"><div class="title">${t('today.allClear')}</div><div class="sub">${t('today.allClearSub')}</div></span></div>`}
      <div style="padding:12px 14px;border-top:1px solid var(--line)">
        ${d.closed ? html`<a class="btn block" href="#/close">${icon('check')}${t('today.closed', { who: d.closedBy, time: timeOf(d.closedAt) })}</a>`
          : html`<a class="btn accent block" href="#/close">${icon('clipboard')}${t('today.closeDay')}</a>`}
      </div>
    </div></section>`;
}

const SETUP_HREF = { restaurant: '#/more/settings', channels: '#/more/channels', suppliers: '#/more/suppliers', ingredients: '#/stock', dishes: '#/menu', team: '#/more/team' };
function setupCard(setup) {
  let hidden = false;
  try { hidden = localStorage.getItem('ro.setup.hidden') === '1'; } catch { /* storage blocked */ }
  if (!setup || hidden || setup.done >= setup.total) return '';
  return html`<section class="section" id="setup-card"><div class="card pad">
    <div style="display:flex;align-items:center;gap:10px"><b class="grow">${t('setup.title')}</b>
      <span class="small muted">${t('setup.progress', { done: setup.done, total: setup.total })}</span>
      <button class="btn ghost sm" id="setup-hide">${t('setup.hide')}</button></div>
    <div class="cost-bar" style="margin:10px 0 12px" aria-hidden="true"><span style="width:${Math.round(setup.done / setup.total * 100)}%;background:var(--brand-bright)"></span></div>
    <ul class="list" style="margin:0 -14px -14px">${setup.steps.map((x) => html`<li><a class="row" href="${SETUP_HREF[x.key]}">
      <span class="avatar ${x.done ? 'good' : ''}">${icon(x.done ? 'check' : 'plus')}</span>
      <span class="grow"><div class="title" style="${x.done ? 'text-decoration:line-through;opacity:.6' : ''}">${t(`setup.step.${x.key}`)}</div>
        ${x.done ? '' : html`<div class="sub">${t(`setup.help.${x.key}`)}</div>`}</span>${x.done ? '' : icon('chevR', 'chev')}</a></li>`)}</ul>
  </div></section>`;
}
/** The Today tasks; null (no card) if the backend hasn't been redeployed with today.summary yet. */
function todaySummary(d) {
  return call('today.summary', { today: d }).catch((err) => { console.warn('today.summary', err); return null; });
}
function wireToday(ctx, host, sum) {
  $$('[data-task="preps"]', host).forEach((b) => b.addEventListener('click', () => {
    const p = (sum.tasks.find((x) => x.kind === 'preps') || { items: [] }).items[0];
    produceSheet(ctx, p && p.id);
  }));
  const hide = host.querySelector('#setup-hide');
  if (hide) hide.addEventListener('click', () => { try { localStorage.setItem('ro.setup.hidden', '1'); } catch { /* ignore */ } host.querySelector('#setup-card')?.remove(); });
}

export async function render(ctx) {
  const { el, state, setTitle, can } = ctx;
  const boot = state.boot;
  const firstName = boot.user.displayName.split(/[\s(]/)[0];
  setTitle(greeting(firstName));
  if (!can('manager')) return renderStaff(ctx);

  const period = getPeriod();
  const tday = today();
  month = month || tday.slice(0, 7);
  anchor = anchor && anchor <= tday ? anchor : tday;
  let label, sub, atLatest;
  if (period === 'month') {
    label = fmtMonth(month); sub = month === tday.slice(0, 7) ? t('home.monthToDate') : t('home.fullMonth'); atLatest = month >= tday.slice(0, 7);
  } else if (period === 'week') {
    const [from, to] = weekOf(anchor);
    label = weekLabel(from, to); atLatest = to >= tday;
    sub = atLatest ? t('home.weekToDate') : t('home.fullWeek');
  } else {
    label = fmtDate(anchor, { weekday: 'long', day: 'numeric', month: 'long' }); atLatest = anchor >= tday;
    sub = anchor === tday ? t('home.todayLabel') : anchor === addDays(tday, -1) ? t('home.yesterday') : fmtDate(anchor, { year: 'numeric' });
  }
  const unit = period === 'month' ? 'Month' : period === 'week' ? 'Week' : 'Day';
  mount(el, html`
    <div class="seg period-seg" role="group" aria-label="${t('home.period')}">${PERIODS.map((k) =>
      html`<button aria-pressed="${period === k}" data-period="${k}">${t(`home.period.${k}`)}</button>`)}</div>
    <div class="date-nav">
      <button class="icon-btn" data-m="-1" aria-label="${t(`home.prev${unit}`)}">${icon('chevL')}</button>
      <div class="date-label">${label}<div class="sub">${sub}${period !== 'month' && !atLatest
        ? html` · <button class="link-btn" data-today>${t(period === 'week' ? 'home.backToThisWeek' : 'home.backToToday')}</button>` : ''}</div></div>
      <button class="icon-btn" data-m="1" aria-label="${t(`home.next${unit}`)}" ${atLatest ? 'disabled' : ''} style="${atLatest ? 'opacity:.3' : ''}">${icon('chevR')}</button>
    </div>
    <div id="dash"><div class="skeleton" style="height:130px"></div><div class="skeleton" style="height:240px;margin-top:12px"></div></div>`);
  $$('[data-period]', el).forEach((b) => b.addEventListener('click', () => { setPeriod(b.dataset.period); render(ctx); }));
  el.querySelector('[data-today]')?.addEventListener('click', () => { anchor = tday; render(ctx); });
  el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    const step = Number(b.dataset.m);
    if (period === 'day') { const d = addDays(anchor, step); if (d > tday) return; anchor = d; return render(ctx); }
    if (period === 'week') { const d = addDays(anchor, step * 7); anchor = d > tday ? tday : d; return render(ctx); }
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + step, 1)).toISOString().slice(0, 7);
    if (d > tday.slice(0, 7)) return;
    month = d;
    render(ctx);
  }));
  if (period !== 'month') return renderPeriod(ctx, period, anchor);

  const [r, sum] = await Promise.all([call('reports.summary', { month, today: today() }),
    month === today().slice(0, 7) ? todaySummary(today()) : null]);
  if (ctx.stale() || !$('#dash')) return;
  const tot = r.totals, p = r.previous;
  const target = Number(boot.settings.targetFoodCostPct) || 30;
  const isCurrent = month === today().slice(0, 7);
  const foodCls = tot.foodCostPct === null ? '' : tot.foodCostPct <= target ? 'good' : tot.foodCostPct <= target + 5 ? 'warn' : 'bad';
  const cashIn = r.cashFlow.reduce((a, d) => a + d.cashIn, 0);
  const cashOut = r.cashFlow.reduce((a, d) => a + d.cashOut, 0);
  const grossAfterFood = tot.revenue - tot.cogs - (tot.commissions || 0) - tot.wasteAndVariance;
  const byChannel = r.byChannel || [];
  const showChannels = byChannel.length > 1 || byChannel.some((c) => c.commission);
  const vsSuffix = p.partial
    ? t('home.vsSameDays', { month: fmtDate(p.to.slice(0, 7) + '-01', { month: 'short' }), day: Number(p.to.slice(8)) })
    : t('home.vsLastMonth');

  mount($('#dash'), html`
    ${isCurrent && sum ? html`${setupCard(sum.setup)}
    ${todayCard(sum, r.purchasing && r.purchasing.overdue ? [{ kind: 'overdueBills', n: r.purchasing.overdue, sub: money(r.payables.overdue) }] : [])}` : ''}
    <div class="kpis">
      <div class="card kpi hero"><div class="label">${icon('receipt')}${t('home.revenue')} · ${fmtMonth(month, false)}</div>
        <div class="val tabular">${money(tot.revenue, { cents: false })}</div>
        ${delta(tot.revenue, p.revenue, { suffix: vsSuffix })}</div>
      ${isCurrent ? html`<div class="card kpi"><div class="label">${t('home.todaySales')}</div>
        <div class="val">${money(r.todaySales.total, { cents: false })}</div><div class="delta">${t('home.itemsSold', { n: r.todaySales.dishes })}</div></div>`
        : html`<div class="card kpi"><div class="label">${t('home.itemsSoldLabel')}</div><div class="val">${number(tot.orders, 0)}</div>
        ${delta(tot.orders, p.orders)}</div>`}
      <div class="card kpi"><div class="label">${t('home.foodCost')}</div>
        <div class="val">${pct(tot.foodCostPct)}</div>
        <div class="delta">${tot.foodCostPct === null ? t('home.noSalesYet') : html`<span class="pill ${foodCls}" style="font-size:11px">${t('home.target', { n: target })}</span>`}</div></div>
      <div class="card kpi"><div class="label">${t('home.netProfit')}</div>
        <div class="val" style="${tot.netProfit < 0 ? 'color:var(--bad-ink)' : ''}">${money(tot.netProfit, { cents: false })}</div>
        <div class="delta">${tot.revenue ? t('home.margin', { pct: pct(tot.netProfit / tot.revenue * 100) }) : '—'}</div></div>
      <div class="card kpi"><div class="label">${t('home.stockOnHand')}</div>
        <div class="val">${money(r.stockValue, { cents: false })}</div><div class="delta">${t('home.atCurrentCost')}</div></div>
    </div>
    ${(r.attention || []).length ? html`<section class="section">
      <div class="section-head"><h2>${icon('alert')} ${t('home.attention')}</h2><a class="link" href="#/menu/pricing">${t('menu.tabPricing')}</a></div>
      <p class="small muted" style="margin:-4px 4px 8px">${t('home.attentionHelp')}</p>
      <div class="card"><ul class="list">${r.attention.map((a) => html`<li><a class="row" href="#/menu/pricing/${a.channelId}">
        <span class="avatar bad">${icon('alert')}</span>
        <span class="grow"><div class="title">${a.name}</div>
          <div class="sub">${t('home.attentionRow', { pct: pct(a.foodCostPctNet), channel: a.channelName, price: money(a.suggested, { cents: false }) })}</div></span>
        <span class="value sub">${t('home.attentionLost', { amount: money(a.lostMargin, { cents: false }) })}</span>${icon('chevR', 'chev')}</a></li>`)}</ul></div>
    </section>` : ''}
    <div class="section">${quickActions(true)}</div>

    <div class="grid-2"><section class="section">
      <div class="section-head"><h2>${t('home.cashFlow')}</h2><span class="small muted">${fmtMonth(month, false)} · ${t('home.daily')}</span></div>
      <div class="card pad">
        ${r.cashFlow.some((d) => d.cashIn || d.cashOut) ? html`<div id="cf"></div>` : emptyState('chart', t('home.noCashTitle'), t('home.noCashText'))}
        <div class="summary-strip" style="margin:8px -16px -16px;border-top:1px solid var(--line)">
          <div><div class="val">${money(cashIn, { cents: false, compact: true })}</div><div class="label">${t('chart.in')}</div></div>
          <div><div class="val">${money(cashOut, { cents: false, compact: true })}</div><div class="label">${t('chart.out')}</div></div>
          <div><div class="val" style="${cashIn - cashOut < 0 ? 'color:var(--bad-ink)' : ''}">${money(cashIn - cashOut, { cents: false, compact: true })}</div><div class="label">${t('home.netCash')}</div></div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>${t('home.topSellers')}</h2><a class="link" href="#/menu">${t('home.menuCosting')}</a></div>
      <div class="card pad">${r.topItems.length ? html`<div id="top"></div>` : emptyState('receipt', t('home.noSalesMonthTitle'), t('home.noSalesMonthText'))}</div>
    </section></div>

    <div class="grid-2">${showChannels ? html`<section class="section">
      <div class="section-head"><h2>${t('home.byChannel')}</h2><a class="link" href="#/menu/analysis">${t('menu.tabAnalysis')}</a></div>
      <div class="card pad"><div id="bych"></div></div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>${t('home.pl')}</h2><button class="btn ghost sm" id="print-report">${t('report.print')}</button></div>
      <div class="card">
        <div class="pl-row"><span>${t('home.revenue')}</span><b>${money(tot.revenue)}</b></div>
        <div class="pl-row indent"><span>${t('home.foodCostRecipes')}</span><span>−${money(tot.cogs)}</span></div>
        <div class="pl-row indent"><span>${t('home.wasteVariance')}</span><span>${tot.wasteAndVariance >= 0 ? '−' : '+'}${money(Math.abs(tot.wasteAndVariance))}</span></div>
        ${tot.commissions ? html`<div class="pl-row indent"><span>${t('home.commissions')}</span><span>−${money(tot.commissions)}</span></div>` : ''}
        <div class="pl-row total"><span>${t('home.grossProfit')}</span><span>${money(grossAfterFood)}</span></div>
        ${r.expenseCategories.map((c) => html`<div class="pl-row indent"><span>${c.category}</span><span>−${money(c.amount)}</span></div>`)}
        ${r.expenseCategories.length ? '' : html`<div class="pl-row indent"><span>${t('home.opex')}</span><span>${money(0)}</span></div>`}
        <div class="pl-row total"><span>${t('home.netProfit')}</span><span style="${tot.netProfit < 0 ? 'color:var(--bad-ink)' : ''}">${money(tot.netProfit)}</span></div>
      </div>
      <p class="small muted" style="margin:8px 4px 0">${t('home.plNote', { amount: money(tot.purchases, { cents: false }) })}</p>
    </section></div>

    <section class="section">
      <div class="section-head"><h2>${t('home.monthly')}</h2><span class="small muted">${t('home.last6')}</span></div>
      <div class="card"><div class="table-wrap" style="margin:0;padding:0">
        <table class="data">
          <thead><tr><th>${t('home.colMonth')}</th><th>${t('home.revenue')}</th><th>${t('home.colFood')}</th><th>${t('home.colExpenses')}</th><th>${t('home.netProfit')}</th></tr></thead>
          <tbody>${r.trend.slice().reverse().map((m) => html`<tr>
            <td>${fmtDate(m.month + '-01', { month: 'short', year: '2-digit' })}</td>
            <td>${money(m.revenue, { cents: false })}</td>
            <td>${pct(m.foodCostPct)}</td>
            <td>${money(m.expenses, { cents: false })}</td>
            <td style="${m.netProfit < 0 ? 'color:var(--bad-ink)' : ''}">${money(m.netProfit, { cents: false })}</td></tr>`)}</tbody>
        </table></div></div>
    </section>`);

  wireToday(ctx, el, sum);
  $('#print-report').addEventListener('click', () => printHtml(monthlyReport(boot, r, month, target)));
  const cf = $('#cf');
  if (cf) cashFlowChart(cf, r.cashFlow);
  const bych = $('#bych');
  if (bych) {
    barList(bych, byChannel.map((c) => ({
      label: c.channelId ? c.name : t('common.other'), value: Math.max(0, c.revenue), valueLabel: money(c.revenue, { cents: false }),
      detail: t('home.channelDetail', { cm: money(c.cm, { cents: false }), commission: money(c.commission, { cents: false }) }),
    })));
  }
  const top = $('#top');
  if (top) {
    barList(top, r.topItems.slice(0, 8).map((i) => ({
      label: i.name, value: i.qty, valueLabel: t('home.nSold', { n: number(i.qty, 0) }),
      detail: t('home.topDetail', { revenue: money(i.revenue, { cents: false }), pct: pct(i.foodCostPct) }),
    })));
  }
}

/* ---------------------------------------------------- day and week summaries */

async function renderPeriod(ctx, period, date) {
  const boot = ctx.state.boot;
  const tday = today();
  const includesToday = period === 'day' ? date === tday : weekOf(date)[1] >= tday;
  const [r, sum] = await Promise.all([call('reports.period', { period, date, today: tday }), includesToday ? todaySummary(tday) : null]);
  if (ctx.stale() || !$('#dash')) return;
  const tot = r.totals, p = r.previous;
  const target = Number(boot.settings.targetFoodCostPct) || 30;
  const foodCls = tot.foodCostPct === null ? '' : tot.foodCostPct <= target ? 'good' : tot.foodCostPct <= target + 5 ? 'warn' : 'bad';
  const gross = tot.revenue - tot.cogs - (tot.commissions || 0) - tot.wasteAndVariance;
  const pGross = p.revenue - p.cogs - (p.commissions || 0) - p.wasteAndVariance;
  const vs = period === 'day'
    ? t('home.vsWeekday', { day: fmtDate(p.from, { weekday: 'short', day: 'numeric', month: 'short' }) })
    : r.partial ? t('home.vsSameDaysLastWeek') : t('home.vsLastWeek');
  const elapsed = period === 'week' ? r.days.filter((d) => !d.future).length : 1;
  const byChannel = r.byChannel || [];
  const showChannels = byChannel.length > 1 || byChannel.some((c) => c.commission);
  const heroLabel = period === 'day' ? (includesToday ? t('home.salesDay') : t('home.salesOfDay'))
    : (includesToday ? t('home.salesWeek') : t('home.salesOfWeek'));
  const dayShort = fmtDate(date, { day: 'numeric', month: 'short' });

  mount($('#dash'), html`
    ${sum ? html`${setupCard(sum.setup)}${todayCard(sum)}` : ''}
    <div class="kpis">
      <div class="card kpi hero"><div class="label">${icon('receipt')}${heroLabel}</div>
        <div class="val tabular">${money(tot.revenue, { cents: false })}</div>
        ${delta(tot.revenue, p.revenue, { suffix: vs })}</div>
      <div class="card kpi"><div class="label">${t('home.itemsSoldLabel')}</div><div class="val">${number(tot.orders, 0)}</div>
        ${delta(tot.orders, p.orders, { suffix: t('home.vsShort') })}</div>
      <div class="card kpi"><div class="label">${t('home.foodCost')}</div><div class="val">${pct(tot.foodCostPct)}</div>
        <div class="delta">${tot.foodCostPct === null ? t('home.noSalesYet') : html`<span class="pill ${foodCls}" style="font-size:11px">${t('home.target', { n: target })}</span>`}</div></div>
      <div class="card kpi"><div class="label">${t('home.grossProfit')}</div>
        <div class="val" style="${gross < 0 ? 'color:var(--bad-ink)' : ''}">${money(gross, { cents: false })}</div>
        ${delta(gross, pGross, { suffix: t('home.vsShort') })}</div>
      ${period === 'week'
        ? html`<div class="card kpi"><div class="label">${t('home.avgDay')}</div><div class="val">${money(tot.revenue / elapsed, { cents: false })}</div>
            <div class="delta">${t('home.avgDayHow', { n: elapsed })}</div></div>`
        : html`<div class="card kpi"><div class="label">${t('home.avgDish')}</div><div class="val">${tot.orders ? money(tot.revenue / tot.orders) : '—'}</div>
            <div class="delta">${tot.revenue ? t('home.margin', { pct: pct(gross / tot.revenue * 100) }) : '—'}</div></div>`}
    </div>

    ${period === 'week' ? html`<section class="section">
      <div class="section-head"><h2>${t('home.dailySales')}</h2>${r.best ? html`<span class="small muted">${t('home.bestDay', { day: fmtDate(r.best.date, { weekday: 'long' }), amount: money(r.best.revenue, { cents: false }) })}</span>` : ''}</div>
      <div class="card pad">${weekChart(r)}
        <div class="week-legend small muted"><span><i class="lg-now"></i>${t('home.thisWeek')}</span><span><i class="lg-prev"></i>${t('home.lastWeek')}</span>${r.best ? html`<span><i class="lg-best"></i>${t('home.bestDayShort')}</span>` : ''}</div>
      </div>
      <div class="card" style="margin-top:10px"><ul class="list">${r.days.map((d) => html`<li>
        <button class="row week-row${d.future ? ' future' : ''}" data-day="${d.date}" ${d.future ? 'disabled' : ''}>
          <span class="avatar ${d.closed ? 'good' : ''}">${d.closed ? icon('check') : fmtDate(d.date, { weekday: 'narrow' })}</span>
          <span class="grow"><div class="title">${fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'short' })}</div>
            <div class="sub">${d.future ? t('home.notYet') : t('home.dayLine', { n: number(d.dishes, 0), pct: pct(d.foodCostPct) })}${!d.future && !d.closed && d.date < tday ? html` · <span style="color:var(--warn-ink)">${t('home.notClosedShort')}</span>` : ''}</div></span>
          <span class="value">${d.future ? '—' : money(d.revenue, { cents: false })}
            ${!d.future && d.prevRevenue ? html`<div class="sub">${t('home.lastWeekShort', { amount: money(d.prevRevenue, { cents: false }) })}</div>` : ''}</span>
          ${d.future ? '' : icon('chevR', 'chev')}</button></li>`)}</ul></div>
    </section>` : html`<div class="grid-2"><section class="section">
      <div class="section-head"><h2>${t('home.dayClose')}</h2></div>
      <div class="card pad">${r.close
        ? html`<div class="close-done">${icon('check')}<div><b>${t('home.closedBy', { who: r.close.closedBy, time: timeOf(r.close.closedAt) })}</b>
            <div class="small muted">${t('home.closeFigures', { sales: money(r.close.salesTotal, { cents: false }), waste: money(r.close.wasteValue, { cents: false }), n: r.close.countLines })}</div></div></div>
          ${r.close.note ? html`<blockquote class="close-note">${r.close.note}</blockquote>` : ''}`
        : html`<p class="small muted" style="margin:0 0 10px">${date === tday ? t('home.notClosed') : t('home.notClosedPast', { date: dayShort })}</p>
          <a class="btn accent block" href="#/close/${date}">${icon('clipboard')}${date === tday ? t('home.closeThisDay') : t('home.closeThatDay', { date: dayShort })}</a>`}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>${t('home.wasteDay')}</h2><span class="small muted">${money(tot.wasteAndVariance > 0 ? r.waste.reduce((a, w) => a + w.value, 0) : 0, { cents: false })}</span></div>
      <div class="card">${r.waste.length ? html`<ul class="list">${r.waste.map((w) => html`<li class="row" style="min-height:52px">
          <span class="grow"><div class="title">${w.name}</div><div class="sub">${number(w.qty, 3)} ${w.unit}</div></span>
          <span class="value">${money(w.value)}</span></li>`)}</ul>`
        : emptyState('check', t('home.noWaste'), '')}</div>
    </section></div>`}

    <div class="grid-2"><section class="section">
      <div class="section-head"><h2>${t('home.topSellers')}</h2><a class="link" href="#/menu">${t('home.menuCosting')}</a></div>
      <div class="card pad">${r.topItems.length ? html`<div id="top"></div>` : emptyState('receipt', t('home.noSalesPeriodTitle'), t('home.noSalesPeriodText'))}</div>
    </section>
    ${showChannels ? html`<section class="section">
      <div class="section-head"><h2>${t('home.byChannel')}</h2><a class="link" href="#/menu/analysis">${t('menu.tabAnalysis')}</a></div>
      <div class="card pad"><div id="bych"></div></div>
    </section>` : ''}</div>

    <section class="section">
      <div class="section-head"><h2>${period === 'day' ? t('home.plDay') : t('home.plWeek')}</h2><span class="small muted">${period === 'day' ? dayShort : weekLabel(r.from, r.to)}</span></div>
      <div class="card">
        <div class="pl-row"><span>${t('home.revenue')}</span><b>${money(tot.revenue)}</b></div>
        <div class="pl-row indent"><span>${t('home.foodCostRecipes')}</span><span>−${money(tot.cogs)}</span></div>
        <div class="pl-row indent"><span>${t('home.wasteVariance')}</span><span>${tot.wasteAndVariance >= 0 ? '−' : '+'}${money(Math.abs(tot.wasteAndVariance))}</span></div>
        ${tot.commissions ? html`<div class="pl-row indent"><span>${t('home.commissions')}</span><span>−${money(tot.commissions)}</span></div>` : ''}
        <div class="pl-row total"><span>${t('home.grossProfit')}</span><span>${money(gross)}</span></div>
        ${r.expenseCategories.map((c) => html`<div class="pl-row indent"><span>${c.category}</span><span>−${money(c.amount)}</span></div>`)}
        <div class="pl-row total"><span>${t('home.netProfit')}</span><span style="${tot.netProfit < 0 ? 'color:var(--bad-ink)' : ''}">${money(tot.netProfit)}</span></div>
      </div>
      <p class="small muted" style="margin:8px 4px 0">${t('home.periodPlNote')}</p>
    </section>
    <div class="section">${quickActions(true)}</div>`);

  wireToday(ctx, ctx.el, sum);
  $$('[data-day]', ctx.el).forEach((b) => b.addEventListener('click', () => { anchor = b.dataset.day; setPeriod('day'); render(ctx); window.scrollTo(0, 0); }));
  $$('[data-bar]', ctx.el).forEach((b) => b.addEventListener('click', () => { anchor = b.dataset.bar; setPeriod('day'); render(ctx); window.scrollTo(0, 0); }));
  const top = $('#top');
  if (top) barList(top, r.topItems.map((i) => ({ label: i.name, value: i.qty, valueLabel: t('home.nSold', { n: number(i.qty, 0) }),
    detail: t('home.topDetail', { revenue: money(i.revenue, { cents: false }), pct: pct(i.foodCostPct) }) })));
  const bych = $('#bych');
  if (bych) barList(bych, byChannel.map((c) => ({ label: c.channelId ? c.name : t('common.other'), value: Math.max(0, c.revenue),
    valueLabel: money(c.revenue, { cents: false }), detail: t('home.channelDetail', { cm: money(c.cm, { cents: false }), commission: money(c.commission, { cents: false }) }) })));
}

/** This week's sales per day against last week's (lighter bar); the best day in coral. Tap a day to open it. */
function weekChart(r) {
  const W = 700, H = 210, top = 26, base = 172;
  const max = Math.max(1, ...r.days.map((d) => Math.max(d.revenue, d.prevRevenue)));
  const h = (v) => Math.max(0, v) / max * (base - top);
  const slot = W / 7;
  const short = (v) => (v >= 1000 ? `${number(v / 1000, v >= 10000 ? 0 : 1)}k` : number(v, 0));
  return html`<svg class="week-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('home.dailySales')}">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="wk-axis"/>
    ${r.days.map((d, i) => {
      const x = i * slot + slot / 2;
      const best = r.best && r.best.date === d.date;
      return html`<g class="wk-day${d.future ? ' future' : ''}" ${d.future ? '' : html`data-bar="${d.date}" tabindex="0" role="button"`}
        aria-label="${fmtDate(d.date, { weekday: 'long' })}: ${money(d.revenue, { cents: false })}">
        <rect x="${x - slot / 2 + 4}" y="0" width="${slot - 8}" height="${H}" class="wk-hit"/>
        <rect x="${x - 22}" y="${base - h(d.prevRevenue)}" width="18" height="${h(d.prevRevenue)}" rx="4" class="wk-prev"/>
        ${d.future ? '' : html`<rect x="${x - 2}" y="${base - h(d.revenue)}" width="24" height="${h(d.revenue)}" rx="4" class="wk-now${best ? ' best' : ''}"/>
          <text x="${x + 10}" y="${base - h(d.revenue) - 8}" class="wk-val">${d.revenue ? short(d.revenue) : ''}</text>`}
        <text x="${x}" y="${base + 22}" class="wk-label${d.date === r.today ? ' today' : ''}">${fmtDate(d.date, { weekday: 'short' })}</text>
        <text x="${x}" y="${base + 37}" class="wk-date">${Number(d.date.slice(8))}</text>
      </g>`;
    })}</svg>`;
}

async function renderStaff(ctx) {
  const { el, state, stale } = ctx;
  const boot = state.boot;
  const d = today();
  mount(el, html`<div id="staff"><div class="skeleton" style="height:120px"></div></div>`);
  const [s, sum] = await Promise.all([call('sales.list', { from: d, to: d }), todaySummary(d)]);
  if (stale() || !$('#staff')) return;
  const low = boot.ingredients.filter((i) => i.active && i.status !== 'ok');
  mount($('#staff'), html`
    <div class="kpis">
      <div class="card kpi hero"><div class="label">${icon('receipt')}${t('home.todaySales')}</div>
        <div class="val">${money(s.total, { cents: false })}</div><div class="delta">${t('home.itemsSold', { n: s.dishes })}</div></div>
    </div>
    ${todayCard(sum)}
    <div class="section">${quickActions(false)}</div>
    <section class="section">
      <div class="section-head"><h2>${t('home.needsRestock')}</h2><a class="link" href="#/stock">${t('home.allStock')}</a></div>
      <div class="card">${low.length ? html`<ul class="list">${low.slice(0, 8).map((i) => html`<li><a class="row" href="#/stock/item/${i.id}">
          <span class="avatar ${i.status === 'out' ? 'bad' : 'warn'}">${icon('alert')}</span>
          <span class="grow"><div class="title">${i.name}</div><div class="sub">${t('stock.minimum', { qty: `${number(i.minLevel, 3)} ${i.unit}` })}</div></span>
          <span class="value">${number(i.onHand, 3)} ${i.unit}</span></a></li>`)}</ul>`
        : emptyState('check', t('stock.allStockedTitle'), t('stock.allStockedText'))}</div>
    </section>`);
  wireToday(ctx, el, sum);
}

/** A one-page monthly report for the owner, an accountant or a partner (printed on A4). */
function monthlyReport(boot, r, month, target) {
  const tot = r.totals;
  const gross = tot.revenue - tot.cogs - (tot.commissions || 0) - tot.wasteAndVariance;
  const row = (label, value, strong) => html`<tr${strong ? html` class="total"` : ''}><td>${label}</td><td class="num">${value}</td></tr>`;
  return html`<section class="report-print">
    <header><div class="small">${boot.settings.restaurantName}</div><h1>${t('report.title', { month: fmtMonth(month) })}</h1>
      <div class="small">${t('report.generated', { date: fmtDate(today(), { day: 'numeric', month: 'long', year: 'numeric' }) })}</div></header>
    <div class="report-kpis">
      <div><span>${t('home.revenue')}</span><b>${money(tot.revenue, { cents: false })}</b></div>
      <div><span>${t('home.foodCost')}</span><b>${pct(tot.foodCostPct)}</b><small>${t('home.target', { n: target })}</small></div>
      <div><span>${t('home.netProfit')}</span><b>${money(tot.netProfit, { cents: false })}</b></div>
      <div><span>${t('report.margin')}</span><b>${tot.revenue ? pct(tot.netProfit / tot.revenue * 100) : '—'}</b></div>
    </div>
    <h2>${t('home.pl')}</h2>
    <table>${row(t('home.revenue'), money(tot.revenue))}
      ${row(t('home.foodCostRecipes'), '−' + money(tot.cogs))}
      ${row(t('home.wasteVariance'), (tot.wasteAndVariance >= 0 ? '−' : '+') + money(Math.abs(tot.wasteAndVariance)))}
      ${tot.commissions ? row(t('home.commissions'), '−' + money(tot.commissions)) : ''}
      ${row(t('home.grossProfit'), money(gross), true)}
      ${r.expenseCategories.map((c) => row(c.category, '−' + money(c.amount)))}
      ${row(t('home.netProfit'), money(tot.netProfit), true)}</table>
    ${(r.byChannel || []).length ? html`<h2>${t('home.byChannel')}</h2><table><tr><th>${t('report.channel')}</th><th class="num">${t('home.revenue')}</th><th class="num">${t('report.commission')}</th><th class="num">${t('report.cm')}</th></tr>
      ${r.byChannel.map((c) => html`<tr><td>${c.channelId ? c.name : t('common.other')}</td><td class="num">${money(c.revenue, { cents: false })}</td><td class="num">${money(c.commission, { cents: false })}</td><td class="num">${money(c.cm, { cents: false })}</td></tr>`)}</table>` : ''}
    ${r.topItems.length ? html`<h2>${t('home.topSellers')}</h2><table><tr><th>${t('report.dish')}</th><th class="num">${t('report.qty')}</th><th class="num">${t('home.revenue')}</th><th class="num">${t('home.foodCost')}</th></tr>
      ${r.topItems.slice(0, 10).map((i) => html`<tr><td>${i.name}</td><td class="num">${number(i.qty, 0)}</td><td class="num">${money(i.revenue, { cents: false })}</td><td class="num">${pct(i.foodCostPct)}</td></tr>`)}</table>` : ''}
    <h2>${t('home.monthly')}</h2><table><tr><th>${t('home.colMonth')}</th><th class="num">${t('home.revenue')}</th><th class="num">${t('home.colFood')}</th><th class="num">${t('home.colExpenses')}</th><th class="num">${t('home.netProfit')}</th></tr>
      ${r.trend.slice().reverse().map((m) => html`<tr><td>${fmtDate(m.month + '-01', { month: 'short', year: '2-digit' })}</td><td class="num">${money(m.revenue, { cents: false })}</td><td class="num">${pct(m.foodCostPct)}</td><td class="num">${money(m.expenses, { cents: false })}</td><td class="num">${money(m.netProfit, { cents: false })}</td></tr>`)}</table>
  </section>`;
}
