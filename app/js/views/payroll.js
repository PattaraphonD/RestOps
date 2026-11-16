// ทีม → เงินเดือน (owner): labour cost, pay runs from approved time, pay setup and payslips.
// ทีม → สลิปเงินเดือน (staff and managers): their own payslips once paid.
import { call } from '../api.js';
import { html, raw, mount, icon, $, $$, openSheet, confirmSheet, toast, busy, emptyState, fmtDate, money, number, today, printHtml } from '../ui.js';
import { t } from '../i18n.js';

const PAY_TYPES = ['monthly', 'daily', 'hourly'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const ADD_LABELS = ['เบี้ยขยัน', 'โบนัส', 'ค่าอาหาร', 'ค่าเดินทาง', 'ค่าตำแหน่ง', 'ทิป'];
const DEDUCT_LABELS = ['เบิกล่วงหน้า', 'ภาษีหัก ณ ที่จ่าย', 'ค่าเสียหาย', 'หักอื่น ๆ'];
const hours = (min) => number((min || 0) / 60, 2);
const fullDate = (d) => fmtDate(d, { day: 'numeric', month: 'long', year: 'numeric' });
function periodLabel(r) {
  if (r.cycle === 'monthly') return t('pay.monthlyOf', { month: fmtDate(r.periodStart, { month: 'long', year: 'numeric' }) });
  return t('pay.weeklyOf', { range: `${fmtDate(r.periodStart, { day: 'numeric', month: 'short' })} – ${fmtDate(r.periodEnd, { day: 'numeric', month: 'short', year: 'numeric' })}` });
}
const statusPill = (s) => html`<span class="pill ${s === 'paid' ? 'good' : 'warn'}">${t(`pay.status.${s}`)}</span>`;

/* ------------------------------------------------------------ router */

export async function renderPayroll(ctx, arg, arg2) {
  const { el, setTitle, can } = ctx;
  if (!can('owner')) { setTitle(t('pay.title'), { back: true }); mount(el, emptyState('wallet', t('more.ownersOnly'), t('pay.ownerOnly'))); return; }
  if (arg === 'setup') return setupPage(ctx);
  if (arg === 'run' && arg2) return runPage(ctx, arg2);
  return overview(ctx);
}

/* ------------------------------------------------------------ overview */

async function overview(ctx) {
  const { el, setTitle, setActions } = ctx;
  setTitle(t('pay.title'), { back: true });
  setActions(html`<a class="icon-btn" href="#/team/payroll/setup" aria-label="${t('pay.setup')}">${icon('settings')}</a>`);
  mount(el, html`<div class="skeleton" style="height:120px;margin-top:4px"></div><div class="skeleton" style="height:200px;margin-top:12px"></div>`);
  const r = await call('payroll.overview', { today: today() });
  if (ctx.stale()) return;
  mount(el, html`
    <div class="card pad pay-kpis">
      <div><span>${t('pay.laborCost', { month: fmtDate(r.month + '-01', { month: 'long' }) })}</span><b>${money(r.laborCost, { cents: false })}</b></div>
      <div><span>${t('pay.laborPct')}</span><b>${r.laborPct === null ? '—' : `${number(r.laborPct, 1)}%`}</b><small>${t('pay.ofSales', { sales: money(r.sales, { cents: false }) })}</small></div>
    </div>
    ${r.peopleSetUp < r.peopleTotal ? html`<a class="sched-hint" href="#/team/payroll/setup" style="text-decoration:none">${icon('info')}<span>${t('pay.notSetUp', { n: r.peopleTotal - r.peopleSetUp })}</span></a>` : ''}
    <section class="section"><div class="section-head"><h2>${t('pay.due')}</h2></div>
      <div class="card">${r.due.length ? html`<ul class="list">${r.due.map((d, i) => html`<li><div class="row">
        <span class="avatar warn">${icon('wallet')}</span>
        <span class="grow"><div class="title">${periodLabel(d)}</div><div class="sub">${t('pay.payOn', { date: fullDate(d.payDate), n: d.people })}</div></span>
        <button class="btn sm primary" data-create="${i}">${t('pay.create')}</button></div></li>`)}</ul>`
        : html`<div class="hub-clear">${icon('check')}<span>${t('pay.nothingDue')}</span></div>`}</div></section>
    <section class="section"><div class="section-head"><h2>${t('pay.runs')}</h2></div>
      <div class="card">${r.runs.length ? html`<ul class="list">${r.runs.map((x) => html`<li><a class="row" href="#/team/payroll/run/${x.id}">
        <span class="grow"><div class="title">${periodLabel(x)} ${statusPill(x.status)}</div>
          <div class="sub">${t('pay.runSub', { n: x.people, date: fullDate(x.payDate) })}</div></span>
        <span class="value">${money(x.net, { cents: false })}</span>${icon('chevR', 'chev')}</a></li>`)}</ul>`
        : emptyState('wallet', t('pay.noRunsTitle'), t('pay.noRunsText'))}</div></section>
    <p class="small muted" style="margin:10px 2px">${t('pay.help')}</p>`);
  $$('[data-create]', el).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const d = r.due[Number(b.dataset.create)];
    const run = await call('payroll.create', { cycle: d.cycle, periodStart: d.periodStart });
    location.hash = `#/team/payroll/run/${run.id}`;
  })));
}

/* ------------------------------------------------------------ a pay run */

async function runPage(ctx, id) {
  const { el, setTitle, setActions } = ctx;
  setTitle(t('pay.run'), { back: true });
  mount(el, html`<div class="skeleton" style="height:160px;margin-top:4px"></div><div class="skeleton" style="height:240px;margin-top:12px"></div>`);
  const r = await call('payroll.get', { id });
  if (ctx.stale()) return;
  drawRun(ctx, r);
  setActions(html`<button class="icon-btn" id="print-all" aria-label="${t('pay.printAll')}">${icon('print')}</button>`)
    .querySelector('#print-all').addEventListener('click', () => printSlips(ctx, ctx.run.slips, ctx.run));
}

function drawRun(ctx, r) {
  const { el, setTitle } = ctx;
  ctx.run = r;
  setTitle(periodLabel(r), { back: true, eyebrow: t('pay.run') });
  const draft = r.status !== 'paid';
  const w = r.warnings || { unapproved: 0, noPay: [], leavers: [] };
  mount(el, html`
    <div class="card pad">
      <div class="pay-head">${statusPill(r.status)}<span class="small muted">${draft ? t('pay.payOnDate', { date: fullDate(r.payDate) }) : t('pay.paidOn', { date: fullDate(r.payDate), who: r.paidBy })}</span></div>
      <div class="pay-total"><span>${t('pay.netTotal')}</span><b>${money(r.net)}</b></div>
      <div class="kpi-row">
        <div><span>${t('pay.gross')}</span><b>${money(r.gross, { cents: false })}</b></div>
        <div><span>${t('pay.ssoBoth')}</span><b>${money(r.sso + r.employerSso, { cents: false })}</b></div>
        <div><span>${t('pay.cost')}</span><b>${money(r.gross + r.employerSso, { cents: false })}</b></div>
      </div>
      ${draft ? html`<div class="form-row">
        <button class="btn" id="recalc">${icon('refresh')}${t('pay.recalc')}</button>
        <button class="btn primary" id="paid" ${r.slips.length ? '' : raw('disabled')}>${icon('check')}${t('pay.confirmPaid')}</button></div>` : ''}
    </div>
    ${draft && r.stale ? html`<div class="sched-hint warn">${icon('refresh')}<span>${t('pay.stale')}</span></div>` : ''}
    ${draft && w.unapproved ? html`<a class="sched-hint warn" href="#/team/timesheet/${w.firstUnapproved || r.periodStart}" style="text-decoration:none">${icon('alert')}<span>${t('pay.unapproved', { n: w.unapproved })}</span></a>` : ''}
    ${draft && (w.leavers || []).length ? html`<a class="sched-hint warn" href="#/team/payroll/setup" style="text-decoration:none">${icon('alert')}<span>${t('pay.leavers', { names: w.leavers.map((x) => x.name).join(', ') })}</span></a>` : ''}
    ${draft && w.noPay.length ? html`<a class="sched-hint warn" href="#/team/payroll/setup" style="text-decoration:none">${icon('alert')}<span>${t('pay.noPay', { names: w.noPay.map((x) => x.name).join(', ') })}</span></a>` : ''}
    <section class="section"><div class="section-head"><h2>${t('pay.slips')}</h2><span class="small muted">${t('pay.nPeople', { n: r.slips.length })}</span></div>
      <div class="card">${r.slips.length ? html`<ul class="list">${r.slips.map((s) => html`<li><button class="row" data-slip="${s.id}">
        <span class="grow"><div class="title">${s.name}</div>
          <div class="sub">${t(`pay.type.${s.payType}`)} · ${t('pay.slipSub', { wages: money(s.wages, { cents: false }), ot: hours(s.otMinutes + s.holidayOtMinutes), sso: money(s.sso, { cents: false }) })}</div>
          ${s.additions || s.deductions ? html`<div class="flags">${s.additions ? html`<span class="pill good">+${money(s.additions, { cents: false })}</span>` : ''}${s.deductions ? html`<span class="pill warn">−${money(s.deductions, { cents: false })}</span>` : ''}</div>` : ''}</span>
        <span class="value"><b>${money(s.net)}</b></span>${icon('chevR', 'chev')}</button></li>`)}</ul>`
        : emptyState('users', t('pay.noSlipsTitle'), t('pay.noSlipsText'))}</div></section>
    ${draft ? html`<button class="btn danger block" id="remove-run" style="margin-top:16px">${icon('trash')}${t('pay.removeRun')}</button>` : ''}`);
  $$('[data-slip]', el).forEach((b) => b.addEventListener('click', () => slipSheet(ctx, r.slips.find((s) => s.id === b.dataset.slip))));
  $('#recalc', el)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    drawRun(ctx, await call('payroll.recalc', { id: r.id }));
    toast(t('pay.recalculated'));
  }));
  $('#paid', el)?.addEventListener('click', () => paidSheet(ctx));
  $('#remove-run', el)?.addEventListener('click', async () => {
    if (!(await confirmSheet({ title: t('pay.removeRun'), message: t('pay.removeText'), confirm: t('pay.removeRun'), danger: true }))) return;
    try { await call('payroll.remove', { id: r.id }); toast(t('pay.removed')); location.hash = '#/team/payroll'; } catch (e) { toast(e.message, 'bad', 5000); }
  });
}

function paidSheet(ctx) {
  const r = ctx.run;
  openSheet({
    title: t('pay.confirmPaid'),
    body: html`<p style="margin-top:0">${t('pay.paidText', { n: r.slips.length, net: money(r.net) })}</p>
      <p class="small muted">${t('pay.paidRecalc')}</p>
      <form id="pf" novalidate>
        <label class="field"><span class="label">${t('pay.payDate')}</span><input class="input" type="date" name="payDate" value="${r.payDate}"></label>
        <label class="check"><input type="checkbox" name="addExpense" checked><span>${t('pay.addExpense', { amount: money(r.gross + r.employerSso) })}</span></label>
        <p class="small muted">${t('pay.paidNote')}</p>
      </form>`,
    foot: html`<button class="btn" data-close>${t('common.cancel')}</button><button class="btn primary" id="go">${t('pay.confirmPaid')}</button>`,
    onMount(el, close) {
      const f = $('#pf', el);
      $('#go', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const out = await call('payroll.markPaid', { id: r.id, payDate: f.payDate.value, addExpense: f.addExpense.checked });
        close(); drawRun(ctx, out); toast(t('pay.paidToast'), 'good', 6000);
      }, f));
    },
  });
}

/* ------------------------------------------------------------ one payslip */

function breakdown(s) {
  const row = (label, value, cls = '') => html`<tr class="${cls}"><td>${label}</td><td class="num">${value}</td></tr>`;
  const plus = [
    [s.payType === 'monthly' ? (s.basePay < s.payRate && s.employedDays ? t('pay.salaryPart', { n: s.employedDays, rate: money(s.payRate) }) : t('pay.salary')) : s.payType === 'daily' ? t('pay.dailyWages', { n: s.daysWorked, rate: money(s.payRate) }) : t('pay.hourlyWages', { h: hours(s.normalMinutes), rate: money(s.payRate) }), s.basePay],
    s.otPay ? [t('pay.ot', { h: hours(s.otMinutes), hh: hours(s.holidayOtMinutes) }), s.otPay] : null,
    s.holidayPay ? [t('pay.holiday', { h: hours(s.holidayMinutes) }), s.holidayPay] : null,
    s.leavePay ? [t('pay.leavePay', { n: s.paidLeaveDays }), s.leavePay] : null,
    ...s.adjustments.filter((a) => a.kind === 'add').map((a) => [a.label, a.amount]),
  ].filter(Boolean);
  const minus = [
    s.absenceDeduction ? [t('pay.absence', { n: s.absentDays + s.unpaidLeaveDays }), s.absenceDeduction] : null,
    s.sso ? [t('pay.sso'), s.sso] : null,
    ...s.adjustments.filter((a) => a.kind === 'deduct').map((a) => [a.label, a.amount]),
  ].filter(Boolean);
  return html`<table class="slip-table">
    <tr class="head"><td colspan="2">${t('pay.income')}</td></tr>${plus.map(([l, v]) => row(l, money(v)))}
    ${row(t('pay.grossLine'), money(s.gross + s.absenceDeduction), 'sub')}
    <tr class="head"><td colspan="2">${t('pay.less')}</td></tr>${minus.length ? minus.map(([l, v]) => row(l, '−' + money(v))) : row('—', money(0))}
    ${row(t('pay.netLine'), money(s.net), 'total')}
  </table>
  <p class="small muted slip-facts">${t('pay.facts', { days: s.daysWorked, h: hours(s.workedMinutes), ot: hours(s.otMinutes + s.holidayOtMinutes), leave: s.paidLeaveDays, unpaid: s.unpaidLeaveDays, absent: s.absentDays })}
    ${s.carriedDays ? html`<br>${t('pay.carried', { n: s.carriedDays })}` : ''}${s.leaveWorkedDays ? html`<br>${t('pay.leaveWorked', { n: s.leaveWorkedDays })}` : ''}</p>`;
}

function slipSheet(ctx, s) {
  const draft = ctx.run.status !== 'paid';
  let adj = s.adjustments.map((a) => ({ ...a }));
  openSheet({
    title: s.name,
    wide: true,
    body: html`<div id="slip-body">${breakdown(s)}</div>
      ${draft ? html`<section class="section"><div class="section-head"><h2>${t('pay.adjustments')}</h2></div>
        <div id="adj-list"></div>
        <form id="af" class="adj-form" novalidate>
          <select class="select" name="kind"><option value="add">${t('pay.kind.add')}</option><option value="deduct">${t('pay.kind.deduct')}</option></select>
          <input class="input" name="label" list="adj-labels" maxlength="60" placeholder="${t('pay.adjLabel')}">
          <datalist id="adj-labels">${[...ADD_LABELS, ...DEDUCT_LABELS].map((l) => html`<option value="${l}">`)}</datalist>
          <input class="input" name="amount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="${t('pay.amount')}">
          <button class="btn sm" type="submit">${icon('plus')}</button>
        </form></section>` : ''}`,
    foot: html`<button class="btn" id="print-one">${icon('print')}${t('pay.print')}</button>${draft ? html`<button class="btn primary" id="save-adj">${t('common.save')}</button>` : ''}`,
    onMount(el, close) {
      const drawAdj = () => {
        const host = $('#adj-list', el);
        if (!host) return;
        mount(host, adj.length ? html`<ul class="list adj-list">${adj.map((a, i) => html`<li><div class="row"><span class="grow">${a.label}</span>
          <span class="value ${a.kind === 'deduct' ? 'bad-ink' : ''}">${a.kind === 'deduct' ? '−' : '+'}${money(a.amount)}</span>
          <button class="icon-btn" data-del="${i}" aria-label="${t('ts.remove')}">${icon('x')}</button></div></li>`)}</ul>` : html`<p class="small muted">${t('pay.noAdjustments')}</p>`);
        $$('[data-del]', host).forEach((b) => b.addEventListener('click', () => { adj.splice(Number(b.dataset.del), 1); drawAdj(); }));
      };
      drawAdj();
      const af = $('#af', el);
      af?.addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = Number(af.amount.value);
        if (!af.label.value.trim() || !(amount > 0)) { toast(t('pay.adjMissing'), 'bad'); return; }
        adj.push({ kind: af.kind.value, label: af.label.value.trim(), amount });
        af.reset(); drawAdj();
      });
      $('#save-adj', el)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await call('payroll.adjust', { slipId: s.id, version: s.version, adjustments: adj });
        close(); drawRun(ctx, await call('payroll.get', { id: ctx.run.id })); toast(t('pay.saved'));
      }, el.querySelector('.sheet-body')));
      $('#print-one', el).addEventListener('click', () => printSlips(ctx, [s], ctx.run));
    },
  });
}

/** Payslips on A4, one per page, with signature lines. */
function printSlips(ctx, slips, run) {
  const shop = ctx.state.boot.settings.restaurantName;
  printHtml(html`${slips.map((s) => html`<section class="slip-print">
    <header><div><div class="small">${shop}</div><h1>${t('pay.slipTitle')}</h1></div>
      <div class="small" style="text-align:right">${periodLabel(run)}<br>${t('pay.payDateLine', { date: fullDate(s.payDate || run.payDate) })}</div></header>
    <div class="slip-who"><div><b>${s.name}</b>${s.position ? html` · ${s.position}` : ''}</div>
      <div class="small">${t(`pay.type.${s.payType}`)} ${money(s.payRate)}${s.payAccount ? html` · ${t('pay.account', { bank: s.payBank, acc: s.payAccount })}` : ''}</div></div>
    ${breakdown(s)}
    <div class="slip-sign"><div>${t('pay.signPayer')}</div><div>${t('pay.signReceiver')}</div></div>
  </section>`)}`);
}

/* ------------------------------------------------------------ pay setup */

async function setupPage(ctx) {
  const { el, setTitle, state } = ctx;
  setTitle(t('pay.setup'), { back: true });
  mount(el, html`<div class="skeleton" style="height:220px;margin-top:4px"></div>`);
  const people = await call('payroll.people', {});
  if (ctx.stale()) return;
  const st = state.boot.settings;
  const rateText = (p) => (p.payRate ? `${t(`pay.type.${p.payType}`)} ${money(p.payRate, { cents: false })}${t(`pay.per.${p.payType}`)} · ${t(`pay.cycle.${p.payCycle}`)}${p.ssoEnrolled ? ' · ' + t('pay.ssoShort') : ''}` : '');
  mount(el, html`
    <section class="section" style="margin-top:4px"><div class="section-head"><h2>${t('pay.people')}</h2></div>
      <div class="card"><ul class="list">${people.filter((p) => p.active || p.payRate).map((p) => html`<li><button class="row" data-person="${p.id}" style="${p.active ? '' : 'opacity:.6'}">
        <span class="grow"><div class="title">${p.name}</div><div class="sub">${p.position || t(`role.${p.role}`)}${p.active ? '' : ' · ' + t('team.disabled')}${p.endDate ? ' · ' + t('pay.lastDay', { date: fullDate(p.endDate) }) : ''}</div></span>
        ${p.payRate ? html`<span class="small" style="text-align:right">${rateText(p)}</span>` : html`<span class="pill warn">${t('pay.notSet')}</span>`}${icon('chevR', 'chev')}</button></li>`)}</ul></div></section>
    <section class="section"><div class="section-head"><h2>${t('pay.rules')}</h2></div>
      <form class="card pad" id="rules" novalidate>
        <div class="form-row">
          <label class="field"><span class="label">${t('pay.normalDay')}</span><select class="select" name="payNormalMinutes">${[420, 480, 540].map((m) => html`<option value="${m}" ${String(m) === String(st.payNormalMinutes || 480) ? raw('selected') : ''}>${t('pay.hoursN', { n: m / 60 })}</option>`)}</select></label>
          <label class="field"><span class="label">${t('pay.otFrom')}</span><select class="select" name="otMinMinutes">${[0, 15, 30, 60].map((m) => html`<option value="${m}" ${String(m) === String(st.otMinMinutes ?? 30) ? raw('selected') : ''}>${m ? t('sched.minutes', { n: m }) : t('pay.otAny')}</option>`)}</select></label>
        </div>
        <label class="field"><span class="label">${t('pay.weeklyDay')}</span><select class="select" name="payWeeklyDay">${WEEKDAYS.map((d) => html`<option value="${d}" ${String(d) === String(st.payWeeklyDay ?? 0) ? raw('selected') : ''}>${t(`pay.day.${d}`)}</option>`)}</select>
          <span class="hint">${t('pay.weeklyHint')}</span></label>
        <div class="form-row three">
          <label class="field"><span class="label">${t('pay.ssoRate')}</span><input class="input" name="ssoRate" type="number" inputmode="decimal" min="0" step="0.1" value="${st.ssoRate ?? 5}"></label>
          <label class="field"><span class="label">${t('pay.ssoMin')}</span><input class="input" name="ssoMinBase" type="number" inputmode="numeric" min="0" value="${st.ssoMinBase ?? 1650}"></label>
          <label class="field"><span class="label">${t('pay.ssoMax')}</span><input class="input" name="ssoMaxBase" type="number" inputmode="numeric" min="0" value="${st.ssoMaxBase ?? 17500}"></label>
        </div>
        <p class="small muted" style="margin-top:0">${t('pay.ssoHint')}</p>
        <div class="field"><span class="label">${t('pay.holidays')}</span>
          <div class="chips holiday-chips" id="hol"></div>
          <div class="input-group" style="margin-top:6px"><input class="input" type="date" id="hol-date"><button type="button" class="btn sm" id="hol-add">${icon('plus')}${t('pay.addHoliday')}</button></div>
          <span class="hint">${t('pay.holidaysHint')}</span></div>
        <button class="btn primary block" type="submit">${t('common.save')}</button>
      </form></section>`);
  $$('[data-person]', el).forEach((b) => b.addEventListener('click', () => paySheet(ctx, people.find((p) => p.id === b.dataset.person))));
  let hol = String(st.payHolidays || '').split(',').map((x) => x.trim()).filter(Boolean);
  const drawHol = () => {
    const host = $('#hol', el);
    mount(host, hol.length ? html`${hol.map((d, i) => html`<span class="chip">${fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' })}<button type="button" data-hol="${i}" aria-label="${t('ts.remove')}">${icon('x')}</button></span>`)}`
      : html`<span class="small muted">${t('pay.noHolidays')}</span>`);
    $$('[data-hol]', host).forEach((b) => b.addEventListener('click', () => { hol.splice(Number(b.dataset.hol), 1); drawHol(); }));
  };
  drawHol();
  $('#hol-add', el).addEventListener('click', () => {
    const d = $('#hol-date', el).value;
    if (d && !hol.includes(d)) { hol.push(d); hol.sort(); drawHol(); }
  });
  const f = $('#rules', el);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(f.querySelector('[type=submit]'), async () => {
      const out = await call('settings.save', { values: { payNormalMinutes: f.payNormalMinutes.value, otMinMinutes: f.otMinMinutes.value,
        payWeeklyDay: f.payWeeklyDay.value, ssoRate: f.ssoRate.value, ssoMinBase: f.ssoMinBase.value, ssoMaxBase: f.ssoMaxBase.value, payHolidays: hol.join(', ') } });
      state.boot.settings = out;
      toast(t('pay.rulesSaved'));
    }, f);
  });
}

function paySheet(ctx, p) {
  let type = p.payType || 'daily';
  openSheet({
    title: p.name,
    body: html`<form id="ps" novalidate>
      <div class="field"><span class="label">${t('pay.howPaid')}</span>
        <div class="seg" role="group">${PAY_TYPES.map((x) => html`<button type="button" data-type="${x}" aria-pressed="${x === type}">${t(`pay.type.${x}`)}</button>`)}</div></div>
      <label class="field"><span class="label" id="rate-label">${t(`pay.rateLabel.${type}`)}</span><input class="input" name="payRate" type="number" inputmode="decimal" min="0" step="0.01" value="${p.payRate || ''}"></label>
      <label class="field"><span class="label">${t('pay.howOften')}</span><select class="select" name="payCycle">
        <option value="monthly" ${p.payCycle !== 'weekly' ? raw('selected') : ''}>${t('pay.cycle.monthly')}</option>
        <option value="weekly" ${p.payCycle === 'weekly' ? raw('selected') : ''}>${t('pay.cycle.weekly')}</option></select>
        <span class="hint" id="cycle-hint"></span></label>
      <label class="check"><input type="checkbox" name="ssoEnrolled" ${p.ssoEnrolled ? raw('checked') : ''}><span>${t('pay.ssoEnrolled')}</span></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('pay.bank')}</span><input class="input" name="payBank" maxlength="60" value="${p.payBank}" list="banks" placeholder="${t('common.optional')}"></label>
        <label class="field"><span class="label">${t('pay.accountNo')}</span><input class="input" name="payAccount" maxlength="40" inputmode="numeric" value="${p.payAccount}" placeholder="${t('common.optional')}"></label>
      </div>
      <label class="field"><span class="label">${t('pay.endDate')}</span><input class="input" type="date" name="endDate" value="${p.endDate || ''}"><span class="hint">${t('pay.endDateHint')}</span></label>
      <datalist id="banks">${['กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ', 'กรุงไทย', 'กรุงศรี', 'ทีทีบี', 'ออมสิน', 'พร้อมเพย์'].map((b) => html`<option value="${b}">`)}</datalist>
    </form>`,
    foot: html`<button class="btn" data-close>${t('common.cancel')}</button><button class="btn primary" id="save">${t('common.save')}</button>`,
    onMount(el, close) {
      const f = $('#ps', el);
      const sync = () => {
        $('#rate-label', el).textContent = t(`pay.rateLabel.${type}`);
        const weekly = f.payCycle.querySelector('[value=weekly]');
        weekly.disabled = type === 'monthly';
        if (type === 'monthly') f.payCycle.value = 'monthly';
        $('#cycle-hint', el).textContent = type === 'monthly' ? t('pay.monthlyHint') : '';
      };
      $$('[data-type]', el).forEach((b) => b.addEventListener('click', () => {
        type = b.dataset.type;
        $$('[data-type]', el).forEach((x) => x.setAttribute('aria-pressed', x === b));
        sync();
      }));
      sync();
      $('#save', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await call('payroll.setPay', { userId: p.id, payType: type, payRate: f.payRate.value, payCycle: f.payCycle.value,
          ssoEnrolled: f.ssoEnrolled.checked, payBank: f.payBank.value, payAccount: f.payAccount.value, endDate: f.endDate.value });
        close(); toast(t('pay.saved')); setupPage(ctx);
      }, f));
    },
  });
}

/* ------------------------------------------------------------ my payslips */

export async function renderPayslips(ctx) {
  const { el, setTitle } = ctx;
  setTitle(t('pay.mySlips'), { back: true });
  mount(el, html`<div class="skeleton" style="height:200px;margin-top:4px"></div>`);
  const r = await call('payroll.mine', {});
  if (ctx.stale()) return;
  mount(el, html`<div class="card" style="margin-top:4px">${r.slips.length ? html`<ul class="list">${r.slips.map((s) => html`<li><button class="row" data-slip="${s.id}">
      <span class="avatar good">${icon('wallet')}</span>
      <span class="grow"><div class="title">${periodLabel(s)}</div><div class="sub">${t('pay.paidDate', { date: fullDate(s.payDate) })}</div></span>
      <span class="value"><b>${money(s.net)}</b></span>${icon('chevR', 'chev')}</button></li>`)}</ul>`
    : emptyState('wallet', t('pay.noMineTitle'), t('pay.noMineText'))}</div>
    <p class="small muted" style="margin:10px 2px">${t('pay.mineHelp')}</p>`);
  $$('[data-slip]', el).forEach((b) => b.addEventListener('click', () => {
    const s = r.slips.find((x) => x.id === b.dataset.slip);
    openSheet({
      title: periodLabel(s),
      wide: true,
      body: html`${breakdown(s)}`,
      foot: html`<button class="btn" id="print-one">${icon('print')}${t('pay.print')}</button>`,
      onMount(sheet) { $('#print-one', sheet).addEventListener('click', () => printSlips(ctx, [s], s)); },
    });
  }));
}
