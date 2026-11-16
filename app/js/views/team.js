// More → ทีมงาน: today's shop QR (for joining phones), the team with PINs and permissions, and joined phones.
import { call, session } from '../api.js';
import { html, raw, mount, icon, $, $$, openSheet, confirmSheet, toast, busy, emptyState, fmtDate, relDay, timeOf, printHtml, today } from '../ui.js';
import { t } from '../i18n.js';
import qrcode from '../vendor/qrcode.js';

const COLOURS = ['#2e6e71', '#d06f66', '#8a6d1f', '#4b5d9c', '#7a4f8a', '#2f8f4e', '#a5463d', '#3d7a9c'];
const PERMS = ['sales', 'stock', 'receive', 'produce', 'close'];
// Job presets fill the switches; the owner can still change any switch after.
const PRESETS = { kitchen: ['stock', 'produce', 'receive'], floor: ['sales', 'close'], all: PERMS };
const ROLES = ['staff', 'manager', 'owner'];
const nameOf = (u) => u.nickname || u.displayName;
const initial = (name) => Array.from(String(name || '?').replace(/^(น้อง|พี่|คุณ|ป้า|ลุง)\s*/, ''))[0] || '?';
const colourOf = (u, i) => u.colour || COLOURS[i % COLOURS.length];
/** The phone's own date for a server timestamp (the server keeps UTC, Thailand is 7 hours ahead). */
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** A valid random PIN: 6 digits, not a run or a repeat (the server checks again). */
function randomPin() {
  for (;;) {
    const p = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => String(b % 10)).join('');
    const d = p.split('').map(Number);
    const run = (s) => d.every((x, i) => i === 0 || x === (d[i - 1] + s + 10) % 10);
    if (!run(0) && !run(1) && !run(-1)) return p;
  }
}

function qrSvg(text, cell) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

export async function renderTeam(ctx) {
  const { el, setTitle, setActions, state, can } = ctx;
  setTitle(t('more.team'), { back: true });
  if (!can('owner')) { mount(el, emptyState('users', t('more.ownersOnly'), t('team.ownersOnlyText'))); return; }
  setActions(html`<button class="icon-btn" id="new" aria-label="${t('team.new')}">${icon('plus')}</button>`)
    .querySelector('#new').addEventListener('click', () => personSheet(ctx));
  const people = state.boot.users.slice().sort((a, b) => (a.active === b.active
    ? ROLES.indexOf(b.role) - ROLES.indexOf(a.role) || nameOf(a).localeCompare(nameOf(b), 'th') : a.active ? -1 : 1));
  mount(el, html`
    <section class="card pad team-qr" id="qr"><div class="skeleton" style="height:220px"></div></section>
    <div class="section-head" style="margin-top:18px"><h2>${t('team.people')}</h2><span class="small muted">${t('team.nActive', { n: people.filter((u) => u.active).length })}</span></div>
    <div class="card"><ul class="list">${people.map((u, i) => html`<li>
      <button class="row" data-id="${u.id}" style="${u.active ? '' : 'opacity:.55'}">
        <span class="avatar" style="background:${colourOf(u, i)};color:#fff">${initial(nameOf(u))}</span>
        <span class="grow"><div class="title">${nameOf(u)}${u.nickname && u.displayName !== u.nickname ? html` <span class="muted small">${u.displayName}</span>` : ''}</div>
          <div class="sub">${[u.position, t(`role.${u.role}`)].filter(Boolean).join(' · ')}${u.active ? '' : ' · ' + t('team.disabled')}</div></span>
        ${u.role === 'owner' ? html`<span class="pill brand">${t('team.password')}</span>`
          : u.hasPin ? html`<span class="pill good">PIN</span>` : html`<span class="pill warn">${t('team.noPin')}</span>`}
      </button></li>`)}</ul></div>
    <div class="section-head" style="margin-top:18px"><h2>${t('team.clockSettings')}</h2></div>
    <form class="card pad" id="clock-settings" novalidate>${clockSettings(state.boot.settings)}</form>
    <div class="section-head" style="margin-top:18px"><h2>${t('team.devices')}</h2><button class="btn ghost sm" id="reset-all">${t('team.resetAll')}</button></div>
    <div class="card" id="devices"><div class="skeleton" style="height:64px"></div></div>`);
  $$('[data-id]', el).forEach((b) => b.addEventListener('click', () => personSheet(ctx, people.find((u) => u.id === b.dataset.id))));
  $('#reset-all').addEventListener('click', async () => {
    if (!(await confirmSheet({ title: t('team.resetAllTitle'), message: t('team.resetAllText'), confirm: t('team.resetAll'), danger: true }))) return;
    try { const r = await call('team.resetDevices', {}); toast(t('team.resetDone', { n: r.removed })); } catch (e) { toast(e.message, 'bad'); }
    renderTeam(ctx);
  });
  drawQr(ctx, $('#qr'));
  drawDevices(ctx, $('#devices'));
  wireClockSettings(ctx, $('#clock-settings'));
}

function clockSettings(st) {
  const set = String(st.shopLat || '') !== '';
  const sel = (name, list, cur, fmt) => html`<select class="select" name="${name}">${list.map((v) => html`<option value="${v}" ${String(v) === String(cur) ? raw('selected') : ''}>${fmt(v)}</option>`)}</select>`;
  return html`
    <div class="shop-place ${set ? 'is-set' : ''}">${icon(set ? 'check' : 'alert')}<div><b>${set ? t('team.placeSet') : t('team.placeNotSet')}</b>
      <div class="small muted">${set ? t('team.placeSetText') : t('team.placeNotSetText')}</div></div></div>
    <button type="button" class="btn block" id="use-here">${icon('send')}${set ? t('team.placeUpdate') : t('team.placeUse')}</button>
    <div class="form-row" style="margin-top:12px">
      <label class="field"><span class="label">${t('team.radius')}</span>${sel('clockRadius', [...new Set([100, 150, 300, 500, Number(st.clockRadius ?? 150)])].sort((a, b) => a - b), st.clockRadius ?? 150, (v) => t('clock.metres', { n: v }))}</label>
      <label class="field"><span class="label">${t('team.grace')}</span>${sel('lateGraceMinutes', [0, 5, 10, 15], st.lateGraceMinutes ?? 5, (v) => (v ? t('sched.minutes', { n: v }) : t('team.noGrace')))}</label>
    </div>
    <div class="form-row three">
      <label class="field"><span class="label">${t('leave.type.sick')}</span><input class="input" name="leaveSickDays" type="number" inputmode="numeric" min="0" value="${st.leaveSickDays ?? 30}"></label>
      <label class="field"><span class="label">${t('leave.type.personal')}</span><input class="input" name="leavePersonalDays" type="number" inputmode="numeric" min="0" value="${st.leavePersonalDays ?? 3}"></label>
      <label class="field"><span class="label">${t('leave.type.vacation')}</span><input class="input" name="leaveVacationDays" type="number" inputmode="numeric" min="0" value="${st.leaveVacationDays ?? 6}"></label>
    </div>
    <p class="small muted" style="margin-top:0">${t('team.leaveDaysHint')}</p>
    <button class="btn primary block" type="submit">${t('common.save')}</button>`;
}

function wireClockSettings(ctx, f) {
  // Saves and redraws; callers wrap it in busy() once (a second busy on the same button would do nothing).
  const save = async (values, msg) => {
    const st = await call('settings.save', { values });
    ctx.state.boot.settings = st;
    mount(f, clockSettings(st));
    wireClockSettings(ctx, f);
    toast(msg || t('team.saved'));
  };
  $('#use-here', f).addEventListener('click', (e) => {
    busy(e.currentTarget, async () => {
      const { locate } = await import('./timeclock.js');
      const p = await locate();
      if (p.lat === undefined) throw new Error(t('team.placeFailed'));
      if (p.accuracy > 100) toast(t('team.placeRough', { n: p.accuracy }), 'warn', 6000);
      await save({ shopLat: String(p.lat), shopLng: String(p.lng) }, t('team.placeSaved'));
    }, f);
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(f.querySelector('[type=submit]'), () => save({ clockRadius: f.clockRadius.value, lateGraceMinutes: f.lateGraceMinutes.value,
      leaveSickDays: f.leaveSickDays.value, leavePersonalDays: f.leavePersonalDays.value, leaveVacationDays: f.leaveVacationDays.value }), f);
  });
}

async function drawQr(ctx, box) {
  let r;
  try { r = await call('team.joinCode', { today: today() }); } catch (e) { mount(box, html`<p class="small" style="color:var(--bad-ink)">${e.message}</p>`); return; }
  if (!box.isConnected) return;
  // A QR from the sample shop says so, so it can never join a real phone to the demo by mistake.
  const url = `${location.origin}${location.pathname}${r.path}${session.mode === 'demo' ? '.demo' : ''}`;
  const day = fmtDate(r.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  mount(box, html`
    <div class="team-qr-head"><div><h2 style="margin:0">${t('team.qrTitle')}</h2><div class="small muted">${t('team.qrValid', { day })}</div></div>
      <span class="pill good">${t('team.qrToday')}</span></div>
    <div class="team-qr-body">
      <div class="team-qr-code">${raw(qrSvg(url, 6))}</div>
      <ol class="team-qr-steps"><li>${t('team.qrStep1')}</li><li>${t('team.qrStep2')}</li><li>${t('team.qrStep3')}</li></ol>
    </div>
    <p class="small muted" style="margin:6px 0 12px">${t('team.qrNote')}</p>
    <div class="form-row"><button class="btn" id="print-qr">${icon('download')}${t('team.qrPrint')}</button>
      <button class="btn" id="copy-qr">${icon('clipboard')}${t('team.qrCopy')}</button></div>`);
  $('#print-qr', box).addEventListener('click', () => printHtml(html`<section class="qr-poster">
    <div class="qr-poster-shop">${ctx.state.boot.settings.restaurantName}</div>
    <h1>${t('team.posterTitle')}</h1>
    <div class="qr-poster-code">${raw(qrSvg(url, 10))}</div>
    <div class="qr-poster-date">${t('team.qrValid', { day })}</div>
    <ol>${[1, 2, 3].map((n) => html`<li>${t(`team.qrStep${n}`)}</li>`)}</ol>
    <p>${t('team.posterNote')}</p></section>`));
  $('#copy-qr', box).addEventListener('click', async () => {
    try {
      if (navigator.share) await navigator.share({ title: t('team.qrTitle'), text: t('team.shareText', { shop: ctx.state.boot.settings.restaurantName }), url });
      else { await navigator.clipboard.writeText(url); toast(t('team.qrCopied')); }
    } catch { /* cancelled */ }
  });
}

async function drawDevices(ctx, box) {
  let list;
  try { list = await call('team.devices', {}); } catch (e) { mount(box, html`<p class="small pad">${e.message}</p>`); return; }
  if (!box.isConnected) return;
  mount(box, list.length ? html`<ul class="list">${list.map((d) => html`<li class="row">
      <span class="avatar">${icon('user')}</span>
      <span class="grow"><div class="title">${d.lastUserName ? t('team.deviceOf', { name: d.lastUserName }) : t('team.deviceNew')}</div>
        <div class="sub">${d.lastUsedAt ? t('team.deviceUsed', { when: `${relDay(localDay(d.lastUsedAt))} ${timeOf(d.lastUsedAt)}` }) : ''} · ${t('team.deviceJoined', { when: fmtDate(localDay(d.joinedAt)) })}</div></span>
      <button class="btn ghost sm" data-remove="${d.id}">${t('team.remove')}</button></li>`)}</ul>`
    : html`<p class="small muted" style="margin:12px 14px">${t('team.noDevices')}</p>`);
  $$('[data-remove]', box).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    await call('team.removeDevice', { id: b.dataset.remove });
    toast(t('team.removed'));
    drawDevices(ctx, box);
  })));
}

function personSheet(ctx, item) {
  const isNew = !item;
  item = item || { active: true, role: 'staff', permissions: PRESETS.all, colour: COLOURS[ctx.state.boot.users.length % COLOURS.length] };
  const self = item.id === ctx.state.boot.user.id;
  let colour = item.colour || COLOURS[0];
  const perms = new Set(item.permissions || PERMS);
  openSheet({
    title: isNew ? t('team.new') : nameOf(item),
    body: html`<form id="pf" novalidate>
      <div class="form-row">
        <label class="field"><span class="label">${t('team.nickname')}</span><input class="input" name="nickname" maxlength="80" value="${item.nickname || ''}" placeholder="${t('team.nicknameHint')}"></label>
        <label class="field"><span class="label">${t('team.position')}</span><input class="input" name="position" maxlength="80" list="positions" value="${item.position || ''}" placeholder="${t('common.optional')}"></label>
      </div>
      <datalist id="positions">${['ผู้จัดการร้าน', 'หัวหน้าครัว', 'ผู้ช่วยครัว', 'พนักงานเสิร์ฟ', 'แคชเชียร์', 'ล้างจาน/เตรียมของ'].map((p) => html`<option value="${p}">`)}</datalist>
      <label class="field"><span class="label">${t('team.fullName')}</span><input class="input" name="fullName" maxlength="80" value="${item.fullName || (isNew ? '' : item.displayName)}"></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('team.phone')}</span><input class="input" name="phone" type="tel" maxlength="40" value="${item.phone || ''}" placeholder="${t('common.optional')}"></label>
        <label class="field"><span class="label">${t('team.startDate')}</span><input class="input" name="startDate" type="date" value="${item.startDate || ''}"></label>
      </div>
      <div class="field"><span class="label">${t('team.colour')}</span><div class="colour-row">${COLOURS.map((c) => html`<button type="button" class="colour-dot" data-colour="${c}" style="background:${c}" aria-pressed="${c === colour}" aria-label="${c}"></button>`)}</div></div>
      <label class="field"><span class="label">${t('team.role')}</span><select class="select" name="role" ${self ? raw('disabled') : ''}>${ROLES.map((r) => html`<option value="${r}" ${r === item.role ? raw('selected') : ''}>${t(`role.${r}`)} — ${t(`team.roleHelp.${r}`)}</option>`)}</select></label>
      <div class="field" data-only-staff><span class="label">${t('team.whatCanDo')}</span>
        <div class="chips" style="flex-wrap:wrap;margin:0 0 8px;padding:0">${Object.keys(PRESETS).map((k) => html`<button type="button" class="chip" data-preset="${k}">${t(`team.preset.${k}`)}</button>`)}</div>
        <div class="perm-list">${PERMS.map((p) => html`<label class="check perm"><input type="checkbox" data-perm="${p}" ${perms.has(p) ? raw('checked') : ''}>
          <span><b>${t(`team.perm.${p}`)}</b><span class="small muted">${t(`team.permHelp.${p}`)}</span></span></label>`)}</div></div>
      <div class="field" data-pin-box><span class="label">${isNew || !item.hasPin ? t('team.setPin') : t('team.newPin')}</span>
        <div class="input-group"><input class="input pin-input" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="${isNew || !item.hasPin ? '••••••' : t('team.pinKeep')}">
          <button type="button" class="btn sm" id="rand-pin">${t('team.randomPin')}</button></div>
        <span class="hint">${t('team.pinHint')}</span></div>
      <div class="field" data-pw-box><span class="label">${isNew ? t('team.startPassword') : t('team.newPassword')}</span>
        <input class="input" name="password" type="text" autocomplete="new-password" placeholder="${isNew ? t('team.pwMin') : t('team.pwKeep')}">
        <span class="hint">${t('team.pwHintOwner')}</span></div>
      <details class="field"><summary class="small muted">${t('team.advanced')}</summary>
        <label class="field" style="margin-top:8px"><span class="label">${t('login.username')}</span><input class="input" name="username" value="${item.username || ''}" autocapitalize="none" spellcheck="false" maxlength="40">
          <span class="hint">${t('team.usernameAuto')}</span></label></details>
      ${isNew ? '' : html`<label class="check"><input type="checkbox" name="active" ${item.active ? raw('checked') : ''} ${self ? raw('disabled') : ''}> ${t('team.canSignIn')}</label>`}
    </form>`,
    foot: html`<button class="btn primary block" id="save">${isNew ? t('team.create') : t('common.saveChanges')}</button>`,
    onMount(el, close) {
      const f = el.querySelector('#pf');
      const sync = () => {
        const role = f.role.value;
        el.querySelector('[data-only-staff]').hidden = role !== 'staff';
        el.querySelector('[data-pin-box]').hidden = role === 'owner';
        el.querySelector('[data-pw-box]').hidden = role !== 'owner' && !(item.role === 'owner');
      };
      f.role.addEventListener('change', sync);
      sync();
      $$('[data-colour]', el).forEach((b) => b.addEventListener('click', () => {
        colour = b.dataset.colour;
        $$('[data-colour]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }));
      $$('[data-preset]', el).forEach((b) => b.addEventListener('click', () => {
        const on = PRESETS[b.dataset.preset];
        $$('[data-perm]', el).forEach((c) => { c.checked = on.includes(c.dataset.perm); });
      }));
      el.querySelector('#rand-pin').addEventListener('click', () => { f.pin.value = randomPin(); });
      f.pin.addEventListener('input', () => { f.pin.value = f.pin.value.replace(/\D/g, '').slice(0, 6); });
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = Object.fromEntries(new FormData(f));
        const role = self ? item.role : f.role.value;
        const nickname = v.nickname.trim();
        const fullName = v.fullName.trim();
        if (!nickname && !fullName) throw new Error(t('team.needName'));
        const item2 = {
          id: item.id, version: item.version, role,
          nickname, fullName, position: v.position, phone: v.phone, startDate: v.startDate, colour,
          displayName: fullName || nickname,
          // Staff never type a username: one is made for them (it's only needed for the password form).
          username: v.username.trim() || item.username || `s${Date.now().toString(36)}`,
          active: isNew || self ? true : f.active.checked,
          permissions: role === 'staff' ? $$('[data-perm]', el).filter((c) => c.checked).map((c) => c.dataset.perm) : undefined,
        };
        if (role !== 'owner' && v.pin) {
          if (!/^\d{6}$/.test(v.pin)) throw new Error(t('team.pinSix'));
          item2.pin = v.pin;
        }
        if (role === 'owner' || v.password) item2.password = v.password || undefined;
        if (isNew && role !== 'owner' && !item2.pin) throw new Error(t('team.needPin'));
        try {
          await call('users.save', { item: item2 });
        } catch (err) { if (err.code === 'CONFLICT') await ctx.refresh(); throw err; }
        close();
        toast(isNew ? t('team.createdPin', { name: nickname || fullName, pin: v.pin || '' }) : t('team.saved'), 'good', 6000);
        await ctx.refresh();
        renderTeam(ctx);
      }, f));
    },
  });
}
