// More → ตารางงาน: the week's shifts. Owners and managers plan, copy last week and publish;
// staff see their own shifts and the team's published week (read-only).
import { call } from '../api.js';
import { html, raw, mount, icon, $, $$, openSheet, confirmSheet, toast, busy, emptyState, fmtDate, number, today, addDays, printHtml, showFormError } from '../ui.js';
import { t } from '../i18n.js';

const COLOURS = ['#2a7f7a', '#d99a1e', '#d7654b', '#4b5d9c', '#7a4f8a', '#2f8f4e', '#a5463d', '#3d7a9c'];
const PERSON_COLOURS = ['#2e6e71', '#d06f66', '#8a6d1f', '#4b5d9c', '#7a4f8a', '#2f8f4e', '#a5463d', '#3d7a9c'];
const BREAKS = [0, 15, 30, 45, 60, 90, 120];

let week = '';            // the Monday on screen (kept while moving around the app)
let view = '';            // 'day' (phones) or 'week' (the grid); first choice follows the screen width
let pickedDay = '';
let lastView = '';        // day or week: where tapping a day in the month view goes
let monthOn = '';         // YYYY-MM shown in the month view

const mondayOf = (d) => { const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); return addDays(d, -((wd + 6) % 7)); };
const hrs = (h) => t('sched.hours', { n: number(h, 1) });
const span = (s) => `${s.startTime}–${s.endTime}`;
const dayShort = (d) => fmtDate(d, { weekday: 'short' });
const dayLong = (d) => fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' });
/** A name without น้อง/พี่/คุณ, for tight spaces. */
const bare = (name) => String(name || '').replace(/^(น้อง|พี่|คุณ|ป้า|ลุง)\s*/, '');
const initial = (name) => Array.from(String(name || '?').replace(/^(น้อง|พี่|คุณ|ป้า|ลุง)\s*/, ''))[0] || '?';
function weekLabel(ws) {
  const we = addDays(ws, 6);
  const sameMonth = ws.slice(0, 7) === we.slice(0, 7);
  return `${fmtDate(ws, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${fmtDate(we, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
function relWeek(ws) {
  const cur = mondayOf(today());
  if (ws === cur) return t('sched.thisWeek');
  if (ws === addDays(cur, 7)) return t('sched.nextWeek');
  if (ws === addDays(cur, -7)) return t('sched.lastWeek');
  return '';
}

export async function renderSchedule(ctx, arg) {
  const { el, setTitle, setActions, can } = ctx;
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg || '')) week = mondayOf(arg);
  week = week || mondayOf(today());
  const manager = can('manager');
  setTitle(manager ? t('sched.title') : t('sched.myTitle'), { back: true });
  if (manager) {
    setActions(html`<button class="icon-btn" id="sched-more" aria-label="${t('sched.moreActions')}">${icon('sliders')}</button>`)
      .querySelector('#sched-more').addEventListener('click', () => moreSheet(ctx));
  }
  mount(el, html`${manager ? '' : html`<div id="mine"><div class="skeleton" style="height:120px;margin-top:4px"></div></div>
      <div class="section-head" style="margin-top:22px"><h2>${t('sched.teamWeek')}</h2></div>`}
    <div id="week"><div class="skeleton" style="height:90px;margin-top:4px"></div><div class="skeleton" style="height:300px;margin-top:12px"></div></div>`);
  if (!manager) renderMine(ctx);
  await drawWeek(ctx);
}

/* ------------------------------------------------------------ my shifts */

async function renderMine(ctx) {
  let r;
  try { r = await call('schedule.mine', { today: today() }); } catch (e) {
    const h = $('#mine');
    if (h && !ctx.stale()) mount(h, html`<div class="card">${emptyState('wifiOff', t('app.loadFailed'), e.message)}</div>`);
    return;
  }
  const host = $('#mine');
  if (ctx.stale() || !host) return;
  if (!r.shifts.length) { mount(host, html`<div class="card">${emptyState('calendar', t('sched.noMineTitle'), t('sched.noMineText'))}</div>`); return; }
  mount(host, html`<div class="card"><ul class="list my-shifts">${r.shifts.map((s) => html`<li><div class="row${s.date === r.today ? ' is-today' : ''}">
    <span class="date-badge"><small>${dayShort(s.date)}</small><b>${Number(s.date.slice(8))}</b></span>
    <span class="grow"><div class="title">${span(s)} ${s.templateName ? html`<span class="muted small">· ${s.templateName}</span>` : ''}
      ${s.date === r.today ? html`<span class="pill brand">${t('sched.today')}</span>` : ''}${s.changed ? html`<span class="pill warn">${t('sched.changed')}</span>` : ''}</div>
      <div class="sub">${s.breakMinutes ? t('sched.breakN', { n: s.breakMinutes }) + ' · ' : ''}${s.coworkers.length
        ? t('sched.withPeople', { names: s.coworkers.map((c) => c.name).join(', ') }) : t('sched.alone')}${s.note ? ` · ${s.note}` : ''}</div></span>
    <span class="value">${hrs(s.hours)}</span></div></li>`)}</ul></div>`);
}

/* ------------------------------------------------------------ the week */

async function drawWeek(ctx) {
  if (!view) view = matchMedia('(max-width: 640px)').matches ? 'day' : 'week';
  if (!lastView) lastView = view === 'month' ? 'week' : view;
  if (view === 'month') return drawMonth(ctx);
  const ws = week;
  const w = await call('schedule.week', { weekStart: ws });
  const host = $('#week');
  if (ctx.stale() || !host || ws !== week) return;
  ctx.weekData = w;
  const edit = w.canEdit;
  const tday = today();
  const days = w.days.map((d) => d.date);
  const cell = (p, d) => w.shifts.filter((s) => s.userId === p.id && s.date === d);
  const leaveOf = (p, d) => (w.leaves || []).find((l) => l.userId === p.id && l.date === d);
  const leaveTag = (p, d) => { const l = leaveOf(p, d); return l ? html`<span class="leave-tag">${t(l.type === 'leave' ? 'sched.onLeave' : `leave.type.${l.type}`)}</span>` : ''; };
  const status = !w.published ? html`<span class="pill">${t('sched.draft')}</span>`
    : w.changedSincePublish ? html`<span class="pill warn">${t('sched.changedN', { n: w.changedSincePublish })}</span>`
      : html`<span class="pill good">${icon('check')}${t('sched.published')}</span>`;
  const people = w.people;
  if (!days.includes(pickedDay)) pickedDay = days.includes(tday) ? tday : ws;
  const avatar = (p, i) => html`<span class="avatar sm" style="background:${p.colour || PERSON_COLOURS[i % PERSON_COLOURS.length]};color:#fff">${initial(p.name)}</span>`;
  // Phones: one day at a time, everyone in a row, big tap targets.
  const dayView = () => {
    const d = pickedDay;
    const info = w.days.find((x) => x.date === d);
    return html`<div class="day-strip">${w.days.map((x) => html`<button data-pick="${x.date}" aria-pressed="${x.date === d}" class="${x.date === tday ? 'is-today' : ''}">
        <small>${dayShort(x.date)}</small><b>${Number(x.date.slice(8))}</b><i>${x.people ? t('sched.nPeople', { n: x.people }) : '—'}</i></button>`)}</div>
      <div class="card"><div class="day-head"><b>${dayLong(d)}</b><span class="small muted">${info.people ? `${t('sched.nPeople', { n: info.people })} · ${hrs(info.hours)}` : t('sched.nobody')}</span></div>
      <ul class="list day-list">${people.filter((p) => edit || cell(p, d).length || leaveOf(p, d)).map((p, i) => { const list = cell(p, d); return html`<li><div class="row">
        ${avatar(p, people.indexOf(p))}<span class="grow"><div class="title">${p.name}</div><div class="sub">${p.position || ''}</div></span>
        <span class="day-cells">${leaveTag(p, d)}${list.map(chip)}${!list.length && !edit && !leaveOf(p, d) ? html`<span class="off">${t('sched.off')}</span>` : ''}
          ${edit && p.active ? html`<button type="button" class="cell-add${list.length ? ' more' : ''}" data-add="${p.id}" data-date="${d}" aria-label="${t('sched.addFor', { name: p.name, day: dayLong(d) })}">${icon('plus')}${list.length ? '' : html`<span>${t('sched.addShort')}</span>`}</button>` : ''}</span>
      </div></li>`; })}</ul></div>`;
  };
  const chip = (s) => html`<${raw(edit ? 'button' : 'span')} class="shift-chip${s.changed ? ' changed' : ''}" ${edit ? raw(`type="button" data-shift="${s.id}"`) : ''}
      style="--c:${s.colour || 'var(--brand)'}" title="${s.templateName || t('sched.custom')}${s.note ? ' · ' + s.note : ''}">
      <b>${span(s)}</b><small>${s.templateName || t('sched.custom')}</small></${raw(edit ? 'button' : 'span')}>`;

  mount(host, html`
    <div class="card pad sched-head">
      <div class="date-nav" style="margin:0">
        <button class="icon-btn" data-w="-1" aria-label="${t('sched.prevWeek')}">${icon('chevL')}</button>
        <div class="date-label">${weekLabel(ws)}<div class="sub">${relWeek(ws) || html`<button class="link-btn" data-w="0">${t('sched.backToThisWeek')}</button>`}</div></div>
        <button class="icon-btn" data-w="1" aria-label="${t('sched.nextWeekBtn')}">${icon('chevR')}</button>
      </div>
      ${edit ? html`<div class="sched-status">${status}<span class="small muted">${t('sched.summary', { people: people.filter((p) => p.hours).length, hours: number(w.totalHours, 1) })}</span></div>
      <div class="form-row sched-actions">
        <button class="btn" id="copy-week">${icon('copy')}${t('sched.copyLast')}</button>
        <button class="btn primary" id="publish" ${!w.shifts.length || (w.published && !w.changedSincePublish) ? raw('disabled') : ''}>${icon('send')}${w.published ? t('sched.republish') : t('sched.publish')}</button>
      </div>
      ${!w.published && w.shifts.length ? html`<p class="small muted" style="margin:8px 0 0">${t('sched.draftHint')}</p>` : ''}` : ''}
    </div>
    ${!edit && !w.published ? html`<div class="card" style="margin-top:12px">${emptyState('calendar', t('sched.notPublishedTitle'), t('sched.notPublishedText'))}</div>`
    : !people.length ? html`<div class="card" style="margin-top:12px">${emptyState('users', t('sched.noPeopleTitle'), t('sched.noPeopleText'),
      html`<a class="btn primary" href="#/team/people">${t('sched.goTeam')}</a>`)}</div>`
    : html`
    ${edit && !w.shifts.length ? html`<div class="sched-hint">${icon('info')}<span>${t('sched.emptyHint')}</span></div>` : ''}
    ${viewSeg()}
    ${view === 'day' ? dayView() : html`<div class="sched-wrap card"><table class="sched">
      <thead><tr><th class="who" scope="col">${t('sched.person')}</th>${days.map((d) => html`<th scope="col" class="${d === tday ? 'today' : ''}"><span>${dayShort(d)}</span><b>${Number(d.slice(8))}</b></th>`)}</tr></thead>
      <tbody>${people.map((p, i) => html`<tr>
        <th class="who" scope="row"><span class="who-in"><span class="avatar sm" style="background:${p.colour || PERSON_COLOURS[i % PERSON_COLOURS.length]};color:#fff">${initial(p.name)}</span>
          <span><b>${p.name}</b><small>${p.position ? p.position + ' · ' : ''}${hrs(p.hours)}</small></span></span></th>
        ${days.map((d) => { const list = cell(p, d); return html`<td class="${d === tday ? 'today' : ''}">
          ${leaveTag(p, d)}${list.map(chip)}
          ${edit && p.active ? html`<button type="button" class="cell-add${list.length ? ' more' : ''}" data-add="${p.id}" data-date="${d}" aria-label="${t('sched.addFor', { name: p.name, day: dayLong(d) })}">${icon('plus')}</button>` : ''}
          ${!edit && !list.length && !leaveOf(p, d) ? html`<span class="off">${t('sched.off')}</span>` : ''}</td>`; })}
      </tr>`)}</tbody>
      <tfoot><tr><th class="who" scope="row">${t('sched.total')}</th>${w.days.map((d) => html`<td class="${d.date === tday ? 'today' : ''}">
        ${d.people ? html`<b>${t('sched.nPeople', { n: d.people })}</b><small>${hrs(d.hours)}</small>` : html`<small class="muted">—</small>`}</td>`)}</tr></tfoot>
    </table></div>`}
    ${edit && w.templates.some((x) => x.active) ? html`<div class="sched-legend">${w.templates.filter((x) => x.active).map((x) => html`<span><i style="background:${x.colour || 'var(--brand)'}"></i>${x.name} ${x.startTime}–${x.endTime}</span>`)}
      <button class="link-btn" id="edit-tpls">${t('sched.editTemplates')}</button></div>` : ''}`}`);

  wireViewSeg(ctx, host);
  $$('[data-pick]', host).forEach((b) => b.addEventListener('click', () => { pickedDay = b.dataset.pick; drawWeek(ctx); }));
  $$('[data-w]', host).forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.w);
    week = n === 0 ? mondayOf(today()) : addDays(week, n * 7);
    pickedDay = n === 0 ? today() : addDays(pickedDay, n * 7);
    drawWeek(ctx);
  }));
  if (!edit) return;
  $$('[data-add]', host).forEach((b) => b.addEventListener('click', () => assignSheet(ctx, people.find((p) => p.id === b.dataset.add), b.dataset.date)));
  $$('[data-shift]', host).forEach((b) => b.addEventListener('click', () => editSheet(ctx, w.shifts.find((s) => s.id === b.dataset.shift))));
  $('#edit-tpls', host)?.addEventListener('click', () => templatesSheet(ctx));
  $('#copy-week', host).addEventListener('click', (e) => copyWeek(ctx, e.currentTarget));
  $('#publish', host).addEventListener('click', (e) => publish(ctx, e.currentTarget));
}

const redraw = (ctx) => drawWeek(ctx);

/* ------------------------------------------------------------ the month */

const viewSeg = () => html`<div class="seg view-seg" role="group" aria-label="${t('sched.view')}">
  <button data-view="day" aria-pressed="${view === 'day'}">${t('sched.viewDay')}</button>
  <button data-view="week" aria-pressed="${view === 'week'}">${t('sched.viewWeek')}</button>
  <button data-view="month" aria-pressed="${view === 'month'}">${t('sched.viewMonth')}</button></div>`;

function wireViewSeg(ctx, host) {
  $$('[data-view]', host).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.view === view) return;
    if (b.dataset.view === 'month') monthOn = (pickedDay || week).slice(0, 7);
    else lastView = b.dataset.view;
    view = b.dataset.view;
    drawWeek(ctx);
  }));
}

const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };

async function drawMonth(ctx) {
  const m = monthOn;
  let r;
  try { r = await call('schedule.month', { month: m }); } catch (e) {
    const h = $('#week');
    if (h && !ctx.stale()) mount(h, html`${viewSeg()}<div class="card">${emptyState('wifiOff', t('app.loadFailed'), e.message)}</div>`);
    if (h) wireViewSeg(ctx, h);
    return;
  }
  const host = $('#week');
  if (ctx.stale() || !host || view !== 'month' || m !== monthOn) return;
  const tday = today();
  const edit = r.canEdit;
  const people = Object.fromEntries(r.people.map((p, i) => [p.id, { ...p, colour: p.colour || PERSON_COLOURS[i % PERSON_COLOURS.length] }]));
  const byDay = {};
  r.shifts.forEach((s) => (byDay[s.date] ||= []).push(s));
  const drafts = r.weeks.filter((w) => !w.published && w.shifts).length;
  const curMonth = tday.slice(0, 7);
  const heads = Array.from({ length: 7 }, (_, i) => dayShort(addDays(r.from, i)));
  // Staff see only their own month total; managers see everyone's.
  const me = ctx.state.boot.user.id;
  const rows = r.people.filter((p) => p.hours && (edit || p.id === me));
  const dayCell = (d, w) => {
    const list = byDay[d] || [];
    const ids = [...new Set(list.map((s) => s.userId))];
    const out = d.slice(0, 7) !== m;
    return html`<button type="button" class="mc-day${out ? ' out' : ''}${d === tday ? ' today' : ''}${!w.published && w.shifts ? ' draft' : ''}" data-goto="${d}"
        aria-label="${dayLong(d)}${ids.length ? ' · ' + t('sched.nPeople', { n: ids.length }) : ''}">
      <span class="n">${Number(d.slice(8))}</span>
      ${ids.length ? html`<span class="mc-dots">${ids.slice(0, 4).map((id) => html`<i style="background:${(people[id] || {}).colour || 'var(--brand)'}">${initial((people[id] || {}).name)}</i>`)}${ids.length > 4 ? html`<em>+${ids.length - 4}</em>` : ''}</span>
        <span class="mc-lines">${list.slice(0, 4).map((s) => html`<span style="--c:${(people[s.userId] || {}).colour || 'var(--brand)'}" title="${(people[s.userId] || {}).name || ''} ${s.startTime}–${s.endTime}"><b>${s.startTime}</b> ${bare((people[s.userId] || {}).name)}</span>`)}${list.length > 4 ? html`<em>${t('sched.moreN', { n: list.length - 4 })}</em>` : ''}</span>` : ''}
    </button>`;
  };
  mount(host, html`
    <div class="card pad sched-head">
      <div class="date-nav" style="margin:0">
        <button class="icon-btn" data-mm="-1" aria-label="${t('sched.prevMonth')}">${icon('chevL')}</button>
        <div class="date-label">${fmtDate(m + '-01', { month: 'long', year: 'numeric' })}<div class="sub">${m === curMonth ? t('sched.thisMonth')
          : html`<button class="link-btn" data-mm="0">${t('sched.backToThisMonth')}</button>`}</div></div>
        <button class="icon-btn" data-mm="1" aria-label="${t('sched.nextMonth')}">${icon('chevR')}</button>
      </div>
      <div class="sched-status">${edit && drafts ? html`<span class="pill warn">${t('sched.draftWeeks', { n: drafts })}</span>` : html`<span></span>`}
        <span class="small muted">${edit ? t('sched.summary', { people: rows.length, hours: number(r.totalHours, 1) }) : ''}</span></div>
    </div>
    ${viewSeg()}
    <div class="card month-cal">
      <div class="mc-head">${heads.map((h) => html`<span>${h}</span>`)}</div>
      ${r.weeks.map((w) => html`<div class="mc-week">${Array.from({ length: 7 }, (_, i) => dayCell(addDays(w.weekStart, i), w))}</div>`)}
    </div>
    <p class="small muted mc-help">${edit ? t('sched.monthHelp') : t('sched.monthHelpStaff')}</p>
    ${rows.length ? html`<section class="section"><div class="section-head"><h2>${edit ? t('sched.monthHours') : t('sched.myMonthHours')}</h2></div>
      <div class="card"><ul class="list">${rows.map((p) => html`<li><div class="row">
        <span class="avatar sm" style="background:${people[p.id].colour};color:#fff">${initial(p.name)}</span>
        <span class="grow"><div class="title">${p.name}</div><div class="sub">${t('sched.nDays', { n: p.days })}${p.position ? ' · ' + p.position : ''}</div></span>
        <span class="value">${hrs(p.hours)}</span></div></li>`)}</ul></div></section>` : ''}`);

  wireViewSeg(ctx, host);
  $$('[data-mm]', host).forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.mm);
    monthOn = n === 0 ? curMonth : shiftMonth(monthOn, n);
    drawMonth(ctx);
  }));
  // A day opens that day (phones) or its week (wide screens), where shifts are planned.
  $$('[data-goto]', host).forEach((b) => b.addEventListener('click', () => {
    pickedDay = b.dataset.goto;
    week = mondayOf(pickedDay);
    view = lastView;
    drawWeek(ctx);
  }));
}


/* ------------------------------------------------------------ assign / edit */

function timesForm(s = {}) {
  return html`<div class="form-row">
      <label class="field"><span class="label">${t('sched.start')}</span><input class="input" type="time" name="startTime" step="300" value="${s.startTime || '10:00'}" required></label>
      <label class="field"><span class="label">${t('sched.end')}</span><input class="input" type="time" name="endTime" step="300" value="${s.endTime || '18:00'}" required></label>
    </div>
    <label class="field"><span class="label">${t('sched.break')}</span><select class="select" name="breakMinutes">${BREAKS.map((b) =>
      html`<option value="${b}" ${b === Number(s.breakMinutes ?? 60) ? raw('selected') : ''}>${b ? t('sched.minutes', { n: b }) : t('sched.noBreak')}</option>`)}</select></label>`;
}

/** Empty cell: one tap on a shift assigns it; other days of the week can be ticked to do several at once. */
function assignSheet(ctx, person, date) {
  const w = ctx.weekData;
  const tpls = w.templates.filter((x) => x.active);
  const days = new Set([date]);
  openSheet({
    title: t('sched.assignTitle', { name: person.name }),
    body: html`<div class="field"><span class="label">${t('sched.whichDays')}</span>
        <div class="chips day-chips">${w.days.map((d) => html`<button type="button" class="chip" data-day="${d.date}" aria-pressed="${d.date === date}">${dayShort(d.date)} ${Number(d.date.slice(8))}</button>`)}</div></div>
      <div class="tpl-pick">${tpls.map((x) => html`<button type="button" class="tpl-btn" data-tpl="${x.id}" style="--c:${x.colour || 'var(--brand)'}">
        <b>${x.name}</b><span>${x.startTime}–${x.endTime}</span><small>${hrs(x.hours)}${x.breakMinutes ? ' · ' + t('sched.breakN', { n: x.breakMinutes }) : ''}</small></button>`)}</div>
      <details class="custom-times"><summary>${t('sched.customTimes')}</summary>
        <form id="cf" novalidate style="margin-top:10px">${timesForm()}
          <label class="field"><span class="label">${t('sched.note')}</span><input class="input" name="note" maxlength="120" placeholder="${t('common.optional')}"><span class="hint">${t('sched.noteHint')}</span></label>
          <button class="btn primary block" type="submit">${t('sched.addShift')}</button></form></details>`,
    onMount(el, close) {
      $$('[data-day]', el).forEach((b) => b.addEventListener('click', () => {
        if (days.has(b.dataset.day) && days.size > 1) days.delete(b.dataset.day); else days.add(b.dataset.day);
        b.setAttribute('aria-pressed', days.has(b.dataset.day));
      }));
      const save = async (item, btn) => busy(btn, async () => {
        const errors = [];
        let done = 0;
        for (const d of [...days].sort()) {
          try { await call('schedule.save', { item: { ...item, userId: person.id, date: d } }); done++; } catch (e) { errors.push(`${dayShort(d)}: ${e.message}`); }
        }
        if (done) { close(); redraw(ctx); }
        if (errors.length) {
          if (done) toast(errors.join(' · '), 'bad', 6000); else throw new Error(errors.join(' · '));
        } else toast(done > 1 ? t('sched.addedN', { n: done }) : t('sched.added'));
      }, el.querySelector('.sheet-body'));
      $$('[data-tpl]', el).forEach((b) => b.addEventListener('click', () => save({ templateId: b.dataset.tpl }, b)));
      const f = $('#cf', el);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        save({ startTime: f.startTime.value, endTime: f.endTime.value, breakMinutes: f.breakMinutes.value, note: f.note.value }, f.querySelector('[type=submit]'));
      });
    },
  });
}

function editSheet(ctx, s) {
  const w = ctx.weekData;
  const person = w.people.find((p) => p.id === s.userId) || { name: '' };
  const tpls = w.templates.filter((x) => x.active);
  openSheet({
    title: `${person.name} · ${dayLong(s.date)}`,
    body: html`<div class="tpl-pick">${tpls.map((x) => html`<button type="button" class="tpl-btn" data-tpl="${x.id}" style="--c:${x.colour || 'var(--brand)'}" aria-pressed="${x.id === s.templateId && x.startTime === s.startTime && x.endTime === s.endTime}">
        <b>${x.name}</b><span>${x.startTime}–${x.endTime}</span><small>${hrs(x.hours)}</small></button>`)}</div>
      <form id="ef" novalidate style="margin-top:14px">
        <div class="section-head" style="margin:0 0 6px"><h3 style="margin:0;font-size:15px">${t('sched.customTimes')}</h3></div>
        ${timesForm(s)}
        <label class="field"><span class="label">${t('sched.note')}</span><input class="input" name="note" maxlength="120" value="${s.note}" placeholder="${t('common.optional')}"><span class="hint">${t('sched.noteHint')}</span></label>
        <button class="btn primary block" type="submit">${t('common.save')}</button>
      </form>
      <div class="form-row" style="margin-top:12px">
        <button class="btn" id="add-another">${icon('plus')}${t('sched.addAnother')}</button>
        <button class="btn danger" id="remove">${icon('trash')}${t('sched.remove')}</button>
      </div>`,
    onMount(el, close) {
      const host = el.querySelector('.sheet-body');
      const save = (item, btn) => busy(btn, async () => {
        await call('schedule.save', { item: { id: s.id, version: s.version, userId: s.userId, date: s.date, note: s.note, ...item } });
        close(); toast(t('sched.saved')); redraw(ctx);
      }, host);
      $$('[data-tpl]', el).forEach((b) => b.addEventListener('click', () => save({ templateId: b.dataset.tpl, startTime: '', endTime: '' }, b)));
      const f = $('#ef', el);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        // Times typed by hand stay linked to the template only if they still match it.
        const tpl = tpls.find((x) => x.id === s.templateId);
        const same = tpl && tpl.startTime === f.startTime.value && tpl.endTime === f.endTime.value;
        save({ templateId: same ? s.templateId : '', startTime: f.startTime.value, endTime: f.endTime.value, breakMinutes: f.breakMinutes.value, note: f.note.value }, f.querySelector('[type=submit]'));
      });
      $('#remove', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await call('schedule.remove', { id: s.id });
        close(); toast(t('sched.removed')); redraw(ctx);
      }, host));
      $('#add-another', el).addEventListener('click', () => { close(); setTimeout(() => assignSheet(ctx, person, s.date), 50); });
    },
  });
}

/* ------------------------------------------------------------ week actions */

async function copyWeek(ctx, btn) {
  const week = ctx.weekData.weekStart;     // the week on screen, even if the arrows were just tapped
  const from = addDays(week, -7);
  const ok = await confirmSheet({ title: t('sched.copyTitle'), message: t('sched.copyText', { from: weekLabel(from), to: weekLabel(week) }), confirm: t('sched.copyLast') });
  if (!ok) return;
  busy(btn, async () => {
    const r = await call('schedule.copyWeek', { weekStart: week });
    toast(r.skipped ? t('sched.copiedSkipped', { n: r.copied, m: r.skipped }) : t('sched.copied', { n: r.copied }), r.copied ? 'good' : 'info', 5000);
    redraw(ctx);
  });
}

async function publish(ctx, btn) {
  const w = ctx.weekData;
  const week = w.weekStart;
  const ok = await confirmSheet({ title: t(w.published ? 'sched.republishTitle' : 'sched.publishTitle', { week: weekLabel(week) }),
    message: t(w.published ? 'sched.republishText' : 'sched.publishText'), confirm: w.published ? t('sched.republish') : t('sched.publish') });
  if (!ok) return;
  busy(btn, async () => {
    await call('schedule.publish', { weekStart: week });
    toast(t('sched.publishedToast'), 'good', 7000, { label: t('sched.share'), onClick: () => share(ctx) });
    redraw(ctx);
  });
}

function shareText(ctx) {
  const w = ctx.weekData;
  const name = (id) => (w.people.find((p) => p.id === id) || {}).name || '';
  const lines = [t('sched.shareHead', { week: weekLabel(w.weekStart), shop: ctx.state.boot.settings.restaurantName })];
  w.days.forEach((d) => {
    const on = w.shifts.filter((s) => s.date === d.date);
    lines.push(`${dayLong(d.date)}: ${on.length ? on.map((s) => `${name(s.userId)} ${span(s)}`).join(', ') : t('sched.nobody')}`);
  });
  return lines.join('\n');
}
async function share(ctx) {
  const text = shareText(ctx);
  try {
    if (navigator.share) { await navigator.share({ title: t('sched.title'), text }); return; }
    await navigator.clipboard.writeText(text);
    toast(t('sched.copiedText'));
  } catch (e) { if (e && e.name !== 'AbortError') toast(t('sched.shareFailed'), 'bad'); }
}

function printWeek(ctx) {
  const w = ctx.weekData;
  const days = w.days.map((d) => d.date);
  printHtml(html`<section class="sched-print">
    <header><div><div class="small">${ctx.state.boot.settings.restaurantName}</div><h1>${t('sched.printTitle', { week: weekLabel(w.weekStart) })}</h1></div>
      <div class="small">${w.published ? t('sched.published') : t('sched.printDraft')}</div></header>
    <table><thead><tr><th>${t('sched.person')}</th>${days.map((d) => html`<th>${dayShort(d)} ${Number(d.slice(8))}</th>`)}<th>${t('sched.weekHours')}</th></tr></thead>
      <tbody>${w.people.filter((p) => p.hours).map((p) => html`<tr><th>${p.name}${p.position ? html`<small>${p.position}</small>` : ''}</th>
        ${days.map((d) => html`<td>${w.shifts.filter((s) => s.userId === p.id && s.date === d).map((s) => html`<div><b>${span(s)}</b>${s.templateName ? html`<small>${s.templateName}</small>` : ''}</div>`)}</td>`)}
        <td class="num">${number(p.hours, 1)}</td></tr>`)}</tbody>
      <tfoot><tr><th>${t('sched.total')}</th>${w.days.map((d) => html`<td>${d.people ? t('sched.nPeople', { n: d.people }) : '—'}</td>`)}<td class="num">${number(w.totalHours, 1)}</td></tr></tfoot>
    </table></section>`);
}

function moreSheet(ctx) {
  const w = ctx.weekData;
  if (!w) return;
  const week = w.weekStart;
  const row = (id, ic, title, sub, cls = '') => html`<li><button class="row" id="${id}"><span class="avatar ${cls}">${icon(ic)}</span>
    <span class="grow"><div class="title">${title}</div>${sub ? html`<div class="sub">${sub}</div>` : ''}</span></button></li>`;
  openSheet({
    title: t('sched.moreActions'),
    body: html`<ul class="list">
      ${row('m-tpl', 'clock', t('sched.templates'), t('sched.templatesSub'), 'brand')}
      ${row('m-print', 'print', t('sched.print'), t('sched.printSub'))}
      ${row('m-share', 'share', t('sched.share'), t('sched.shareSub'))}
      ${!w.published && w.shifts.length ? row('m-clear', 'trash', t('sched.clear'), t('sched.clearSub'), 'bad') : ''}</ul>`,
    onMount(el, close) {
      const go = (id, fn) => $(`#${id}`, el)?.addEventListener('click', () => { close(); setTimeout(fn, 50); });
      go('m-tpl', () => templatesSheet(ctx));
      go('m-print', () => printWeek(ctx));
      go('m-share', () => share(ctx));
      go('m-clear', async () => {
        const ok = await confirmSheet({ title: t('sched.clearTitle'), message: t('sched.clearText', { n: w.shifts.length, week: weekLabel(week) }), confirm: t('sched.clear'), danger: true });
        if (!ok) return;
        try { const r = await call('schedule.clearWeek', { weekStart: week }); toast(t('sched.cleared', { n: r.removed })); redraw(ctx); } catch (e) { toast(e.message, 'bad', 5000); }
      });
    },
  });
}

/* ------------------------------------------------------------ shift templates */

async function templatesSheet(ctx) {
  const list = (await call('shiftTemplates.list', {})).filter((x) => x.active);
  openSheet({
    title: t('sched.templates'),
    body: html`<p class="small muted" style="margin-top:0">${t('sched.templatesHelp')}</p>
      <div class="card"><ul class="list">${list.map((x) => html`<li><button class="row" data-id="${x.id}">
        <span class="avatar" style="background:${x.colour || 'var(--brand)'};color:#fff">${icon('clock')}</span>
        <span class="grow"><div class="title">${x.name}</div><div class="sub">${x.startTime}–${x.endTime} · ${hrs(x.hours)}${x.breakMinutes ? ' · ' + t('sched.breakN', { n: x.breakMinutes }) : ''}</div></span>${icon('chevR', 'chev')}</button></li>`)}</ul></div>`,
    foot: html`<button class="btn primary block" id="new-tpl">${icon('plus')}${t('sched.newTemplate')}</button>`,
    onMount(el, close) {
      $$('[data-id]', el).forEach((b) => b.addEventListener('click', () => { close(); setTimeout(() => templateSheet(ctx, list.find((x) => x.id === b.dataset.id)), 50); }));
      $('#new-tpl', el).addEventListener('click', () => { close(); setTimeout(() => templateSheet(ctx, null), 50); });
    },
  });
}

function templateSheet(ctx, item) {
  const isNew = !item;
  let colour = (item && item.colour) || COLOURS[(ctx.weekData?.templates.length || 0) % COLOURS.length];
  openSheet({
    title: isNew ? t('sched.newTemplate') : item.name,
    body: html`<form id="tf" novalidate>
      <label class="field"><span class="label">${t('sched.templateName')}</span><input class="input" name="name" maxlength="40" value="${item ? item.name : ''}" placeholder="${t('sched.templateNameHint')}" required></label>
      ${timesForm(item || { startTime: '10:00', endTime: '18:00', breakMinutes: 60 })}
      <div class="field"><span class="label">${t('team.colour')}</span><div class="colour-row">${COLOURS.map((c) => html`<button type="button" class="colour-dot" data-colour="${c}" style="background:${c}" aria-pressed="${c === colour}" aria-label="${c}"></button>`)}</div></div>
      <p class="small muted">${t('sched.templateNote')}</p>
    </form>`,
    foot: html`${isNew ? '' : html`<button class="btn danger" id="retire">${t('sched.retireTemplate')}</button>`}<button class="btn primary" id="save-tpl">${t('common.save')}</button>`,
    onMount(el, close) {
      const f = $('#tf', el);
      $$('[data-colour]', el).forEach((b) => b.addEventListener('click', () => {
        colour = b.dataset.colour;
        $$('[data-colour]', el).forEach((x) => x.setAttribute('aria-pressed', x === b));
      }));
      const submit = () => busy($('#save-tpl', el), async () => {
        await call('shiftTemplates.save', { item: { id: item?.id, version: item?.version, name: f.name.value, startTime: f.startTime.value,
          endTime: f.endTime.value, breakMinutes: f.breakMinutes.value, colour } });
        close(); toast(t('sched.templateSaved')); redraw(ctx);
      }, f);
      f.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      $('#save-tpl', el).addEventListener('click', submit);
      $('#retire', el)?.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: t('sched.retireTemplate'), message: t('sched.retireText', { name: item.name }), confirm: t('sched.retireTemplate'), danger: true });
        if (!ok) return;
        try { await call('shiftTemplates.retire', { id: item.id }); close(); toast(t('sched.templateRetired')); redraw(ctx); } catch (e) { showFormError(f, e.message); }
      });
    },
  });
}
