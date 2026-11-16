// More → ความปลอดภัย (owner): 2-step verification, sign everyone out, and the security log.
import { call } from '../api.js';
import { html, mount, icon, $, $$, openSheet, confirmSheet, toast, busy, emptyState, fmtDate, timeOf, today, printHtml } from '../ui.js';
import { t } from '../i18n.js';
import qrcode from '../vendor/qrcode.js';

const WATCH = ['login.fail', 'login.locked', 'login.codefail', 'pin.fail', 'pin.blocked', 'device.suspended'];
const EVENT_ICON = { 'login.ok': 'check', 'pin.ok': 'check', 'login.fail': 'alert', 'login.locked': 'alert', 'login.codefail': 'alert', 'pin.fail': 'alert', 'pin.blocked': 'alert',
  'device.suspended': 'alert', 'device.joined': 'plus', 'backup.exported': 'download', 'sessions.revoked': 'logout' };
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const when = (iso) => { const d = localDay(iso); return `${d === today() ? t('sec.today') : fmtDate(d, { day: 'numeric', month: 'short' })} ${timeOf(iso)}`; };

/** The log's short notes in Thai (the server keeps them as plain words). */
function detailText(e) {
  const d = e.detail || '';
  const role = (x) => x.replace(/(owner|manager|staff)/g, (r) => t(`role.${r}`));
  if (e.kind === 'user.created') return role(d);
  if (e.kind === 'user.role') return d === 'permissions' ? t('sec.d.permissions') : role(d);
  if (e.kind === 'sessions.revoked') return d === 'everyone' ? t('sec.d.everyone') : t('sec.d.own');
  if (e.kind === 'twostep.recovery') return t('sec.d.left', { n: parseInt(d, 10) || 0 });
  if (e.kind === 'login.locked') return d === 'account' ? t('sec.d.account') : '';
  if (e.kind === 'device.joined' || e.kind === 'device.suspended' || e.kind === 'pin.ok') return d;
  return '';
}

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}

let filter = 'all';

export async function renderSecurity(ctx) {
  const { el, setTitle, can } = ctx;
  setTitle(t('sec.title'), { back: true });
  if (!can('owner')) { mount(el, emptyState('settings', t('more.ownersOnly'), t('sec.ownerOnly'))); return; }
  mount(el, html`<div class="skeleton" style="height:150px;margin-top:4px"></div><div class="skeleton" style="height:260px;margin-top:12px"></div>`);
  const r = await call('security.overview', {});
  if (ctx.stale()) return;
  const events = filter === 'watch' ? r.events.filter((e) => WATCH.includes(e.kind)) : r.events;
  mount(el, html`
    <section class="card pad sec-card ${r.twoStep ? 'is-on' : ''}" style="margin-top:4px">
      <div class="sec-head">${icon(r.twoStep ? 'check' : 'alert')}<div><b>${t('sec.twoStep')}</b>
        <div class="small">${r.twoStep ? t('sec.twoStepOn', { n: r.recoveryLeft }) : t('sec.twoStepOffText')}</div></div></div>
      ${r.twoStep ? html`<div class="form-row" style="margin-top:12px"><button class="btn" id="new-codes">${t('sec.newCodes')}</button><button class="btn danger" id="off">${t('sec.turnOff')}</button></div>`
        : html`<button class="btn primary block" id="on" style="margin-top:12px">${t('sec.turnOn')}</button>`}
    </section>

    <section class="section"><div class="section-head"><h2>${t('sec.signIns')}</h2></div>
      <div class="card pad">
        ${r.newAlerts ? html`<div class="sched-hint warn" style="margin:0 0 12px">${icon('alert')}<span>${t('sec.newAlerts', { n: r.newAlerts })}</span></div>` : ''}
        <div class="kpi-row" style="margin-top:0"><div><span>${t('sec.failed24h')}</span><b class="${r.failed24h ? 'bad-ink' : ''}">${r.failed24h}</b>${r.unknownToday ? html`<small class="muted" style="display:block;font-size:11.5px">${t('sec.unknownToday', { n: r.unknownToday })}</small>` : ''}</div>
          <div><span>${t('sec.devices')}</span><b>${r.devices}</b></div><div><span>${t('sec.passwords')}</span><b>${r.peopleWithPassword}</b></div></div>
        <button class="btn block" id="out-all">${icon('logout')}${t('sec.signOutAll')}</button>
        <p class="small muted" style="margin:8px 0 0">${t('sec.signOutAllHint')}</p>
      </div></section>

    <section class="section"><div class="section-head"><h2>${t('sec.log')}</h2>
        <div class="chips" style="margin:0;padding:0"><button class="chip" data-f="all" aria-pressed="${filter === 'all'}">${t('sec.all')}</button>
          <button class="chip" data-f="watch" aria-pressed="${filter === 'watch'}">${t('sec.watch')}</button></div></div>
      <div class="card">${events.length ? html`<ul class="list sec-log">${events.map((e) => html`<li><div class="row">
        <span class="avatar sm ${WATCH.includes(e.kind) ? 'bad' : ''}">${icon(EVENT_ICON[e.kind] || 'info')}</span>
        <span class="grow"><div class="title">${t(`sec.ev.${e.kind}`)}${e.name || e.actor ? html` · <span class="muted">${e.name || e.actor}</span>` : ''}</div>
          <div class="sub">${when(e.at)}${detailText(e) ? ` · ${detailText(e)}` : ''}${e.ip ? ` · ${e.ip}` : ''}</div></span></div></li>`)}</ul>`
        : emptyState('check', t('sec.noEventsTitle'), t('sec.noEventsText'))}</div>
      <p class="small muted" style="margin:8px 2px 0">${t('sec.logHint')}</p></section>

    <section class="section"><div class="section-head"><h2>${t('sec.tips')}</h2></div>
      <div class="card pad"><ul class="sec-tips">${[1, 2, 3, 4, 5].map((n) => html`<li>${t(`sec.tip${n}`)}</li>`)}</ul></div></section>`);

  $$('[data-f]', el).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; renderSecurity(ctx); }));
  $('#on', el)?.addEventListener('click', () => passwordSheet(ctx, t('sec.turnOn'), t('sec.turnOnText'), async (password) => {
    const start = await call('security.twoStepStart', { password });
    setTimeout(() => enrolSheet(ctx, start), 80);
  }));
  $('#off', el)?.addEventListener('click', () => passwordSheet(ctx, t('sec.turnOff'), t('sec.turnOffText'), async (password) => {
    await call('security.twoStepOff', { password });
    toast(t('sec.turnedOff'));
    renderSecurity(ctx);
  }, true));
  $('#new-codes', el)?.addEventListener('click', () => passwordSheet(ctx, t('sec.newCodes'), t('sec.newCodesText'), async (password) => {
    const out = await call('security.newRecoveryCodes', { password });
    codesSheet(ctx, out.recoveryCodes);
  }));
  $('#out-all', el).addEventListener('click', async () => {
    if (!(await confirmSheet({ title: t('sec.signOutAll'), message: t('sec.signOutAllText'), confirm: t('sec.signOutAll'), danger: true }))) return;
    try { const out = await call('security.signOutAll', {}); toast(t('sec.signedOutAll', { n: out.people }), 'good', 5000); renderSecurity(ctx); } catch (e) { toast(e.message, 'bad', 5000); }
  });
}

/** Scan the QR with an authenticator app, then type the code it shows. */
function enrolSheet(ctx, start) {
  openSheet({
    title: t('sec.turnOn'),
    body: html`<ol class="signin-steps"><li>${t('sec.step1')}</li><li>${t('sec.step2')}</li><li>${t('sec.step3')}</li></ol>
      <div class="sec-qr" id="qr"></div>
      <p class="small muted" style="text-align:center;word-break:break-all">${t('sec.manual')} <b>${start.secret.replace(/(.{4})/g, '$1 ').trim()}</b></p>
      <form id="cf" novalidate><label class="field"><span class="label">${t('sec.code')}</span>
        <input class="input pin-input" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" required></label>
        <button class="btn primary block" type="submit">${t('sec.confirm')}</button></form>`,
    onMount(el, close) {
      $('#qr', el).innerHTML = qrSvg(start.uri);   // an SVG built by the QR library from our own link
      const f = $('#cf', el);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(f.querySelector('[type=submit]'), async () => {
          const out = await call('security.twoStepConfirm', { code: f.code.value });
          close();
          setTimeout(() => codesSheet(ctx, out.recoveryCodes), 50);
        }, f);
      });
    },
  });
}

/** Recovery codes are shown once: write them down or print them. */
function codesSheet(ctx, codes) {
  openSheet({
    title: t('sec.codesTitle'),
    body: html`<p style="margin-top:0">${t('sec.codesText')}</p>
      <div class="sec-codes">${codes.map((c) => html`<code>${c}</code>`)}</div>`,
    foot: html`<button class="btn" id="print">${icon('print')}${t('sec.printCodes')}</button><button class="btn primary" data-close>${t('sec.codesDone')}</button>`,
    onMount(el) {
      $('#print', el).addEventListener('click', () => printHtml(html`<section class="slip-print"><h1>${t('sec.codesPrintTitle', { shop: ctx.state.boot.settings.restaurantName })}</h1>
        <p>${t('sec.codesText')}</p><div class="sec-codes">${codes.map((c) => html`<code>${c}</code>`)}</div></section>`));
    },
    onClose() { renderSecurity(ctx); },
  });
}

function passwordSheet(ctx, title, text, run, danger) {
  openSheet({
    title,
    body: html`<p style="margin-top:0">${text}</p><form id="pf" novalidate><label class="field"><span class="label">${t('login.password')}</span>
      <input class="input" name="password" type="password" autocomplete="current-password" required></label></form>`,
    foot: html`<button class="btn" data-close>${t('common.cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" id="go">${title}</button>`,
    onMount(el, close) {
      const f = $('#pf', el);
      const go = () => busy($('#go', el), async () => { await run(f.password.value); close(); }, f);
      f.addEventListener('submit', (e) => { e.preventDefault(); go(); });
      $('#go', el).addEventListener('click', go);
    },
  });
}
