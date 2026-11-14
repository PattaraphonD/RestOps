// API client. Talks to the shop's server (Supabase function, or the older Apps Script web app),
// or to the in-browser demo backend.
import { t, getLang } from './i18n.js';

const K = { token: 'ro.token', user: 'ro.user', url: 'ro.apiUrl', mode: 'ro.mode' };
const TIMEOUT_MS = 45000;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null || v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const session = {
  get token() { return store.get(K.token); },
  get user() { try { return JSON.parse(store.get(K.user) || 'null'); } catch { return null; } },
  get mode() { return store.get(K.mode) || 'remote'; },
  /** The shop's address from config.js, unless this phone was given a different one. */
  get defaultApiUrl() { return (window.RESTO_CONFIG && window.RESTO_CONFIG.apiUrl) || ''; },
  get apiUrl() {
    let saved = store.get(K.url);
    // Moving to Supabase: a phone that remembered the old Apps Script address follows config.js instead.
    if (saved && /script\.google/.test(saved) && /\.supabase\.co\//.test(this.defaultApiUrl)) { store.set(K.url, null); saved = null; }
    return saved || this.defaultApiUrl;
  },
  /** Remember an address only when it differs from config.js, so a later change there reaches every phone. */
  setApiUrl(url) {
    const v = url ? url.trim() : '';
    store.set(K.url, v && v !== this.defaultApiUrl ? v : null);
  },
  setMode(mode) { store.set(K.mode, mode); },
  save(token, user) { store.set(K.token, token); store.set(K.user, JSON.stringify(user)); },
  setUser(user) { store.set(K.user, JSON.stringify(user)); },
  clear() { store.set(K.token, null); store.set(K.user, null); },
};

let demoTransport = null;
let onAuthLost = null;
export function setAuthLostHandler(fn) { onAuthLost = fn; }

async function remote(req) {
  const url = session.apiUrl;
  if (!url) throw new ApiError('CONFIG', t('err.noServer'));
  if (!navigator.onLine) throw new ApiError('NETWORK', t('err.offline'));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // text/plain keeps this a "simple" CORS request (no preflight), which both servers accept.
    const res = await fetch(url, {
      method: 'POST', body: JSON.stringify(req), redirect: 'follow', signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch {
      throw new ApiError('SERVER', t('err.badReply'));
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.name === 'AbortError') throw new ApiError('NETWORK', t('err.timeout'));
    throw new ApiError('NETWORK', t('err.network'));
  } finally {
    clearTimeout(timer);
  }
}

/** One id per form: if a save is retried after a timeout, the server recognises it and won't save twice. */
export function newRequestId() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/-/g, '');
}

export async function call(action, payload = {}, opts = {}) {
  const req = { action, token: session.token, payload, lang: getLang(), requestId: opts.requestId || undefined };
  let res;
  if (session.mode === 'demo') {
    if (!demoTransport) demoTransport = await (await import('./demo.js')).createDemoTransport();
    res = await demoTransport(req);
  } else {
    res = await remote(req);
  }
  if (!res || !res.ok) {
    const err = new ApiError(res?.error?.code || 'SERVER', res?.error?.message || t('err.unknown'));
    if (err.code === 'AUTH' && action !== 'auth.login' && onAuthLost) onAuthLost(err);
    throw err;
  }
  return res.data;
}

export async function login(username, password) {
  const data = await call('auth.login', { username, password });
  session.save(data.token, data.user);
  return data.user;
}

export async function logout() {
  try { await call('auth.logout'); } catch { /* already expired */ }
  session.clear();
}

export async function resetDemo() {
  const { resetDemoData } = await import('./demo.js');
  resetDemoData();
  demoTransport = null;
}
