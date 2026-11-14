// App shell: session, routing, navigation, shared state.
import { call, session, login, logout, setAuthLostHandler } from './api.js';
import { html, raw, mount, icon, toast, setFormat, busy, showFormError, today, $ } from './ui.js';
import { t } from './i18n.js';

// The shop's server: the Supabase function (v2) or, as a fallback, the Apps Script web app.
const SERVER_URL = /^https:\/\/([a-z0-9-]+\.supabase\.co\/functions\/v1\/|script\.google(usercontent)?\.com\/)/;

const ROLES = { staff: 1, manager: 2, owner: 3 };
const VIEWS = {
  home: () => import('./views/home.js'),
  stock: () => import('./views/stock.js'),
  sales: () => import('./views/sales.js'),
  menu: () => import('./views/menu.js'),
  orders: () => import('./views/purchasing.js'),
  more: () => import('./views/more.js'),
  close: () => import('./views/close.js'),
};
const NAV = [
  ['home', 'nav.home', 'home'],
  ['stock', 'nav.stock', 'box'],
  ['menu', 'nav.menu', 'chef'],
  ['sales', 'nav.sales', 'receipt'],
  ['more', 'nav.more', 'grid'],
];

export const state = { boot: null };
const root = document.getElementById('root');
let renderToken = 0;

/* ----------------------------------------------------------------- state */

export async function refresh() {
  const boot = await call('bootstrap', { today: today() });
  state.boot = boot;
  setFormat(boot.settings);
  session.setUser(boot.user);
  updateBadges();
  return boot;
}
export function can(role) { return !!state.boot && ROLES[state.boot.user.role] >= ROLES[role]; }
export function navigate(hash) { if (location.hash === hash) render(); else location.hash = hash; }
export function list(csv) { return String(csv || '').split(',').map((s) => s.trim()).filter(Boolean); }

function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/').filter(Boolean);
  return { name: VIEWS[parts[0]] ? parts[0] : 'home', params: parts.slice(1) };
}

function updateBadges() {
  const badge = $('.nav [data-badge="stock"]');
  if (!badge || !state.boot) return;
  const n = state.boot.ingredients.filter((i) => i.active && i.status !== 'ok').length;
  badge.textContent = n;
  badge.classList.toggle('hidden', !n);
  badge.setAttribute('aria-label', t('nav.lowBadge', { n }));
  // Orders live under More: its badge counts deliveries due (and, for managers, invoices to check or pay).
  const ob = $('.nav [data-badge="more"]');
  if (ob && state.boot.purchasing) {
    const pc = state.boot.purchasing;
    const m = pc.expectedToday + (can('manager') ? pc.toReview + pc.overdue : 0);
    ob.textContent = m;
    ob.classList.toggle('hidden', !m);
    ob.setAttribute('aria-label', t('nav.ordersBadge', { n: m }));
  }
}

/* ----------------------------------------------------------------- shell */

function shell() {
  mount(root, html`
    <div class="app">
      <header class="app-bar">
        <button class="icon-btn back hidden" aria-label="${t('common.back')}">${icon('chevL')}</button>
        <div class="titles"><div class="eyebrow"></div><h1></h1></div>
        <div class="bar-actions" style="display:flex;gap:4px"></div>
      </header>
      <main class="page" id="page" tabindex="-1"></main>
      <nav class="nav" aria-label="${t('nav.main')}">
        ${NAV.map(([key, label, ic]) => html`<a href="#/${key}" data-nav="${key}">${icon(ic)}<span>${t(label)}</span>
          ${key === 'stock' || key === 'more' ? html`<span class="badge hidden" data-badge="${key}"></span>` : ''}</a>`)}
      </nav>
    </div>`);
  const bar = $('.app-bar');
  window.addEventListener('scroll', () => bar.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  $('.app-bar .back').addEventListener('click', () => history.length > 1 ? history.back() : navigate('#/more'));
}

function setTitle(title, { eyebrow, back } = {}) {
  $('.app-bar h1').textContent = title;
  $('.app-bar .eyebrow').textContent = eyebrow ?? (state.boot ? state.boot.settings.restaurantName : '');
  $('.app-bar .back').classList.toggle('hidden', !back);
  document.title = `${title} · ${state.boot ? state.boot.settings.restaurantName : t('app.name')}`;
}

function setActions(content) { mount($('.app-bar .bar-actions'), content || ''); return $('.app-bar .bar-actions'); }

/* ---------------------------------------------------------------- render */

export async function render() {
  const token = ++renderToken;
  document.querySelectorAll('.fab').forEach((f) => f.remove());
  if (!session.token) { renderLogin(); return; }
  if (!$('.app')) shell();
  if (!state.boot) {
    mount($('#page'), html`<div class="skeleton" style="height:120px;margin-top:12px"></div>
      <div class="skeleton" style="height:84px;margin-top:12px"></div><div class="skeleton" style="height:220px;margin-top:12px"></div>`);
    try { await refresh(); } catch (e) {
      if (e.code === 'AUTH') return;
      mount($('#page'), html`<div class="empty">${icon('wifiOff')}<h3>${t('app.loadFailed')}</h3><div>${e.message}</div>
        <div style="margin-top:16px"><button class="btn primary" id="retry">${icon('refresh')}${t('common.tryAgain')}</button></div></div>`);
      $('#retry').addEventListener('click', render);
      return;
    }
  }
  if (token !== renderToken) return;
  const { name, params } = route();
  document.querySelectorAll('.nav a').forEach((a) => {
    // Orders (purchasing) live under More.
    if (a.dataset.nav === (name === 'orders' ? 'more' : name === 'close' ? 'home' : name)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  updateBadges();
  const page = $('#page');
  setActions('');
  const mod = await VIEWS[name]();
  if (token !== renderToken) return;
  page.innerHTML = '';
  window.scrollTo(0, 0);
  try {
    await mod.render({ el: page, params, state, setTitle, setActions, refresh, navigate, can, rerender: render,
      stale: () => token !== renderToken });
  } catch (e) {
    if (e.code === 'AUTH') return;
    mount(page, html`<div class="empty">${icon('alert')}<h3>${t('app.error')}</h3><div>${e.message}</div>
      <div style="margin-top:16px"><button class="btn" id="retry">${icon('refresh')}${t('common.reload')}</button></div></div>`);
    $('#retry').addEventListener('click', render);
  }
}

/* ----------------------------------------------------------------- login */

function renderLogin() {
  state.boot = null;
  document.title = `${t('login.signIn')} · ${t('app.name')}`;
  const demo = session.mode === 'demo';
  mount(root, html`
    <div class="login">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="brand-mark">${icon('plate')}</div></div>
      <h1>${t('app.name')}</h1>
      <p class="lede">${t('login.lede')}</p>
      <form id="login-form" novalidate>
        <label class="field"><span class="label">${t('login.username')}</span>
          <input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label class="field"><span class="label">${t('login.password')}</span>
          <input class="input" name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary block" type="submit">${t('login.signIn')}</button>
        ${demo ? html`<p class="small muted" style="margin:10px 2px 0">${t('login.demoNote')}</p>` : ''}
      </form>
      <div class="divider">${t('login.or')}</div>
      <button class="btn block" id="demo-btn">${icon('chart')}<span>${t('login.demo')}</span></button>
      <details class="server" ${!session.apiUrl && !demo ? raw('open') : ''}>
        <summary>${t('login.server')}</summary>
        <label class="field" style="margin-top:8px"><span class="label">${t('login.serverUrl')}</span>
          <input class="input" id="api-url" inputmode="url" placeholder="https://…supabase.co/functions/v1/api" value="${session.apiUrl}">
          <span class="hint">${t('login.serverHint')}</span></label>
        ${demo ? html`<button class="btn sm" type="button" id="use-server">${t('login.useServer')}</button>` : ''}
      </details>
    </div>`);

  const form = $('#login-form');
  const urlInput = $('#api-url');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    busy(btn, async () => {
      if (session.mode !== 'demo') {
        if (urlInput.value.trim() && !SERVER_URL.test(urlInput.value.trim())) {
          throw new Error(t('login.badUrl'));
        }
        session.setApiUrl(urlInput.value);
      }
      await login(form.username.value, form.password.value);
      location.hash = '#/home';
      render();
    }, form);
  });
  $('#demo-btn').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    session.setMode('demo');
    e.currentTarget.querySelector('span').textContent = t('login.preparing');
    await login('owner', 'demo1234');
    location.hash = '#/home';
    toast(t('login.demoWelcome'), 'info');
    render();
  }, form));
  const useServer = $('#use-server');
  if (useServer) useServer.addEventListener('click', () => { session.setMode('remote'); renderLogin(); });
  showFormError(form, null);
}

export async function signOut() {
  await logout();
  state.boot = null;
  location.hash = '';
  renderLogin();
}

/* ------------------------------------------------------------------ boot */

setAuthLostHandler((err) => {
  session.clear();
  state.boot = null;
  toast(err.message, 'bad', 5000);
  renderLogin();
});

function offlineBanner() {
  let b = $('.offline-banner');
  if (navigator.onLine || session.mode === 'demo') { b && b.remove(); return; }
  if (!b) {
    b = document.createElement('div');
    b.className = 'offline-banner';
    b.setAttribute('role', 'status');
    mount(b, html`${icon('wifiOff')}<span>${t('app.offline')}</span>`);
    document.body.append(b);
  }
}
window.addEventListener('online', offlineBanner);
window.addEventListener('offline', offlineBanner);
window.addEventListener('hashchange', render);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* app still works without it */ });
}

document.documentElement.lang = 'th';
render();
offlineBanner();
