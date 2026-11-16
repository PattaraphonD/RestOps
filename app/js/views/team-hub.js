// The ทีม tab: everything about people, kept apart from the shop's daily work.
// Staff and managers: the clock, my shifts, my time, leave. Owner and managers: who's on, what the team needs, schedule, timesheet, leave, people.
import { call } from '../api.js';
import { html, mount, icon, $$, emptyState, fmtDate, number } from '../ui.js';
import { t } from '../i18n.js';
import { clockCard, wireClock } from './timeclock.js';
import { renderSchedule } from './schedule.js';
import { renderTimesheet, renderMyTime } from './timeclock.js';
import { renderLeave } from './leave.js';
import { renderTeam } from './team.js';

const PAGES = { schedule: renderSchedule, timesheet: renderTimesheet, mytime: renderMyTime, leave: renderLeave, people: renderTeam };

const TASK = {
  pinBlocked: { icon: 'users', cls: 'bad', href: () => '#/team/people' },
  leavePending: { icon: 'users', cls: 'warn', href: () => '#/team/leave' },
  clockReview: { icon: 'clock', cls: 'warn', href: (x) => `#/team/timesheet/${(x.items && x.items[0] && x.items[0].weekStart) || ''}` },
  schedulePublish: { icon: 'calendar', cls: 'warn', href: (x) => `#/team/schedule/${x.items[0].weekStart}` },
};
const span = (s) => `${s.startTime}–${s.endTime}`;

export async function render(ctx) {
  const [sub, arg] = ctx.params;
  if (PAGES[sub]) return PAGES[sub](ctx, arg);
  return hub(ctx);
}

async function hub(ctx) {
  const { el, setTitle, can, state } = ctx;
  setTitle(t('hub.title'));
  mount(el, html`<div class="skeleton" style="height:180px;margin-top:4px"></div><div class="skeleton" style="height:140px;margin-top:12px"></div>`);
  let r;
  try { r = await call('team.today', {}); } catch (e) {
    if (!ctx.stale()) mount(el, html`<div class="card">${emptyState('wifiOff', t('app.loadFailed'), e.message)}</div>`);
    return;
  }
  if (ctx.stale()) return;
  // Keep the tab's badge in step with what's on screen.
  state.boot.teamBadge = r.badge;
  ctx.updateBadges && ctx.updateBadges();
  const manager = r.canManage;
  const owner = can('owner');
  const clocks = r.clock && r.clock.canClock;
  const tile = (href, ic, title, sub) => html`<a class="hub-tile" href="${href}"><span class="avatar brand">${icon(ic)}</span><b>${title}</b><small>${sub}</small></a>`;
  const leaveSub = r.leave ? t('hub.leaveLeft', { sick: r.leave.sick.left, personal: r.leave.personal.left, vacation: r.leave.vacation.left }) : t('more.leaveTeamSub');
  mount(el, html`
    ${clocks ? clockCard(r.clock, r.shifts.next) : ''}

    ${manager ? html`<section class="section"><div class="section-head"><h2>${t('hub.needs')}</h2></div>
      <div class="card">${r.tasks.length ? html`<ul class="list">${r.tasks.map((x) => {
        const m = TASK[x.kind] || { icon: 'info', cls: '', href: () => null };
        const sub = x.kind === 'pinBlocked' ? x.items.map((i) => i.name).join(', ') : '';
        return html`<li><a class="row" href="${m.href(x)}"><span class="avatar ${m.cls}">${icon(m.icon)}</span>
          <span class="grow"><div class="title">${t(`today.task.${x.kind}`, { n: x.n })}</div>${sub ? html`<div class="sub">${sub}</div>` : ''}</span>${icon('chevR', 'chev')}</a></li>`;
      })}</ul>` : html`<div class="hub-clear">${icon('check')}<span>${t('hub.allClear')}</span></div>`}</div></section>

      <section class="section"><div class="section-head"><h2>${t('sched.onToday')}</h2><a class="link" href="#/team/schedule">${t('sched.title')}</a></div>
      <div class="card pad">${r.shifts.onToday.length ? html`<div class="on-today">${r.shifts.onToday.map((p) => html`<span class="who-chip ${clockCls(p.clock)}"><b>${p.name}</b>${p.startTime}–${p.endTime}
        ${p.clock ? html`<small>${clockText(p.clock)}</small>` : ''}</span>`)}</div>` : html`<p class="small muted" style="margin:0">${t('hub.nobodyToday')}</p>`}</div></section>` : ''}

    ${clocks ? html`<section class="section"><div class="section-head"><h2>${t('hub.myShifts')}</h2><a class="link" href="#/team/schedule">${t('hub.seeAll')}</a></div>
      <div class="card">${r.shifts.upcoming.length ? html`<ul class="list my-shifts">${r.shifts.upcoming.map((s) => html`<li><a class="row${s.date === r.today ? ' is-today' : ''}" href="#/team/schedule/${s.date}">
        <span class="date-badge"><small>${fmtDate(s.date, { weekday: 'short' })}</small><b>${Number(s.date.slice(8))}</b></span>
        <span class="grow"><div class="title">${span(s)} ${s.templateName ? html`<span class="muted small">· ${s.templateName}</span>` : ''}${s.date === r.today ? html`<span class="pill brand">${t('sched.today')}</span>` : ''}</div>
          <div class="sub">${s.coworkers.length ? t('sched.withPeople', { names: s.coworkers.map((c) => c.name).join(', ') }) : t('sched.alone')}</div></span>
        <span class="value">${t('sched.hours', { n: number(s.hours, 1) })}</span></a></li>`)}</ul>`
        : emptyState('calendar', t('sched.noMineTitle'), t('sched.noMineText'))}</div></section>` : ''}

    <section class="section"><div class="section-head"><h2>${t('hub.tools')}</h2></div>
      <div class="hub-tiles">
        ${tile('#/team/schedule', 'calendar', manager ? t('sched.title') : t('hub.teamSchedule'), manager ? t('more.scheduleSub') : t('hub.teamScheduleSub'))}
        ${manager ? tile('#/team/timesheet', 'clock', t('ts.title'), t('more.timesheetSub')) : ''}
        ${clocks ? tile('#/team/mytime', 'clock', t('clock.myTitle'), t('more.myTimeSub')) : ''}
        ${tile('#/team/leave', 'users', manager ? t('leave.titleTeam') : t('leave.title'), leaveSub)}
        ${owner ? tile('#/team/people', 'users', t('hub.people'), t('hub.peopleSub', { n: state.boot.users.filter((u) => u.active).length })) : ''}
      </div></section>`);
  if (clocks) wireClock(el, r.clock, () => ctx.rerender());
  $$('.hub-tile', el).forEach((a) => a.addEventListener('click', () => window.scrollTo(0, 0)));
}

const clockCls = (c) => (!c ? '' : c.state === 'notIn' || c.state === 'absent' ? 'is-bad' : c.state === 'in' ? (c.lateMinutes ? 'is-late' : 'is-in') : c.state === 'out' ? 'is-out' : '');
function clockText(c) {
  if (c.state === 'in') return c.lateMinutes ? t('clock.chipLate', { time: c.inTime, n: c.lateMinutes }) : t('clock.chipIn', { time: c.inTime });
  if (c.state === 'out') return t('clock.chipOut', { time: c.outTime });
  if (c.state === 'notIn') return c.lateMinutes ? t('clock.chipNotIn', { n: c.lateMinutes }) : t('clock.chipNotInYet');
  return t(`clock.chip.${c.state}`);
}
