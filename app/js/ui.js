// UI toolkit: safe HTML templating, formatting, icons, sheets, toasts.
import { t, locale } from './i18n.js';

/* ------------------------------------------------------------ templating */

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function piece(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(piece).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}
/** Tagged template: every interpolated value is escaped unless wrapped in raw() or another html``. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += piece(v) + strings[i + 1]; });
  return new Safe(out);
}
export function mount(el, content) { el.innerHTML = piece(content); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------ formatting */

// Numbers and dates follow the chosen app language; the currency comes from Settings.
let fmt = { currency: 'THB' };
export function setFormat(settings) {
  fmt = { currency: settings.currency || 'THB' };
}
export function money(n, opts = {}) {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat(locale(), {
      style: 'currency', currency: fmt.currency,
      minimumFractionDigits: opts.cents === false ? 0 : (opts.compact ? 0 : 2),
      maximumFractionDigits: opts.cents === false || opts.compact ? 0 : 2,
      notation: opts.compact && Math.abs(v) >= 10000 ? 'compact' : 'standard',
    }).format(v);
  } catch { return v.toFixed(2); }
}
export function number(n, dp = 2) {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: dp }).format(Number(n) || 0);
}
export function qty(n, unit) { return `${number(n, 3)} ${unit || ''}`.trim(); }
export function pct(n, dp = 1) { return n === null || n === undefined ? '—' : `${number(n, dp)}%`; }

export function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function fmtDate(dateStr, opts = { day: 'numeric', month: 'short' }) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(), { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d || 1)));
}
export function relDay(dateStr) {
  const d = today();
  if (dateStr === d) return t('common.today');
  if (dateStr === addDays(d, -1)) return t('common.yesterday');
  return fmtDate(dateStr, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function fmtMonth(month, long = true) {
  return fmtDate(month + '-01', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
}
export function timeOf(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
export function initials(name) {
  const words = String(name || '').split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w && !/^\p{N}/u.test(w));
  if (!words.length) return '?';
  // Thai: one letter, the first consonant (skip leading vowels เ แ โ ใ ไ).
  if (/^[฀-๿]/.test(words[0])) return (words[0].match(/[ก-ฮ]/) || [words[0][0]])[0];
  return words.slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();
}

/* ----------------------------------------------------------------- icons */

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  chef: '<path d="M6 13.9A4 4 0 0 1 7.5 6a5 5 0 0 1 9 0A4 4 0 0 1 18 13.9V20H6Z"/><path d="M6 17h12"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  alert: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17.5v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  fork: '<path d="M7 3v7a2 2 0 0 0 4 0V3M9 10v11"/><path d="M17 3c-1.7 0-3 2.2-3 5s1.3 4 3 4v9"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  waste: '<path d="M4 7h16M6 7l1 13h10l1-13M9 7V4h6v3"/><path d="m10 12 4 4m0-4-4 4"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><path d="M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2Z"/><circle cx="16" cy="14.5" r="1"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15v2M11 11v6M15 7v10M19 12v5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  wifiOff: '<path d="M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.8M16.9 11.4a10 10 0 0 1 2.1 1.5M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 21h14"/>',
  plate: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  scale: '<path d="M12 3v18M5 21h14M6 7h12"/><path d="m6 7-3 7a3 3 0 0 0 6 0Zm12 0-3 7a3 3 0 0 0 6 0Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
};
export function icon(name, cls = '') {
  return raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);
}

/* ---------------------------------------------------------------- toasts */

export function toast(message, kind = 'good', ms = 3200) {
  let host = $('.toast-host');
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('role', 'status'); document.body.append(host); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  mount(t, html`${icon(kind === 'bad' ? 'alert' : kind === 'info' ? 'info' : 'check')}<span>${message}</span>`);
  host.append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------------------------------------------------------------- sheets */

const openSheets = [];
let ignorePops = 0;
window.addEventListener('popstate', () => {
  if (ignorePops) { ignorePops--; return; }
  const top = openSheets[openSheets.length - 1];
  if (top) top.close(true);
});

/**
 * Bottom sheet dialog.
 * openSheet({ title, body, foot, onMount(el, close), onClose() }) → { el, close }
 */
export function openSheet({ title, body, foot, onMount, onClose, wide }) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  mount(scrim, html`
    <div class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-head"><h2>${title}</h2>
        <button class="icon-btn" data-close aria-label="${t('common.close')}">${icon('x')}</button></div>
      <div class="sheet-body">${body}</div>
      ${foot ? html`<div class="sheet-foot">${foot}</div>` : ''}
    </div>`);
  const prevFocus = document.activeElement;
  document.body.append(scrim);
  document.body.style.overflow = 'hidden';
  history.pushState({ sheet: true }, '');
  let closed = false;
  const api = {
    el: scrim.querySelector('.sheet'),
    close(fromPop) {
      if (closed) return;
      closed = true;
      openSheets.splice(openSheets.indexOf(api), 1);
      scrim.remove();
      if (!openSheets.length) document.body.style.overflow = '';
      if (!fromPop && history.state && history.state.sheet) { ignorePops++; history.back(); }
      onClose && onClose();
      prevFocus && prevFocus.focus && prevFocus.focus({ preventScroll: true });
    },
  };
  openSheets.push(api);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim || e.target.closest('[data-close]')) api.close();
  });
  scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.close(); });
  onMount && onMount(api.el, api.close);
  const first = api.el.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
  if (first && matchMedia('(pointer: fine)').matches) first.focus(); else api.el.querySelector('[data-close]').focus({ preventScroll: true });
  return api;
}

export function confirmSheet({ title, message, confirm = t('common.confirm'), danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title,
      body: html`<p style="margin:4px 0 8px;color:var(--ink-2)">${message}</p>`,
      foot: html`<button class="btn" data-close>${t('common.cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${confirm}</button>`,
      onMount(el, close) {
        el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; resolve(true); close(); });
      },
      onClose() { if (!answered) resolve(false); },
    });
  });
}

/* ----------------------------------------------------------------- forms */

export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value;
  }
  return out;
}
export function showFormError(container, message) {
  let box = container.querySelector('.form-error');
  if (!message) { box && box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.className = 'form-error'; box.setAttribute('role', 'alert'); container.prepend(box); }
  mount(box, html`${icon('alert')}<span>${message}</span>`);
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
/** Wraps an async submit: disables the button, shows errors inline. */
export async function busy(button, fn, errorHost) {
  if (button.classList.contains('busy')) return;
  button.classList.add('busy');
  try {
    if (errorHost) showFormError(errorHost, null);
    return await fn();
  } catch (e) {
    if (errorHost) showFormError(errorHost, e.message); else toast(e.message, 'bad', 5000);
  } finally {
    button.classList.remove('busy');
  }
}

export function options(list, selected, { placeholder } = {}) {
  return html`${placeholder !== undefined ? html`<option value="">${placeholder}</option>` : ''}${list.map((o) => {
    const value = typeof o === 'string' ? o : o.value;
    const label = typeof o === 'string' ? o : o.label;
    return html`<option value="${value}" ${String(value) === String(selected ?? '') ? raw('selected') : ''}>${label}</option>`;
  })}`;
}

export function emptyState(iconName, title, text, action) {
  return html`<div class="empty">${icon(iconName)}<h3>${title}</h3><div>${text}</div>${action ? html`<div style="margin-top:16px">${action}</div>` : ''}</div>`;
}

export function statusPill(status) {
  if (status === 'out') return html`<span class="pill bad">${icon('alert')}${t('status.out')}</span>`;
  if (status === 'low') return html`<span class="pill warn">${icon('alert')}${t('status.low')}</span>`;
  return html`<span class="pill good">${icon('check')}${t('status.ok')}</span>`;
}

export function foodCostPill(pctVal, target) {
  if (pctVal === null || pctVal === undefined) return html`<span class="pill">${t('menu.noPrice')}</span>`;
  const t = Number(target) || 30;
  const cls = pctVal <= t ? 'good' : pctVal <= t + 5 ? 'warn' : 'bad';
  return html`<span class="pill ${cls}">${pct(pctVal)}</span>`;
}
