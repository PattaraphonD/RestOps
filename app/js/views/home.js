// Home: dashboard (managers/owners) or today's overview (staff).
import { call } from '../api.js';
import { html, mount, icon, money, pct, today, fmtMonth, fmtDate, number, $, emptyState } from '../ui.js';
import { cashFlowChart, barList } from '../charts.js';
import { t } from '../i18n.js';

let month = null;

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
    ${canManage ? tile('#/more/expenses/new', 'wallet', t('home.expense')) : tile('#/stock/usage', 'fork', t('type.usage'))}
  </div>`;

/** Purchasing items that need someone's attention (deliveries due, invoices to check or pay). */
function purchasingAlerts(pc, pay, manager) {
  if (!pc) return '';
  const out = [];
  if (pc.expectedToday) out.push(html`<a class="alert-card warn" href="#/orders/receive" style="margin-top:12px">${icon('truck')}
    <span class="grow">${t('home.deliveriesDue', { n: pc.expectedToday })}<div class="small" style="font-weight:500;opacity:.85">${t('home.deliveriesDueSub')}</div></span>${icon('chevR', 'chev')}</a>`);
  if (manager && pc.toReview) out.push(html`<a class="alert-card" href="#/orders/invoices" style="margin-top:12px">${icon('receipt')}
    <span class="grow">${t('home.invoicesToReview', { n: pc.toReview })}${pay ? html`<div class="small" style="font-weight:500;opacity:.85">${money(pay.toReview)}</div>` : ''}</span>${icon('chevR', 'chev')}</a>`);
  if (manager && pc.overdue) out.push(html`<a class="alert-card" href="#/orders/invoices" style="margin-top:12px">${icon('wallet')}
    <span class="grow">${t('home.overdueBills', { n: pc.overdue })}${pay ? html`<div class="small" style="font-weight:500;opacity:.85">${money(pay.overdue)}</div>` : ''}</span>${icon('chevR', 'chev')}</a>`);
  return out;
}

function lowStockAlert(boot) {
  const low = boot.ingredients.filter((i) => i.active && i.status !== 'ok');
  if (!low.length) return '';
  const out = low.filter((i) => i.status === 'out').length;
  return html`<a class="alert-card ${out ? '' : 'warn'}" href="#/stock/low" style="margin-top:12px">
    ${icon('alert')}<span class="grow">${t('home.lowAlert', { n: low.length })}${out ? html` · ${t('home.outAlert', { n: out })}` : ''}
    <div class="small" style="font-weight:500;opacity:.85">${low.slice(0, 3).map((i) => i.name).join(', ')}${low.length > 3 ? '…' : ''}</div></span>
    ${icon('chevR', 'chev')}</a>`;
}

export async function render(ctx) {
  const { el, state, setTitle, can } = ctx;
  const boot = state.boot;
  const firstName = boot.user.displayName.split(/[\s(]/)[0];
  setTitle(greeting(firstName));
  if (!can('manager')) return renderStaff(ctx);

  month = month || today().slice(0, 7);
  const atLatest = month >= today().slice(0, 7);
  mount(el, html`
    <div class="date-nav">
      <button class="icon-btn" data-m="-1" aria-label="${t('common.prevMonth')}">${icon('chevL')}</button>
      <div class="date-label">${fmtMonth(month)}<div class="sub">${month === today().slice(0, 7) ? t('home.monthToDate') : t('home.fullMonth')}</div></div>
      <button class="icon-btn" data-m="1" aria-label="${t('common.nextMonth')}" ${atLatest ? 'disabled' : ''} style="${atLatest ? 'opacity:.3' : ''}">${icon('chevR')}</button>
    </div>
    <div id="dash"><div class="skeleton" style="height:130px"></div><div class="skeleton" style="height:240px;margin-top:12px"></div></div>`);
  el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + Number(b.dataset.m), 1)).toISOString().slice(0, 7);
    if (d > today().slice(0, 7)) return;
    month = d;
    render(ctx);
  }));

  const r = await call('reports.summary', { month, today: today() });
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
    ${lowStockAlert(boot)}
    ${isCurrent ? purchasingAlerts(r.purchasing, r.payables, true) : ''}
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

    <section class="section">
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
    </section>

    ${showChannels ? html`<section class="section">
      <div class="section-head"><h2>${t('home.byChannel')}</h2><a class="link" href="#/menu/analysis">${t('menu.tabAnalysis')}</a></div>
      <div class="card pad"><div id="bych"></div></div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>${t('home.pl')}</h2><span class="small muted">${fmtMonth(month)}</span></div>
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
    </section>

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

async function renderStaff({ el, state, stale }) {
  const boot = state.boot;
  const d = today();
  mount(el, html`<div id="staff"><div class="skeleton" style="height:120px"></div></div>`);
  const s = await call('sales.list', { from: d, to: d });
  if (stale() || !$('#staff')) return;
  const low = boot.ingredients.filter((i) => i.active && i.status !== 'ok');
  mount($('#staff'), html`
    <div class="kpis">
      <div class="card kpi hero"><div class="label">${icon('receipt')}${t('home.todaySales')}</div>
        <div class="val">${money(s.total, { cents: false })}</div><div class="delta">${t('home.itemsSold', { n: s.dishes })}</div></div>
    </div>
    ${purchasingAlerts(boot.purchasing, null, false)}
    <div class="section">${quickActions(false)}</div>
    <section class="section">
      <div class="section-head"><h2>${t('home.needsRestock')}</h2><a class="link" href="#/stock">${t('home.allStock')}</a></div>
      <div class="card">${low.length ? html`<ul class="list">${low.slice(0, 8).map((i) => html`<li><a class="row" href="#/stock/item/${i.id}">
          <span class="avatar ${i.status === 'out' ? 'bad' : 'warn'}">${icon('alert')}</span>
          <span class="grow"><div class="title">${i.name}</div><div class="sub">${t('stock.minimum', { qty: `${number(i.minLevel, 3)} ${i.unit}` })}</div></span>
          <span class="value">${number(i.onHand, 3)} ${i.unit}</span></a></li>`)}</ul>`
        : emptyState('check', t('stock.allStockedTitle'), t('stock.allStockedText'))}</div>
    </section>`);
}
