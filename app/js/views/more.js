// More: expenses, suppliers, team, settings, account.
import { call, session, resetDemo } from '../api.js';
import {
  html, raw, mount, icon, money, today, relDay, fmtMonth, fmtDate, timeOf, $, $$, openSheet, confirmSheet, toast, busy,
  options, emptyState, initials,
} from '../ui.js';
import { list, signOut } from '../app.js';
import { t, defaults } from '../i18n.js';
import { renderLog as production } from './production.js';
import { renderChannels as channels } from './channels.js';
import { renderManual as sop } from './sop.js';
import { renderCategories as categories, categoryField, wireCategoryField } from './categories.js';

const roleLabel = (r) => t(`role.${r}`);
const roleHelp = (r) => t(`role.${r}Help`);
const ROLES = ['owner', 'manager', 'staff'];

export async function render(ctx) {
  const [sub, arg] = ctx.params;
  const pages = { expenses, suppliers, team, settings, account, production, channels, sop, categories };
  if (pages[sub]) return pages[sub](ctx, arg);
  return index(ctx);
}

function index({ el, setTitle, state, can }) {
  setTitle(t('nav.more'));
  const u = state.boot.user;
  const item = (href, ic, title, sub) => html`<li><a class="row" href="${href}">
    <span class="avatar brand">${icon(ic)}</span><span class="grow"><div class="title">${title}</div><div class="sub">${sub}</div></span>${icon('chevR', 'chev')}</a></li>`;
  mount(el, html`
    <a class="card row" href="#/more/account" style="margin-top:4px">
      <span class="avatar" style="width:48px;height:48px;font-size:16px">${initials(u.displayName)}</span>
      <span class="grow"><div class="title">${u.displayName}</div><div class="sub">${roleLabel(u.role)} · @${u.username}</div></span>${icon('chevR', 'chev')}</a>
    <section class="section"><div class="card"><ul class="list">
      ${item('#/orders', 'truck', t('more.orders'), t(can('manager') ? 'more.ordersSub' : 'more.ordersSubStaff', {
        n: (state.boot.purchasing || {}).awaiting || 0, due: (state.boot.purchasing || {}).expectedToday || 0 }))}
    </ul></div></section>
    ${can('manager') ? html`<section class="section"><div class="section-head"><h2>${t('more.money')}</h2></div>
      <div class="card"><ul class="list">
        ${item('#/more/expenses', 'wallet', t('more.expenses'), t('more.expensesSub'))}
        ${item('#/home', 'chart', t('more.reports'), t('more.reportsSub'))}
      </ul></div></section>
      <section class="section"><div class="section-head"><h2>${t('more.setup')}</h2></div>
      <div class="card"><ul class="list">
        ${item('#/more/suppliers', 'truck', t('more.suppliers'), t('more.nActive', { n: state.boot.suppliers.filter((s) => s.active).length }))}
        ${item('#/stock', 'box', t('more.ingredients'), t('more.ingredientsSub'))}
        ${item('#/more/channels', 'truck', t('channels.title'), t('more.nChannels', { n: (state.boot.channels || []).filter((c) => c.active).length }))}
        ${item('#/more/categories', 'grid', t('cat.title'), t('cat.moreSub', { n: (state.boot.categories || []).filter((c) => c.active).length }))}
        ${can('owner') ? item('#/more/team', 'users', t('more.team'), t('more.nActiveUsers', { n: state.boot.users.filter((x) => x.active).length })) : ''}
        ${can('owner') ? item('#/more/settings', 'settings', t('more.settings'), t('more.settingsSub')) : ''}
      </ul></div></section>` : ''}
    <section class="section"><div class="section-head"><h2>${t('more.kitchen')}</h2></div>
      <div class="card"><ul class="list">
        ${item('#/menu', 'chef', t('menu.title'), t('more.menuSub', { n: state.boot.menu.filter((m) => m.active).length }))}
        ${item('#/more/production', 'clipboard', t('production.logTitle'), t('more.productionSub'))}
        ${item('#/more/sop', 'chef', t('sop.manual'), t('sop.manualSub'))}
      </ul></div></section>
    <section class="section"><div class="card"><ul class="list">
      <li><button class="row" id="install"><span class="avatar">${icon('download')}</span>
        <span class="grow"><div class="title">${t('more.install')}</div><div class="sub">${t('more.installSub')}</div></span></button></li>
      <li><button class="row" id="signout"><span class="avatar bad">${icon('logout')}</span>
        <span class="grow"><div class="title">${t('more.signOut')}</div></span></button></li>
    </ul></div></section>
    <p class="small muted" style="text-align:center;margin-top:20px">${t('app.name')} ${state.boot.version}${session.mode === 'demo' ? ' · ' + t('more.demoData') : ''}</p>`);
  $('#signout').addEventListener('click', signOut);
  $('#install').addEventListener('click', installHelp);
}

/* -------------------------------------------------------------- install */

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });

async function installHelp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    return;
  }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  openSheet({
    title: t('more.installTitle'),
    body: standalone ? html`<p>${t('more.installed')}</p>` : html`
      <div class="card pad" style="margin-bottom:12px"><b>${t('more.iphone')}</b>
        <ol style="margin:8px 0 0;padding-left:20px;color:var(--ink-2)"><li>${t('more.iphone1')}</li><li>${raw(t('more.iphone2'))}</li><li>${raw(t('more.iphone3'))}</li></ol></div>
      <div class="card pad"><b>${t('more.android')}</b>
        <ol style="margin:8px 0 0;padding-left:20px;color:var(--ink-2)"><li>${t('more.android1')}</li><li>${raw(t('more.android2'))}</li></ol></div>`,
  });
}

/* ------------------------------------------------------------- expenses */

let expMonth = null;
async function expenses(ctx, arg) {
  const { el, setTitle, can } = ctx;
  setTitle(t('more.expenses'), { back: true });
  if (!can('manager')) { mount(el, emptyState('wallet', t('more.managersOnly'), t('more.askManagerExpense'))); return; }
  expMonth = expMonth || today().slice(0, 7);
  if (arg === 'new') { history.replaceState(null, '', '#/more/expenses'); expMonth = today().slice(0, 7); ctx.params = ['expenses']; }
  const from = expMonth + '-01';
  const [y, m] = expMonth.split('-').map(Number);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const atLatest = expMonth >= today().slice(0, 7);

  document.querySelectorAll('.fab').forEach((f) => f.remove());
  const fab = document.createElement('button');
  fab.className = 'fab';
  mount(fab, html`${icon('plus')}${t('exp.add')}`);
  fab.addEventListener('click', () => expenseSheet(ctx));
  document.body.append(fab);

  mount(el, html`<div class="date-nav">
      <button class="icon-btn" data-m="-1" aria-label="${t('common.prevMonth')}">${icon('chevL')}</button>
      <div class="date-label">${fmtMonth(expMonth)}</div>
      <button class="icon-btn" data-m="1" aria-label="${t('common.nextMonth')}" ${atLatest ? 'disabled' : ''} style="${atLatest ? 'opacity:.3' : ''}">${icon('chevR')}</button>
    </div><div id="exp"><div class="skeleton" style="height:240px"></div></div>`);
  $$('[data-m]', el).forEach((b) => b.addEventListener('click', () => {
    const d = new Date(Date.UTC(y, m - 1 + Number(b.dataset.m), 1)).toISOString().slice(0, 7);
    if (d > today().slice(0, 7)) return;
    expMonth = d; expenses(ctx);
  }));

  const rows = await call('expenses.list', { from, to, limit: 500 });
  if (ctx.stale() || !$('#exp')) return;
  const live = rows.filter((r) => !r.voided);
  const total = live.reduce((a, r) => a + r.amount, 0);
  const cats = {};
  live.forEach((r) => { cats[r.category] = (cats[r.category] || 0) + r.amount; });
  mount($('#exp'), html`
    <div class="card kpi"><div class="label">${t('exp.totalMonth')}</div><div class="val">${money(total)}</div>
      <div class="delta">${t('exp.count', { n: live.length })}</div></div>
    ${Object.keys(cats).length ? html`<div class="chips" style="margin-top:12px">${Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) =>
      html`<span class="chip" style="cursor:default;display:inline-flex;align-items:center">${c}<span class="count">${money(v, { cents: false })}</span></span>`)}</div>` : ''}
    <section class="section"><div class="card">${rows.length ? html`<ul class="list">${rows.map((r) => html`<li>
      <button class="row ${r.voided ? 'voided' : ''}" data-id="${r.id}">
        <span class="avatar">${icon('wallet')}</span>
        <span class="grow"><div class="title">${r.description || r.category}</div>
          <div class="sub">${relDay(r.date)} · ${r.category}${r.paymentMethod ? ' · ' + r.paymentMethod : ''}${r.voided ? ' · ' + t('common.voided') : ''}</div></span>
        <span class="value">${money(r.amount)}</span></button></li>`)}</ul>`
      : emptyState('wallet', t('exp.noneTitle'), t('exp.noneText'))}</div></section>`);
  $$('#exp [data-id]').forEach((b) => b.addEventListener('click', () => {
    const r = rows.find((x) => x.id === b.dataset.id);
    const row = (label, value) => html`<li class="pl-row"><span>${label}</span><b style="text-align:right">${value}</b></li>`;
    openSheet({
      title: r.description || r.category,
      body: html`<div class="card"><ul class="list">
        ${row(t('exp.amount'), money(r.amount))}
        ${row(t('common.category'), r.category)}
        ${row(t('common.date'), relDay(r.date))}
        ${row(t('exp.paidBy'), r.paymentMethod || '—')}
        ${row(t('common.enteredBy'), `${r.createdBy} · ${timeOf(r.createdAt)}`)}
        ${r.note ? row(t('common.note'), r.note) : ''}
      </ul></div>`,
      foot: r.voided ? null : html`<button class="btn danger block" data-void>${icon('trash')}${t('exp.void')}</button>`,
      onMount(sheetEl, close) {
        const v = sheetEl.querySelector('[data-void]');
        if (v) v.addEventListener('click', async () => {
          if (!await confirmSheet({ title: t('exp.voidTitle'), message: t('exp.voidMessage'), confirm: t('common.void'), danger: true })) return;
          await busy(v, async () => { await call('expenses.void', { id: r.id }); close(); toast(t('exp.voided')); expenses(ctx); });
        });
      },
    });
  }));
  if (arg === 'new') expenseSheet(ctx);
}

function expenseSheet(ctx) {
  const s = ctx.state.boot.settings;
  const methods = defaults('paymentMethods');
  openSheet({
    title: t('exp.add'),
    body: html`<form id="f" novalidate>
      <label class="field"><span class="label">${t('exp.amount')}</span><input class="input" name="amount" type="number" inputmode="decimal" min="0" step="any" placeholder="0.00"></label>
      ${categoryField(ctx, 'expense', '', { required: true })}
      <label class="field"><span class="label">${t('exp.description')}</span><input class="input" name="description" maxlength="200" placeholder="${t('exp.descPlaceholder')}"></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('common.date')}</span><input class="input" type="date" name="date" value="${today()}" max="${today()}"></label>
        <label class="field"><span class="label">${t('exp.paidBy')}</span><select class="select" name="paymentMethod">${options(methods, methods[0])}</select></label>
      </div>
      <label class="field"><span class="label">${t('common.note')}</span><input class="input" name="note" maxlength="200" placeholder="${t('common.optional')}"></label>
    </form>`,
    foot: html`<button class="btn primary block" id="save">${t('exp.save')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      wireCategoryField(ctx, el);
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const r = await call('expenses.add', Object.fromEntries(new FormData(form)));
        close();
        toast(t('exp.saved', { amount: money(r.amount) }));
        expMonth = r.date.slice(0, 7);
        expenses(ctx);
      }, form));
    },
  });
}

/* ------------------------------------------------------------ suppliers */

function suppliers(ctx) {
  const { el, setTitle, setActions, state, can } = ctx;
  setTitle(t('more.suppliers'), { back: true });
  if (can('manager')) setActions(html`<button class="icon-btn" id="new" aria-label="${t('sup.new')}">${icon('plus')}</button>`)
    .querySelector('#new').addEventListener('click', () => supplierSheet(ctx));
  const rows = state.boot.suppliers.slice().sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1));
  const count = (id) => state.boot.ingredients.filter((i) => i.supplierId === id && i.active).length;
  mount(el, html`<div class="card" style="margin-top:4px">${rows.length ? html`<ul class="list">${rows.map((s) => html`<li>
    <button class="row" data-id="${s.id}" style="${s.active ? '' : 'opacity:.55'}">
      <span class="avatar brand">${initials(s.name)}</span>
      <span class="grow"><div class="title">${s.name}${s.active ? '' : ` (${t('common.inactive')})`}</div>
        <div class="sub">${[s.contactName, s.phone].filter(Boolean).join(' · ') || t('sup.noContact')}</div>
        ${s.taxId ? html`<div class="sub">${t('sup.taxLine', { id: fmtTaxId(s.taxId), branch: branchLabel(s.branch) })}</div>` : ''}</span>
      <span class="value sub">${t('sup.nItems', { n: count(s.id) })}</span></button></li>`)}</ul>`
    : emptyState('truck', t('sup.noneTitle'), t('sup.noneText'))}</div>`);
  $$('[data-id]', el).forEach((b) => b.addEventListener('click', () => supplierSheet(ctx, rows.find((s) => s.id === b.dataset.id))));
}

function supplierSheet(ctx, item) {
  const isNew = !item;
  item = item || { active: true };
  const canEdit = ctx.can('manager');
  const ro = canEdit ? '' : raw('readonly');
  openSheet({
    title: isNew ? t('sup.new') : item.name,
    body: html`<form id="f" novalidate>
      <label class="field"><span class="label">${t('sup.name')}</span><input class="input" name="name" value="${item.name || ''}" maxlength="80" ${ro}></label>
      <label class="field"><span class="label">${t('sup.contact')}</span><input class="input" name="contactName" value="${item.contactName || ''}" maxlength="80" ${ro}></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('sup.phone')}</span><input class="input" name="phone" type="tel" value="${item.phone || ''}" maxlength="40" ${ro}></label>
        <label class="field"><span class="label">${t('sup.email')}</span><input class="input" name="email" type="email" value="${item.email || ''}" maxlength="120" ${ro}></label>
      </div>
      <div class="form-row">
        <label class="field"><span class="label">${t('sup.leadTime')}</span><input class="input" name="leadTimeDays" type="number" inputmode="numeric" min="0" step="1" value="${item.leadTimeDays ?? ''}" placeholder="1" ${ro}></label>
        <label class="field"><span class="label">${t('sup.terms')}</span><input class="input" name="paymentTermsDays" type="number" inputmode="numeric" min="0" step="1" value="${item.paymentTermsDays || ''}" placeholder="0" ${ro}></label>
      </div>
      <p class="small muted" style="margin:-6px 2px 14px">${t('sup.termsHelp')}</p>
      <div class="section-head" style="margin:6px 0 8px"><h2 style="font-size:15px">${t('sup.taxSection')}</h2></div>
      <div class="form-row">
        <label class="field"><span class="label">${t('sup.taxId')}</span><input class="input" name="taxId" inputmode="numeric" maxlength="17" value="${item.taxId ? fmtTaxId(item.taxId) : ''}" placeholder="0-0000-00000-00-0" ${ro}></label>
        <label class="field"><span class="label">${t('sup.branch')}</span><input class="input" name="branch" inputmode="numeric" maxlength="5" value="${item.branch || ''}" placeholder="00000" ${ro}></label>
      </div>
      <p class="small muted" style="margin:-6px 2px 12px">${t('sup.branchHelp')}</p>
      <label class="field"><span class="label">${t('sup.address')}</span><textarea class="textarea" name="address" maxlength="300" rows="2" ${ro}>${item.address || ''}</textarea></label>
      <label class="check" style="margin-bottom:14px"><input type="checkbox" name="vatRegistered" ${item.vatRegistered ? raw('checked') : ''} ${canEdit ? '' : raw('disabled')}> ${t('sup.vatRegistered')}</label>
      <div class="section-head" style="margin:6px 0 8px"><h2 style="font-size:15px">${t('sup.paySection')}</h2></div>
      <div class="form-row">
        <label class="field"><span class="label">${t('sup.bankName')}</span><input class="input" name="bankName" maxlength="60" list="banks" value="${item.bankName || ''}" ${ro}></label>
        <label class="field"><span class="label">${t('sup.paymentMethod')}</span><select class="select" name="paymentMethod" ${canEdit ? '' : raw('disabled')}>${options(defaults('paymentMethods'), item.paymentMethod || '', { placeholder: t('common.none') })}</select></label>
      </div>
      <datalist id="banks">${BANKS.map((b) => html`<option value="${b}">`)}</datalist>
      <div class="form-row">
        <label class="field"><span class="label">${t('sup.bankAccountName')}</span><input class="input" name="bankAccountName" maxlength="120" value="${item.bankAccountName || ''}" ${ro}></label>
        <label class="field"><span class="label">${t('sup.bankAccountNo')}</span><input class="input" name="bankAccountNo" inputmode="numeric" maxlength="20" value="${item.bankAccountNo || ''}" ${ro}></label>
      </div>
      <label class="field"><span class="label">${t('sup.notes')}</span><textarea class="textarea" name="notes" maxlength="500" ${ro}>${item.notes || ''}</textarea></label>
      ${!isNew && canEdit ? html`<label class="check"><input type="checkbox" name="active" ${item.active ? raw('checked') : ''}> ${t('common.active')}</label>` : ''}
      ${!isNew && item.phone ? html`<a class="btn block" href="tel:${item.phone}" style="margin-top:8px">${t('sup.call', { phone: item.phone })}</a>` : ''}
    </form>`,
    foot: canEdit ? html`<button class="btn primary block" id="save">${isNew ? t('sup.add') : t('common.saveChanges')}</button>` : null,
    onMount(el, close) {
      const form = el.querySelector('#f');
      const save = el.querySelector('#save');
      if (save) save.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = Object.fromEntries(new FormData(form));
        v.active = isNew ? true : form.active.checked;
        v.vatRegistered = form.vatRegistered.checked;
        try { await call('suppliers.save', { item: { ...v, id: item.id, version: item.version } }); }
        catch (err) { if (err.code === 'CONFLICT') await ctx.refresh(); throw err; }
        close();
        toast(isNew ? t('sup.added') : t('sup.saved'));
        await ctx.refresh();
        suppliers(ctx);
      }, form));
    },
  });
}

/** 0105512345678 → 0-1055-12345-67-8, the way Thai tax IDs are printed. */
export function fmtTaxId(id) {
  const d = String(id || '').replace(/\D/g, '');
  return d.length === 13 ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : d;
}
export function branchLabel(b) {
  return !b ? '' : b === '00000' ? t('sup.headOffice') : t('sup.branchNo', { n: b });
}
const BANKS = ['กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ', 'กรุงไทย', 'กรุงศรีอยุธยา', 'ทหารไทยธนชาต (ttb)', 'ออมสิน', 'ธ.ก.ส.', 'ยูโอบี', 'ซีไอเอ็มบี ไทย', 'เกียรตินาคินภัทร', 'แลนด์ แอนด์ เฮ้าส์'];

/* ----------------------------------------------------------------- team */

function team(ctx) {
  const { el, setTitle, setActions, state, can } = ctx;
  setTitle(t('more.team'), { back: true });
  if (!can('owner')) { mount(el, emptyState('users', t('more.ownersOnly'), t('team.ownersOnlyText'))); return; }
  setActions(html`<button class="icon-btn" id="new" aria-label="${t('team.new')}">${icon('plus')}</button>`)
    .querySelector('#new').addEventListener('click', () => userSheet(ctx));
  const rows = state.boot.users.slice().sort((a, b) => (a.active === b.active ? a.displayName.localeCompare(b.displayName) : a.active ? -1 : 1));
  mount(el, html`<div class="card" style="margin-top:4px"><ul class="list">${rows.map((u) => html`<li>
    <button class="row" data-id="${u.id}" style="${u.active ? '' : 'opacity:.55'}">
      <span class="avatar">${initials(u.displayName)}</span>
      <span class="grow"><div class="title">${u.displayName}</div><div class="sub">@${u.username}${u.active ? '' : ' · ' + t('team.disabled')}</div></span>
      <span class="pill ${u.role === 'owner' ? 'brand' : ''}">${roleLabel(u.role)}</span></button></li>`)}</ul></div>
    <div class="card pad" style="margin-top:14px">${ROLES.slice().reverse().map((r) => html`<p style="margin:0 0 8px"><b>${roleLabel(r)}</b> <span class="muted">— ${roleHelp(r)}</span></p>`)}</div>`);
  $$('[data-id]', el).forEach((b) => b.addEventListener('click', () => userSheet(ctx, rows.find((u) => u.id === b.dataset.id))));
}

function userSheet(ctx, item) {
  const isNew = !item;
  item = item || { active: true, role: 'staff' };
  const self = item.id === ctx.state.boot.user.id;
  openSheet({
    title: isNew ? t('team.new') : item.displayName,
    body: html`<form id="f" novalidate>
      <label class="field"><span class="label">${t('common.name')}</span><input class="input" name="displayName" value="${item.displayName || ''}" maxlength="80"></label>
      <label class="field"><span class="label">${t('login.username')}</span><input class="input" name="username" value="${item.username || ''}" autocapitalize="none" spellcheck="false" maxlength="40">
        <span class="hint">${t('team.usernameHint')}</span></label>
      <label class="field"><span class="label">${t('team.role')}</span><select class="select" name="role">${options(ROLES.slice().reverse().map((r) => ({ value: r, label: `${roleLabel(r)} — ${roleHelp(r)}` })), item.role)}</select></label>
      <label class="field"><span class="label">${isNew ? t('team.startPassword') : t('team.newPassword')}</span>
        <input class="input" name="password" type="text" autocomplete="new-password" placeholder="${isNew ? t('team.pwMin') : t('team.pwKeep')}">
        <span class="hint">${t('team.pwHint')}</span></label>
      ${isNew ? '' : html`<label class="check"><input type="checkbox" name="active" ${item.active ? raw('checked') : ''} ${self ? raw('disabled') : ''}> ${t('team.canSignIn')}</label>`}
    </form>`,
    foot: html`<button class="btn primary block" id="save">${isNew ? t('team.create') : t('common.saveChanges')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = Object.fromEntries(new FormData(form));
        v.active = isNew || self ? true : form.active.checked;
        try { await call('users.save', { item: { ...v, id: item.id, version: item.version } }); }
        catch (err) { if (err.code === 'CONFLICT') await ctx.refresh(); throw err; }
        close();
        toast(isNew ? t('team.created') : t('team.saved'));
        await ctx.refresh();
        team(ctx);
      }, form));
    },
  });
}

/* ------------------------------------------------------------- settings */

function settings(ctx) {
  const { el, setTitle, state, can } = ctx;
  setTitle(t('more.settings'), { back: true });
  if (!can('owner')) { mount(el, emptyState('settings', t('more.ownersOnly'), t('settings.ownersOnlyText'))); return; }
  const s = state.boot.settings;
  // Categories have their own page (More → หมวดหมู่); units stay a simple list here.
  const LISTS = ['units'];
  const autoRule = window.RestoPricing.effectiveRounding('', s.currency);
  const ROUNDING = ['', 'none', '1', '5', '10', '0.99', '9-ending'];
  const text = (name, hint) => html`<label class="field"><span class="label">${t(`settings.${name}`)}</span>
    <input class="input" name="${name}" value="${s[name]}">${hint ? html`<span class="hint">${hint}</span>` : ''}</label>`;
  const last = s.lastBackupAt;
  mount(el, html`<section class="card pad backup-card" style="margin-top:4px">
      <div class="section-head" style="margin:0 0 6px"><h2>${icon('download')} ${t('backup.title')}</h2></div>
      <p class="small" style="margin:0 0 4px"><b>${last ? t('backup.last', { date: `${fmtDate(s.lastBackupDate || last.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })} ${timeOf(last)}`, who: s.lastBackupBy || '' }) : t('backup.never')}</b></p>
      <p class="small muted" style="margin:0 0 12px">${t('backup.why')}</p>
      <button class="btn primary block" type="button" id="backup">${icon('download')}${t('backup.download')}</button>
      <p class="small muted" style="margin:10px 0 0">${t('backup.note')}</p>
    </section>
    <form id="f" class="card pad" style="margin-top:14px" novalidate>
      ${text('restaurantName')}
      <div class="form-row">
        <label class="field"><span class="label">${t('settings.currency')}</span><select class="select" name="currency">${options(['THB', 'USD', 'EUR', 'GBP', 'SGD', 'MYR', 'JPY', 'AUD', 'VND', 'IDR', 'PHP'], s.currency)}</select></label>
        <label class="field"><span class="label">${t('settings.targetFoodCostPct')}</span><input class="input" name="targetFoodCostPct" type="number" inputmode="decimal" value="${s.targetFoodCostPct}"></label>
      </div>
      <label class="field"><span class="label">${t('settings.foodBudget')}</span><input class="input" name="foodBudget" type="number" inputmode="decimal" min="0" step="any" value="${s.foodBudget || ''}" placeholder="${t('common.optional')}">
        <span class="hint">${t('settings.foodBudgetHelp')}</span></label>
      <label class="field"><span class="label">${t('settings.costMethod')}</span><select class="select" name="costMethod">${options([{ value: 'average', label: t('settings.average') }, { value: 'last', label: t('settings.last') }], s.costMethod)}</select></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('settings.vatRate')}</span><input class="input" name="vatRate" type="number" inputmode="decimal" min="0" step="any" value="${s.vatRate}"></label>
        <label class="field"><span class="label">${t('settings.priceTolerancePct')}</span><input class="input" name="priceTolerancePct" type="number" inputmode="decimal" min="0" step="any" value="${s.priceTolerancePct}"></label>
      </div>
      <p class="small muted" style="margin:-6px 2px 14px">${t('settings.purchasingHelp')}</p>
      <label class="field"><span class="label">${t('settings.priceRounding')}</span><select class="select" name="priceRounding">${options(ROUNDING.map((r) => ({
        value: r, label: r ? t(`settings.rounding.${r}`) : t('settings.rounding.auto', { rule: t(`settings.rounding.${autoRule}`) }) })), s.priceRounding || '')}</select>
        <span class="hint">${t('settings.roundingHelp')}</span></label>
      ${LISTS.map((n) => text(n, t('settings.commaHint')))}
      <p class="small muted" style="margin:-6px 2px 14px">${t('settings.channelsMoved')}</p>
      <button class="btn sm" type="button" id="defaults" style="margin:-4px 0 18px">${icon('refresh')}${t('settings.useDefaults')}</button>
      <button class="btn primary block" id="save" type="button">${t('settings.save')}</button>
    </form>`);
  const form = $('#f');
  $('#backup').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const b = await call('backup.export', { today: today() });
    downloadJson(b, `restaurant-ops-backup-${today()}.json`);
    const n = Object.values(b.counts || {}).reduce((a, x) => a + x, 0);
    toast(t('backup.done', { n: n.toLocaleString('th-TH') }));
    await ctx.refresh();
    settings(ctx);
  }));
  $('#defaults').addEventListener('click', () => {
    LISTS.forEach((n) => { form[n].value = defaults(n).join(', '); });
    toast(t('settings.defaultsFilled'), 'info');
  });
  $('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    await call('settings.save', { values: Object.fromEntries(new FormData(form)) });
    await ctx.refresh();
    toast(t('settings.saved'));
    settings(ctx);
  }, form));
}

/* -------------------------------------------------------------- account */

function account(ctx) {
  const { el, setTitle, state } = ctx;
  setTitle(t('account.title'), { back: true });
  const u = state.boot.user;
  const theme = (() => { try { return localStorage.getItem('ro.theme') || 'system'; } catch { return 'system'; } })();
  mount(el, html`
    <div class="card pad" style="margin-top:4px;display:flex;gap:14px;align-items:center">
      <span class="avatar" style="width:52px;height:52px;font-size:18px">${initials(u.displayName)}</span>
      <div><div style="font-weight:700;font-size:17px">${u.displayName}</div><div class="muted">@${u.username} · ${roleLabel(u.role)}</div></div></div>
    <section class="section"><div class="section-head"><h2>${t('account.appearance')}</h2></div>
      <div class="seg" role="group" aria-label="${t('account.appearance')}">${['system', 'light', 'dark'].map((th) =>
        html`<button data-theme-opt="${th}" aria-pressed="${theme === th}">${t(`account.theme.${th}`)}</button>`)}</div></section>
    <section class="section"><div class="section-head"><h2>${t('account.changePassword')}</h2></div>
      <form id="pw" class="card pad" novalidate>
        <label class="field"><span class="label">${t('account.currentPw')}</span><input class="input" type="password" name="current" autocomplete="current-password"></label>
        <label class="field"><span class="label">${t('account.newPw')}</span><input class="input" type="password" name="next" autocomplete="new-password" minlength="8">
          <span class="hint">${t('team.pwMin')}</span></label>
        <button class="btn primary block" type="submit">${t('account.updatePw')}</button>
      </form></section>
    ${session.mode === 'demo' ? html`<section class="section"><div class="card pad">
      <b>${t('account.demoTitle')}</b><p class="small muted" style="margin:4px 0 12px">${t('account.demoText')}</p>
      <button class="btn danger block" id="reset">${icon('refresh')}${t('account.resetDemo')}</button></div></section>` : ''}`);
  $$('[data-theme-opt]', el).forEach((b) => b.addEventListener('click', () => {
    const th = b.dataset.themeOpt;
    try { if (th === 'system') localStorage.removeItem('ro.theme'); else localStorage.setItem('ro.theme', th); } catch { /* ignore */ }
    applyTheme();
    $$('[data-theme-opt]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  const pw = $('#pw');
  pw.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(pw.querySelector('[type=submit]'), async () => {
      await call('auth.changePassword', { current: pw.current.value, next: pw.next.value });
      pw.reset();
      toast(t('account.pwUpdated'));
    }, pw);
  });
  const reset = $('#reset');
  if (reset) reset.addEventListener('click', async () => {
    if (!await confirmSheet({ title: t('account.resetTitle'), message: t('account.resetMessage'), confirm: t('account.reset'), danger: true })) return;
    await resetDemo();
    session.clear();
    location.hash = '';
    location.reload();
  });
}

export function applyTheme() {
  let th = null;
  try { th = localStorage.getItem('ro.theme'); } catch { /* ignore */ }
  if (th) document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
}
applyTheme();

/** Saves data as a .json file on this device (phone or computer). */
function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
