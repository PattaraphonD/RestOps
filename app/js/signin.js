// Staff sign-in on their own phone: join once with today's shop QR, then tap your name and enter a 6-digit PIN.
// Built for people who aren't comfortable with apps: no typing except the PIN, big targets, one thing per screen.
import { session, joinShop, getRoster, pinLogin, forgetDevice } from './api.js';
import { html, mount, icon, $, $$ } from './ui.js';
import { t } from './i18n.js';

const COLOURS = ['#2e6e71', '#d06f66', '#8a6d1f', '#4b5d9c', '#7a4f8a', '#2f8f4e', '#a5463d', '#3d7a9c'];
const avatarColour = (p, i) => p.colour || COLOURS[i % COLOURS.length];
const initial = (name) => Array.from(String(name || '?').replace(/^(น้อง|พี่|คุณ|ป้า|ลุง)\s*/, ''))[0] || '?';

/**
 * Draws the right sign-in step into `root`.
 *   onSignedIn()     — called after a successful PIN sign-in
 *   passwordLogin()  — draws the username/password form (owner, or a phone that hasn't joined)
 */
export function renderSignIn(root, { onSignedIn, passwordLogin }) {
  const m = /^#\/join\/(.+)$/.exec(location.hash);
  if (m) return joinStep(root, decodeURIComponent(m[1]), { onSignedIn, passwordLogin });
  if (session.deviceKey) return pickStep(root, { onSignedIn, passwordLogin });
  return passwordLogin();
}

function frame(root, body) {
  mount(root, html`<div class="login signin">${body}</div>`);
}

async function joinStep(root, code, opts) {
  // A QR from the sample shop ends in ".demo"; every other QR is the real shop, even on a phone that once tried the demo.
  const demo = /\.demo$/.test(code);
  session.setMode(demo ? 'demo' : 'remote');
  if (demo) code = code.slice(0, -5);
  frame(root, html`<div class="signin-center"><div class="brand-mark">${icon('plate')}</div>
    <h1>${t('signin.joining')}</h1><div class="skeleton" style="height:8px;width:160px;margin:18px auto 0"></div></div>`);
  try {
    const r = await joinShop(code);
    history.replaceState(null, '', '#/');
    frame(root, html`<div class="signin-center"><div class="signin-ok">${icon('check')}</div>
      <h1>${t('signin.joined', { shop: r.shopName })}</h1><p class="lede">${t('signin.joinedNext')}</p></div>`);
    setTimeout(() => pickStep(root, opts), 1400);
  } catch (e) {
    history.replaceState(null, '', '#/');
    rescanStep(root, opts, e.message);
  }
}

/** This phone isn't (or is no longer) joined: what to do, in plain words. */
function rescanStep(root, opts, message) {
  frame(root, html`<div class="signin-center"><div class="signin-warn">${icon('alert')}</div>
    <h1>${t('signin.needQr')}</h1>
    ${message ? html`<p class="small" style="color:var(--bad-ink)">${message}</p>` : ''}
    <ol class="signin-steps"><li>${t('signin.step1')}</li><li>${t('signin.step2')}</li><li>${t('signin.step3')}</li></ol>
    <button class="btn block" id="pw">${t('signin.usePassword')}</button></div>`);
  $('#pw', root).addEventListener('click', () => opts.passwordLogin());
}

async function pickStep(root, opts) {
  frame(root, html`<div class="skeleton" style="height:40px;margin:40px 0 16px"></div><div class="signin-tiles">
    ${[0, 1, 2, 3].map(() => html`<div class="skeleton" style="height:120px"></div>`)}</div>`);
  let r;
  try { r = await getRoster(); } catch (e) {
    if (e.code === 'DEVICE' || e.code === 'AUTH') { forgetDevice(); return rescanStep(root, opts, e.message); }
    frame(root, html`<div class="signin-center"><div class="signin-warn">${icon('wifiOff')}</div><h1>${t('signin.offline')}</h1>
      <p class="small muted">${e.message}</p><button class="btn primary block" id="again">${icon('refresh')}${t('common.tryAgain')}</button></div>`);
    $('#again', root).addEventListener('click', () => pickStep(root, opts));
    return;
  }
  const last = session.lastStaffId;
  const people = r.staff.slice().sort((a, b) => (b.id === last) - (a.id === last));
  frame(root, html`
    <div class="signin-head"><div class="small muted">${r.shopName}</div><h1>${t('signin.whoAreYou')}</h1></div>
    ${people.length ? html`<div class="signin-tiles">${people.map((p, i) => html`<button class="signin-tile" data-id="${p.id}">
        <span class="signin-avatar" style="background:${avatarColour(p, i)}">${initial(p.name)}</span>
        <b>${p.name}</b><span class="small muted">${p.position || t(`role.${p.role}`)}</span>
        ${p.id === last ? html`<span class="pill brand">${t('signin.isItYou')}</span>` : ''}</button>`)}</div>`
      : html`<p class="lede">${t('signin.noStaff')}</p>`}
    <button class="link-btn signin-owner" id="pw">${icon('user')} ${t('signin.ownerLogin')}</button>`);
  $$('[data-id]', root).forEach((b) => b.addEventListener('click', () => {
    const p = people.find((x) => x.id === b.dataset.id);
    pinStep(root, p, people.indexOf(p), opts);
  }));
  $('#pw', root).addEventListener('click', () => opts.passwordLogin());
}

function pinStep(root, person, index, opts) {
  let pin = '';
  let busy = false;
  frame(root, html`
    <button class="link-btn signin-back" id="back">${icon('chevL')} ${t('signin.notYou')}</button>
    <div class="signin-center">
      <span class="signin-avatar lg" style="background:${avatarColour(person, index)}">${initial(person.name)}</span>
      <h1>${person.name}</h1><p class="lede" id="pin-msg">${t('signin.enterPin')}</p>
      <div class="pin-dots" id="dots" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map(() => html`<i></i>`)}</div>
    </div>
    <div class="keypad" role="group" aria-label="${t('signin.enterPin')}">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) => (k === '' ? html`<span></span>`
        : html`<button class="key" data-k="${k}" aria-label="${k === 'del' ? t('signin.delete') : k}">${k === 'del' ? icon('chevL') : k}</button>`))}
    </div>`);
  const dots = $$('#dots i', root);
  const msg = $('#pin-msg', root);
  const show = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const say = (text, bad) => { msg.textContent = text; msg.style.color = bad ? 'var(--bad-ink)' : ''; };
  const submit = async () => {
    busy = true;
    say(t('signin.checking'));
    try {
      await pinLogin(person.id, pin);
      opts.onSignedIn();
    } catch (e) {
      busy = false;
      pin = '';
      show();
      $('#dots', root).classList.remove('shake'); void $('#dots', root).offsetWidth; $('#dots', root).classList.add('shake');
      if (navigator.vibrate) { try { navigator.vibrate(200); } catch { /* ignore */ } }
      // A removed phone goes back to "scan the QR"; a phone suspended for wrong PINs just says so.
      if (e.code === 'DEVICE' && !session.deviceKey) return rescanStep(root, opts, e.message);
      say(e.message, true);
    }
  };
  const press = (k) => {
    if (busy) return;
    if (k === 'del') pin = pin.slice(0, -1);
    else if (pin.length < 6) pin += k;
    show();
    if (pin.length === 6) submit();
  };
  $$('[data-k]', root).forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
  // A keyboard works too (desktop, or a phone's hardware keyboard).
  const onKey = (e) => {
    if (!document.body.contains(msg)) return document.removeEventListener('keydown', onKey);
    if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del');
  };
  document.addEventListener('keydown', onKey);
  $('#back', root).addEventListener('click', () => pickStep(root, opts));
}
