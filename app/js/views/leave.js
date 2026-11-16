// More → ลางาน: balances, asking for leave, and (owner/managers) approving the team's requests.
import { call } from '../api.js';
import { html, mount, icon, $, $$, openSheet, confirmSheet, toast, busy, emptyState, fmtDate, today, addDays } from '../ui.js';
import { t } from '../i18n.js';

const TYPES = ['sick', 'personal', 'vacation', 'unpaid'];
const PERSON_COLOURS = ['#2e6e71', '#d06f66', '#8a6d1f', '#4b5d9c', '#7a4f8a', '#2f8f4e', '#a5463d', '#3d7a9c'];
const initial = (name) => Array.from(String(name || '?').replace(/^(น้อง|พี่|คุณ|ป้า|ลุง)\s*/, ''))[0] || '?';
const STATUS_CLS = { pending: 'warn', approved: 'good', rejected: 'bad', cancelled: '' };
const range = (l) => (l.fromDate === l.toDate ? fmtDate(l.fromDate, { weekday: 'short', day: 'numeric', month: 'short' })
  : `${fmtDate(l.fromDate, { day: 'numeric', month: 'short' })} – ${fmtDate(l.toDate, { day: 'numeric', month: 'short', year: 'numeric' })}`);

export async function renderLeave(ctx) {
  const { el, setTitle, setActions, can, state } = ctx;
  const manager = can('manager');
  const owner = can('owner');
  setTitle(manager ? t('leave.titleTeam') : t('leave.title'), { back: true });
  if (!owner) {
    setActions(html`<button class="btn sm primary" id="ask">${icon('plus')}${t('leave.ask')}</button>`)
      .querySelector('#ask').addEventListener('click', () => askSheet(ctx));
  }
  mount(el, html`<div class="skeleton" style="height:140px;margin-top:4px"></div><div class="skeleton" style="height:220px;margin-top:12px"></div>`);
  const r = await call('leave.list', {});
  if (ctx.stale()) return;
  const me = state.boot.user.id;
  const pending = r.requests.filter((l) => l.status === 'pending' && manager && (l.userId !== me || owner));
  const mineBal = r.balances.find((b) => b.userId === me);
  const others = r.requests.filter((l) => !pending.includes(l));
  const balCard = (b) => html`<div class="leave-bal">${['sick', 'personal', 'vacation'].map((type) => {
    const x = b.types[type];
    return html`<div class="bal ${x.left === 0 && x.entitled ? 'empty' : ''}"><span>${t(`leave.type.${type}`)}</span>
      <b>${x.left}<small>/${x.entitled}</small></b><em>${x.from ? t('leave.vacationFrom', { date: fmtDate(x.from, { day: 'numeric', month: 'short', year: 'numeric' }) })
        : x.pending ? t('leave.usedPending', { used: x.used, pending: x.pending }) : t('leave.used', { n: x.used })}</em></div>`;
  })}</div>`;
  mount(el, html`
    ${mineBal && !owner ? html`<section class="section" style="margin-top:4px"><div class="section-head"><h2>${t('leave.myBalance', { year: Number(r.year) + 543 })}</h2></div>
      <div class="card pad">${balCard(mineBal)}<button class="btn primary block" id="ask2" style="margin-top:12px">${icon('plus')}${t('leave.ask')}</button></div></section>` : ''}
    ${manager ? html`<button class="btn block" id="record" style="margin-top:4px">${icon('plus')}${t('leave.recordFor')}</button>
      <section class="section"><div class="section-head"><h2>${t('leave.pending')}</h2></div>
      <div class="card">${pending.length ? html`<ul class="list">${pending.map((l) => html`<li><div class="row leave-row">
        <span class="grow"><div class="title">${l.name} · ${t(`leave.type.${l.type}`)}</div><div class="sub">${range(l)} · ${t('leave.nDays', { n: l.days })}${l.reason ? ` · ${l.reason}` : ''}</div></span>
        <span class="leave-actions"><button class="btn sm" data-reject="${l.id}">${t('leave.reject')}</button><button class="btn sm primary" data-approve="${l.id}">${t('leave.approve')}</button></span>
      </div></li>`)}</ul>` : emptyState('check', t('leave.noPendingTitle'), t('leave.noPendingText'))}</div></section>
      <section class="section"><div class="section-head"><h2>${t('leave.teamBalance', { year: Number(r.year) + 543 })}</h2></div>
      <div class="card"><ul class="list">${r.balances.map((b, i) => html`<li><div class="row">
        <span class="avatar sm" style="background:${b.colour || PERSON_COLOURS[i % PERSON_COLOURS.length]};color:#fff">${initial(b.name)}</span>
        <span class="grow"><div class="title">${b.name}</div><div class="sub">${['sick', 'personal', 'vacation'].map((type) => t('leave.shortBal', { type: t(`leave.type.${type}`), used: b.types[type].used, of: b.types[type].entitled })).join(' · ')}</div></span>
      </div></li>`)}</ul></div></section>` : ''}
    <section class="section"><div class="section-head"><h2>${manager ? t('leave.history') : t('leave.myRequests')}</h2></div>
      <div class="card">${others.length ? html`<ul class="list">${others.map((l) => html`<li><div class="row leave-row">
        <span class="grow"><div class="title">${manager ? `${l.name} · ` : ''}${t(`leave.type.${l.type}`)} <span class="pill ${STATUS_CLS[l.status]}">${t(`leave.status.${l.status}`)}</span></div>
          <div class="sub">${range(l)} · ${t('leave.nDays', { n: l.days })}${l.reason ? ` · ${l.reason}` : ''}${l.decisionNote ? html`<br>${t('leave.note', { who: l.decidedBy, note: l.decisionNote })}` : ''}</div></span>
        ${(l.status === 'pending' && l.userId === me) || (manager && l.status === 'approved' && l.toDate >= today()) ? html`<button class="btn sm" data-cancel="${l.id}">${t('leave.cancel')}</button>` : ''}
      </div></li>`)}</ul>` : emptyState('calendar', t('leave.emptyTitle'), t('leave.emptyText'))}</div></section>
    <p class="small muted" style="margin:10px 2px">${t('leave.help')}</p>`);
  $('#ask2', el)?.addEventListener('click', () => askSheet(ctx));
  $('#record', el)?.addEventListener('click', () => askSheet(ctx, r.balances.filter((b) => b.userId !== me)));
  $$('[data-approve]', el).forEach((b) => b.addEventListener('click', () => decideSheet(ctx, r.requests.find((l) => l.id === b.dataset.approve), true)));
  $$('[data-reject]', el).forEach((b) => b.addEventListener('click', () => decideSheet(ctx, r.requests.find((l) => l.id === b.dataset.reject), false)));
  $$('[data-cancel]', el).forEach((b) => b.addEventListener('click', async () => {
    const l = r.requests.find((x) => x.id === b.dataset.cancel);
    const ok = await confirmSheet({ title: t('leave.cancelTitle'), message: t('leave.cancelText', { type: t(`leave.type.${l.type}`), range: range(l) }), confirm: t('leave.cancel'), danger: true });
    if (!ok) return;
    try { await call('leave.cancel', { id: l.id }); toast(t('leave.cancelled')); renderLeave(ctx); } catch (e) { toast(e.message, 'bad', 5000); }
  }));
}

/** Ask for leave, or (managers, with `people`) record someone's leave — approved at once. */
function askSheet(ctx, people) {
  let type = 'sick';
  const d = today();
  const back = people ? 365 : 30;
  openSheet({
    title: people ? t('leave.recordFor') : t('leave.ask'),
    body: html`<form id="lf" novalidate>
      ${people ? html`<label class="field"><span class="label">${t('sched.person')}</span><select class="select" name="userId">${people.map((p) => html`<option value="${p.userId}">${p.name}</option>`)}</select>
        <span class="hint">${t('leave.recordHint')}</span></label>` : ''}
      <div class="field"><span class="label">${t('leave.which')}</span>
        <div class="leave-types">${TYPES.map((x) => html`<button type="button" class="leave-type" data-type="${x}" aria-pressed="${x === type}">
          <b>${t(`leave.type.${x}`)}</b><small>${t(`leave.typeHelp.${x}`)}</small></button>`)}</div></div>
      <div class="form-row">
        <label class="field"><span class="label">${t('leave.from')}</span><input class="input" type="date" name="fromDate" value="${d}" min="${addDays(d, -back)}" required></label>
        <label class="field"><span class="label">${t('leave.to')}</span><input class="input" type="date" name="toDate" value="${d}" min="${addDays(d, -back)}" required></label>
      </div>
      <p class="small muted" id="days"></p>
      <label class="field"><span class="label">${t('leave.reason')}</span><input class="input" name="reason" maxlength="200" placeholder="${t('common.optional')}"></label>
      <button class="btn primary block" type="submit">${people ? t('leave.record') : t('leave.send')}</button>
    </form>`,
    onMount(el, close) {
      const f = $('#lf', el);
      const showDays = () => {
        const a = f.fromDate.value, b = f.toDate.value;
        if (b < a) f.toDate.value = a;
        const n = Math.round((Date.parse(f.toDate.value) - Date.parse(a)) / 86400000) + 1;
        $('#days', el).textContent = n > 0 ? t('leave.nDays', { n }) : '';
      };
      f.fromDate.addEventListener('change', showDays);
      f.toDate.addEventListener('change', showDays);
      showDays();
      $$('[data-type]', el).forEach((b) => b.addEventListener('click', () => {
        type = b.dataset.type;
        $$('[data-type]', el).forEach((x) => x.setAttribute('aria-pressed', x === b));
      }));
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(f.querySelector('[type=submit]'), async () => {
          await call('leave.request', { userId: people ? f.userId.value : undefined, type, fromDate: f.fromDate.value, toDate: f.toDate.value, reason: f.reason.value });
          close(); toast(people ? t('leave.recorded') : t('leave.sent'), 'good', 5000); renderLeave(ctx);
        }, f);
      });
    },
  });
}

function decideSheet(ctx, l, approve) {
  openSheet({
    title: approve ? t('leave.approveTitle', { name: l.name }) : t('leave.rejectTitle', { name: l.name }),
    body: html`<p style="margin-top:0"><b>${t(`leave.type.${l.type}`)}</b> · ${range(l)} · ${t('leave.nDays', { n: l.days })}${l.reason ? html`<br><span class="muted">${l.reason}</span>` : ''}</p>
      <form id="df" novalidate><label class="field"><span class="label">${t('leave.noteLabel')}</span><input class="input" name="note" maxlength="200" placeholder="${approve ? t('common.optional') : t('leave.rejectHint')}"></label></form>`,
    foot: html`<button class="btn" data-close>${t('common.cancel')}</button><button class="btn ${approve ? 'primary' : 'danger'}" id="go">${approve ? t('leave.approve') : t('leave.reject')}</button>`,
    onMount(el, close) {
      const f = $('#df', el);
      $('#go', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const r = await call('leave.decide', { id: l.id, approve, note: f.note.value });
        close();
        toast(approve ? t('leave.approvedToast') : t('leave.rejectedToast'), 'good');
        if (approve && r.shiftsAffected) toast(t('leave.shiftsAffected', { n: r.shiftsAffected, name: l.name }), 'warn', 8000, { label: t('sched.title'), onClick: () => { location.hash = `#/team/schedule/${l.fromDate}`; } });
        renderLeave(ctx);
      }, f));
    },
  });
}
