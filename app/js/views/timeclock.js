// Time clock: the Home clock card (staff and managers), "my time" and the manager's timesheet (More → เวลาทำงาน).
import { call } from '../api.js';
import { html, raw, mount, icon, $, $$, openSheet, confirmSheet, toast, busy, emptyState, fmtDate, number, today, addDays, options } from '../ui.js';
import { t } from '../i18n.js';

const PERSON_COLOURS = ['#2e6e71', '#d06f66', '#8a6d1f', '#4b5d9c', '#7a4f8a', '#2f8f4e', '#a5463d', '#3d7a9c'];
const mondayOf = (d) => { const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); return addDays(d, -((wd + 6) % 7)); };
const dayLong = (d) => fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' });
const dayShort = (d) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' });
const initial = (name) => Array.from(String(name || '?').replace(/^(น้อง|พี่|คุณ|ป้า|ลุง)\s*/, ''))[0] || '?';
const hrs = (h) => t('sched.hours', { n: number(h || 0, 1) });
function weekLabel(ws) {
  const we = addDays(ws, 6);
  return `${fmtDate(ws, ws.slice(0, 7) === we.slice(0, 7) ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${fmtDate(we, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
function duration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? t('clock.hm', { h, m }) : t('clock.m', { m });
}
const km = (m) => (m >= 1000 ? t('clock.km', { n: number(m / 1000, 1) }) : t('clock.metres', { n: Math.round(m) }));

/** The phone's position, or {} — never longer than 8 seconds, never an error (clocking is never blocked). */
export function locate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve({}); return; }
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish({}), 8000);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
        () => finish({}), { enableHighAccuracy: true, timeout: 7500, maximumAge: 60000 });
    } catch { finish({}); }
  });
}

/** Flags on one time entry, as small pills. */
export function entryFlags(e) {
  const f = [];
  if (e.earlyInMinutes) f.push(html`<span class="pill">${t('clock.earlyIn', { d: duration(e.earlyInMinutes), time: e.paidFrom })}</span>`);
  if (e.lateMinutes) f.push(html`<span class="pill bad">${t('clock.lateBy', { d: duration(e.lateMinutes) })}</span>`);
  if (e.earlyMinutes) f.push(html`<span class="pill warn">${t('clock.earlyBy', { d: duration(e.earlyMinutes) })}</span>`);
  if (e.inPlace === 'far' || e.outPlace === 'far') f.push(html`<span class="pill warn">${t('clock.far', { d: km(e.inPlace === 'far' ? e.inDistance : e.outDistance) })}</span>`);
  if (e.inPlace === 'none') f.push(html`<span class="pill">${t('clock.noLocation')}</span>`);
  if (e.missedOut) f.push(html`<span class="pill warn">${t('clock.forgotOut')}</span>`);
  if (e.source === 'manager') f.push(html`<span class="pill brand">${t('clock.byManager')}</span>`);
  if (e.approved) f.push(html`<span class="pill good">${t('clock.approved')}</span>`);
  return f;
}

/* ------------------------------------------------------------ Home: the clock card */

let timer = null;
let onResume = null;
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  // Back on the phone after a while (or a new day): redraw the clock card so it isn't stale.
  if (onResume && hiddenAt && Date.now() - hiddenAt > 60000) onResume();
});

/** Clock card for Home. `clock` is today.summary.clock; `next` the next shift (today.summary.shifts.next). */
export function clockCard(clock, next) {
  if (!clock || !clock.canClock) return '';
  const sh = clock.shift;
  const open = clock.open;
  const done = !open && (clock.todayEntries || []).filter((e) => !e.open);
  const shiftLine = sh ? t('clock.shiftToday', { time: `${sh.startTime}–${sh.endTime}` }) : t('clock.noShiftToday');
  let body;
  if (clock.missed && open) {
    body = html`<div class="clock-missed">${icon('alert')}<div><b>${t('clock.missedTitle', { day: dayLong(open.date) })}</b>
        <div class="small">${t('clock.missedText', { time: open.inTime })}</div></div></div>
      <form id="missed-form" class="clock-missed-form" novalidate>
        <label class="field"><span class="label">${t('clock.finishedAt')}</span><input class="input" type="time" name="outTime" step="300" value="${open.suggestOut || ''}" required></label>
        <button class="btn primary" type="submit">${t('clock.saveFinish')}</button></form>`;
  } else if (open) {
    body = html`<div class="clock-now"><div><div class="small muted">${t('clock.inSince', { time: open.inTime })}${open.lateMinutes ? html` · <span class="bad-ink">${t('clock.lateN', { n: open.lateMinutes })}</span>` : ''}</div>
        <div class="clock-timer" id="clock-timer" data-since="${open.inAt}">${duration(Math.max(0, Math.round((Date.now() - Date.parse(open.inAt)) / 60000)))}</div></div></div>
      <button class="btn clock-btn out" id="clock-out">${icon('logout')}<span>${t('clock.out')}</span></button>`;
  } else {
    const worked = done.reduce((a, e) => a + (e.workedMinutes || 0), 0);
    body = html`${done.length ? html`<div class="clock-done">${icon('check')}<span>${t('clock.doneToday', { span: done.map((e) => `${e.inTime}–${e.outTime}`).join(', '), d: duration(worked) })}</span></div>` : ''}
      <button class="btn clock-btn in${done.length ? ' again' : ''}" id="clock-in">${icon('clock')}<span>${done.length ? t('clock.inAgain') : t('clock.in')}</span></button>
      ${done.length ? '' : html`<p class="small muted clock-hint">${t('clock.locationHint')}</p>`}`;
  }
  return html`<section class="card clock-card${open ? ' is-in' : ''}${clock.missed ? ' is-missed' : ''}">
    <div class="clock-head"><span class="label">${icon('calendar')}${dayLong(clock.date)}</span><span class="small">${shiftLine}</span></div>
    ${body}
    ${next && !open ? html`<div class="clock-next small muted">${t('sched.nextShift', { day: fmtDate(next.date, { weekday: 'long', day: 'numeric', month: 'short' }), time: `${next.startTime}–${next.endTime}` })}</div>` : ''}
  </section>`;
}

/** Wires the clock card's buttons; `refresh` redraws Home. */
export function wireClock(host, clock, refresh) {
  clearInterval(timer);
  onResume = () => { if (host.isConnected && $('.clock-card', host)) refresh(); };
  const serverOffset = clock.now ? Date.parse(clock.now) - Date.now() : 0;
  // A failed tap usually means the card is out of date (a manager fixed the time, a new day): say why, then redraw.
  const guarded = (btn, fn) => busy(btn, async () => {
    try { await fn(); } catch (err) { toast(err.message, 'bad', 6000); refresh(); }
  });
  const tEl = $('#clock-timer', host);
  if (tEl) {
    timer = setInterval(() => {
      if (!document.body.contains(tEl)) { clearInterval(timer); return; }
      tEl.textContent = duration(Math.max(0, Math.round((Date.now() - Date.parse(tEl.dataset.since)) / 60000)));
    }, 30000);
  }
  $('#clock-in', host)?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    guarded(btn, async () => {
      btn.querySelector('span').textContent = t('clock.locating');
      const where = await locate();
      const r = await call('clock.in', where);
      const when = r.lateMinutes ? t('clock.lateN', { n: r.lateMinutes }) : r.shift ? t('clock.onTime') : '';
      toast(t('clock.inDone', { time: r.inTime }) + (when ? ` · ${when}` : ''), r.lateMinutes ? 'warn' : 'good', 5000);
      if (r.inPlace === 'far') toast(t('clock.farNote', { d: km(r.inDistance) }), 'warn', 7000);
      if (r.inPlace === 'none') toast(t('clock.noLocationNote'), 'info', 7000);
      refresh();
    });
  });
  $('#clock-out', host)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const now = new Date(Date.now() + serverOffset + 7 * 3600e3).toISOString().slice(11, 16);
    const ok = await confirmSheet({ title: t('clock.outTitle'), message: t('clock.outText', { time: now }), confirm: t('clock.out') });
    if (!ok) return;
    guarded(btn, async () => {
      const where = await locate();
      const r = await call('clock.out', where);
      toast(t('clock.outDone', { time: r.outTime, d: duration(r.workedMinutes || 0) }), 'good', 6000);
      if (r.outPlace === 'far') toast(t('clock.farNote', { d: km(r.outDistance) }), 'warn', 7000);
      refresh();
    });
  });
  const mf = $('#missed-form', host);
  mf?.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(mf.querySelector('[type=submit]'), async () => {
      await call('clock.fixMissed', { id: clock.open.id, outTime: mf.outTime.value });
      toast(t('clock.missedSaved'), 'good', 6000);
      refresh();
    }, mf);
  });
}

/* ------------------------------------------------------------ my time (everyone who clocks) */

let myWeek = '';
export async function renderMyTime(ctx) {
  const { el, setTitle } = ctx;
  setTitle(t('clock.myTitle'), { back: true });
  myWeek = myWeek || mondayOf(today());
  mount(el, html`<div class="skeleton" style="height:90px;margin-top:4px"></div><div class="skeleton" style="height:260px;margin-top:12px"></div>`);
  const ws = myWeek;
  const r = await call('clock.mine', { weekStart: ws });
  if (ctx.stale() || ws !== myWeek) return;
  const days = Array.from({ length: 7 }, (_, i) => addDays(r.weekStart, i));
  const rows = days.map((d) => ({ d, plan: r.planned.filter((x) => x.date === d), ents: r.entries.filter((x) => x.date === d),
    leave: r.leaves.find((x) => x.date === d), absent: r.absent.includes(d) })).filter((x) => x.plan.length || x.ents.length || x.leave);
  mount(el, html`
    <div class="card pad"><div class="date-nav" style="margin:0">
      <button class="icon-btn" data-w="-1" aria-label="${t('sched.prevWeek')}">${icon('chevL')}</button>
      <div class="date-label">${weekLabel(r.weekStart)}<div class="sub">${r.weekStart === mondayOf(today()) ? t('sched.thisWeek') : html`<button class="link-btn" data-w="0">${t('sched.backToThisWeek')}</button>`}</div></div>
      <button class="icon-btn" data-w="1" aria-label="${t('sched.nextWeekBtn')}">${icon('chevR')}</button></div>
      <div class="kpi-row"><div><span>${t('clock.worked')}</span><b>${hrs(r.workedHours)}</b></div><div><span>${t('clock.planned')}</span><b>${hrs(r.plannedHours)}</b></div></div></div>
    <div class="card" style="margin-top:12px">${rows.length ? html`<ul class="list">${rows.map((x) => html`<li><div class="row time-row">
      <span class="date-badge"><small>${fmtDate(x.d, { weekday: 'short' })}</small><b>${Number(x.d.slice(8))}</b></span>
      <span class="grow"><div class="title">${x.ents.length ? x.ents.map((e) => `${e.inTime}–${e.outTime || t('clock.stillIn')}`).join(', ')
          : x.leave ? t(`leave.type.${x.leave.type}`) : x.absent ? html`<span class="bad-ink">${t('clock.absent')}</span>` : t('clock.notYet')}</div>
        <div class="sub">${x.plan.length ? t('clock.plannedShift', { time: x.plan.map((p) => `${p.startTime}–${p.endTime}`).join(', ') }) : t('clock.noShift')}</div>
        <div class="flags">${x.ents.flatMap(entryFlags)}</div></span>
      <span class="value">${x.ents.some((e) => e.workedMinutes !== null) ? hrs(x.ents.reduce((a, e) => a + (e.workedMinutes || 0), 0) / 60) : ''}</span></div></li>`)}</ul>`
      : emptyState('clock', t('clock.emptyWeekTitle'), t('clock.emptyWeekText'))}</div>
    <p class="small muted" style="margin:10px 2px">${t('clock.myHelp')}</p>`);
  $$('[data-w]', el).forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.w);
    myWeek = n === 0 ? mondayOf(today()) : addDays(myWeek, n * 7);
    renderMyTime(ctx);
  }));
}

/* ------------------------------------------------------------ the timesheet (owner and managers) */

let tsWeek = '';
export async function renderTimesheet(ctx, arg) {
  const { el, setTitle, setActions, can } = ctx;
  setTitle(t('ts.title'), { back: true });
  if (!can('manager')) { mount(el, emptyState('clock', t('perm.noneTitle'), t('perm.noneText'))); return; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg || '')) tsWeek = mondayOf(arg);
  tsWeek = tsWeek || mondayOf(today());
  setActions(html`<button class="icon-btn" id="ts-add" aria-label="${t('ts.add')}">${icon('plus')}</button>`)
    .querySelector('#ts-add').addEventListener('click', () => entrySheet(ctx, null, {}));
  mount(el, html`<div class="skeleton" style="height:120px;margin-top:4px"></div><div class="skeleton" style="height:300px;margin-top:12px"></div>`);
  await drawTimesheet(ctx);
}

async function drawTimesheet(ctx) {
  const { el } = ctx;
  const ws = tsWeek;
  const w = await call('timesheet.week', { weekStart: ws });
  if (ctx.stale() || ws !== tsWeek) return;
  ctx.ts = w;
  const people = w.people.filter((p) => p.plannedHours || p.workedHours || p.absent || w.entries.some((e) => e.userId === p.id));
  const tot = (k) => w.people.reduce((a, p) => a + (p[k] || 0), 0);
  mount(el, html`
    <div class="card pad sched-head">
      <div class="date-nav" style="margin:0">
        <button class="icon-btn" data-w="-1" aria-label="${t('sched.prevWeek')}">${icon('chevL')}</button>
        <div class="date-label">${weekLabel(w.weekStart)}<div class="sub">${w.weekStart === mondayOf(today()) ? t('sched.thisWeek') : html`<button class="link-btn" data-w="0">${t('sched.backToThisWeek')}</button>`}</div></div>
        <button class="icon-btn" data-w="1" aria-label="${t('sched.nextWeekBtn')}">${icon('chevR')}</button>
      </div>
      <div class="kpi-row">
        <div><span>${t('clock.worked')}</span><b>${hrs(tot('workedHours'))}</b></div>
        <div><span>${t('clock.planned')}</span><b>${hrs(tot('plannedHours'))}</b></div>
        <div><span>${t('ts.lateAbsent')}</span><b>${tot('late')} / ${tot('absent')}</b></div>
      </div>
      <button class="btn primary block" id="approve" ${w.toApprove ? '' : raw('disabled')}>${icon('check')}${w.toApprove ? t('ts.approveN', { n: w.toApprove }) : t('ts.allApproved')}</button>
      ${w.stillOpen ? html`<p class="small muted" style="margin:8px 0 0">${t('ts.stillOpen', { n: w.stillOpen })}</p>` : ''}
    </div>
    <div class="card" style="margin-top:12px">${people.length ? html`<ul class="list">${people.map((p, i) => html`<li><button class="row" data-person="${p.id}">
      <span class="avatar sm" style="background:${p.colour || PERSON_COLOURS[i % PERSON_COLOURS.length]};color:#fff">${initial(p.name)}</span>
      <span class="grow"><div class="title">${p.name}</div>
        <div class="sub">${t('ts.workedOfPlanned', { w: number(p.workedHours, 1), p: number(p.plannedHours, 1) })}</div>
        <div class="flags">${p.late ? html`<span class="pill bad">${t('ts.lateTimes', { n: p.late })}</span>` : ''}${p.absent ? html`<span class="pill bad">${t('ts.absentTimes', { n: p.absent })}</span>` : ''}
          ${p.early ? html`<span class="pill warn">${t('ts.earlyTimes', { n: p.early })}</span>` : ''}${p.toCheck ? html`<span class="pill warn">${t('ts.toCheck', { n: p.toCheck })}</span>` : ''}</div></span>
      ${icon('chevR', 'chev')}</button></li>`)}</ul>` : emptyState('clock', t('ts.emptyTitle'), t('ts.emptyText'))}</div>
    <p class="small muted" style="margin:10px 2px">${t('ts.help')}</p>`);
  $$('[data-w]', el).forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.w);
    tsWeek = n === 0 ? mondayOf(today()) : addDays(tsWeek, n * 7);
    drawTimesheet(ctx);
  }));
  $$('[data-person]', el).forEach((b) => b.addEventListener('click', () => personSheet(ctx, w.people.find((p) => p.id === b.dataset.person))));
  $('#approve', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const ok = await confirmSheet({ title: t('ts.approveTitle', { week: weekLabel(w.weekStart) }), message: t('ts.approveText', { n: w.toApprove }), confirm: t('ts.approve') });
    if (!ok) return;
    busy(btn, async () => {
      const shown = w.entries.filter((x) => !x.open && !x.approved).map((x) => ({ id: x.id, version: x.version }));
      const r = await call('timesheet.approve', { weekStart: w.weekStart, entries: shown });
      toast(t('ts.approvedN', { n: r.approved }), 'good');
      if (r.changed) toast(t('ts.changedMeanwhile', { n: r.changed }), 'warn', 7000);
      if (r.own) toast(t('ts.ownSkipped', { n: r.own }), 'info', 7000);
      drawTimesheet(ctx);
    });
  });
}

/** One person's week: each day with the planned shift, the clock times, flags; tap to fix, + to add. */
function personSheet(ctx, person) {
  const w = ctx.ts;
  const days = Array.from({ length: 7 }, (_, i) => addDays(w.weekStart, i));
  const ents = w.entries.filter((e) => e.userId === person.id);
  const abs = w.absences.filter((a) => a.userId === person.id);
  const away = (w.leaves || []).filter((l) => l.userId === person.id);
  openSheet({
    title: person.name,
    wide: true,
    body: html`<p class="small muted" style="margin-top:0">${t('ts.workedOfPlanned', { w: number(person.workedHours, 1), p: number(person.plannedHours, 1) })}</p>
      <ul class="list ts-days">${days.map((d) => {
        const mine = ents.filter((e) => e.date === d);
        const a = abs.find((x) => x.date === d);
        const lv = away.find((x) => x.date === d);
        if (!mine.length && !a && !lv) return '';
        return html`<li><div class="ts-day"><div class="ts-date"><b>${dayShort(d)}</b>${mine[0] && mine[0].shift ? html`<small>${t('clock.plannedShift', { time: `${mine[0].shift.startTime}–${mine[0].shift.endTime}` })}</small>`
            : a ? html`<small>${t('clock.plannedShift', { time: `${a.startTime}–${a.endTime}` })}</small>` : html`<small>${t('clock.noShift')}</small>`}</div>
          ${mine.map((e) => html`<button class="ts-entry" data-entry="${e.id}"><span class="t">${e.inTime}–${e.outTime || t('clock.stillIn')}</span>
            <span class="h">${e.workedMinutes !== null ? hrs(e.workedMinutes / 60) : ''}</span><span class="flags">${entryFlags(e)}</span>
            ${e.note ? html`<span class="small muted note">${e.note}</span>` : ''}</button>`)}
          ${lv ? html`<div class="ts-absent"><span class="pill brand">${t(`leave.type.${lv.type}`)}</span></div>` : ''}
          ${a ? html`<div class="ts-absent"><span class="pill bad">${t('clock.absent')}</span><button class="btn sm" data-add="${d}">${icon('plus')}${t('ts.addTime')}</button></div>` : ''}
        </div></li>`;
      })}</ul>`,
    foot: html`<button class="btn block" id="add-any">${icon('plus')}${t('ts.addFor', { name: person.name })}</button>`,
    onMount(el, close) {
      const mine = person.id === ctx.state.boot.user.id && ctx.state.boot.user.role !== 'owner';
      $$('[data-entry]', el).forEach((b) => b.addEventListener('click', () => {
        if (mine) { toast(t('ts.ownTime'), 'info', 6000); return; }
        close(); setTimeout(() => entrySheet(ctx, ents.find((e) => e.id === b.dataset.entry), person), 50);
      }));
      $$('[data-add]', el).forEach((b) => b.addEventListener('click', () => { close(); setTimeout(() => entrySheet(ctx, null, person, b.dataset.add), 50); }));
      $('#add-any', el).addEventListener('click', () => { close(); setTimeout(() => entrySheet(ctx, null, person), 50); });
    },
  });
}

/** Fix or add a time entry: a reason is always kept. */
function entrySheet(ctx, e, person, date) {
  const isNew = !e;
  const people = (ctx.ts ? ctx.ts.people : []).filter((p) => p.active);
  const abs = ctx.ts && date ? ctx.ts.absences.find((a) => a.userId === person.id && a.date === date) : null;
  openSheet({
    title: isNew ? t('ts.add') : t('ts.fix', { name: person.name, day: dayShort(e.date) }),
    body: html`<form id="ef" novalidate>
      ${isNew ? html`<label class="field"><span class="label">${t('sched.person')}</span><select class="select" name="userId">${options(people.map((p) => ({ value: p.id, label: p.name })), person.id || '')}</select></label>
        <label class="field"><span class="label">${t('ts.date')}</span><input class="input" type="date" name="date" value="${date || today()}" max="${today()}"></label>` : ''}
      ${!isNew && (e.inPlace || e.outPlace) ? html`<div class="flags" style="margin-bottom:10px">${entryFlags(e)}</div>` : ''}
      <div class="form-row">
        <label class="field"><span class="label">${t('ts.in')}</span><input class="input" type="time" name="inTime" step="60" value="${e ? e.inTime : abs ? abs.startTime : ''}" required></label>
        <label class="field"><span class="label">${t('ts.out')}</span><input class="input" type="time" name="outTime" step="60" value="${e ? e.outTime : abs ? abs.endTime : ''}"><span class="hint">${t('ts.outHint')}</span></label>
      </div>
      <label class="field"><span class="label">${t('sched.break')}</span><input class="input" type="number" inputmode="numeric" min="0" step="5" name="breakMinutes" value="${e ? e.breakMinutes : 60}"><span class="hint">${t('ts.breakHint')}</span></label>
      <label class="field"><span class="label">${t('ts.reason')}</span><input class="input" name="reason" maxlength="200" value="${e && e.source === 'manager' ? e.note : ''}" placeholder="${t('ts.reasonHint')}" required></label>
    </form>`,
    foot: html`${isNew ? '' : html`<button class="btn danger" id="remove">${icon('trash')}${t('ts.remove')}</button>`}<button class="btn primary" id="save">${t('common.save')}</button>`,
    onMount(el, close) {
      const f = $('#ef', el);
      $('#save', el).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        await call('timesheet.save', { item: { id: e?.id, version: e?.version, userId: isNew ? f.userId.value : e.userId, date: isNew ? f.date.value : e.date,
          inTime: f.inTime.value, outTime: f.outTime.value, breakMinutes: f.breakMinutes.value, reason: f.reason.value } });
        close(); toast(t('ts.saved')); drawTimesheet(ctx);
      }, f));
      $('#remove', el)?.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        if (!f.reason.value.trim()) { f.reason.focus(); throw new Error(t('ts.reasonFirst')); }
        await call('timesheet.remove', { id: e.id, reason: f.reason.value });
        close(); toast(t('ts.removed')); drawTimesheet(ctx);
      }, f));
    },
  });
}
