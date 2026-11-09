// Sales: daily entry by dish, day totals, void (managers).
import { call } from '../api.js';
import {
  html, mount, icon, money, number, pct, today, addDays, relDay, fmtDate, timeOf, $, $$, openSheet, confirmSheet,
  toast, busy, options, emptyState,
} from '../ui.js';
import { list } from '../app.js';
import { t } from '../i18n.js';

let day = null;

export async function render(ctx) {
  const { el, params, setTitle, state } = ctx;
  setTitle(t('nav.sales'));
  day = day || today();
  const openNew = params[0] === 'new';
  if (openNew) { history.replaceState(null, '', '#/sales'); day = today(); ctx.params = []; }
  const atLatest = day >= today();

  mount(el, html`
    <div class="date-nav">
      <button class="icon-btn" data-d="-1" aria-label="${t('common.prevDay')}">${icon('chevL')}</button>
      <label class="date-label">${relDay(day)}<div class="sub">${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <input type="date" value="${day}" max="${today()}" aria-label="${t('common.pickDate')}"></label>
      <button class="icon-btn" data-d="1" aria-label="${t('common.nextDay')}" ${atLatest ? 'disabled' : ''} style="${atLatest ? 'opacity:.3' : ''}">${icon('chevR')}</button>
    </div>
    <div id="day"><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:240px;margin-top:12px"></div></div>`);
  $$('[data-d]', el).forEach((b) => b.addEventListener('click', () => {
    const next = addDays(day, Number(b.dataset.d));
    if (next > today()) return;
    day = next; render(ctx);
  }));
  el.querySelector('.date-label input').addEventListener('change', (e) => { if (e.target.value) { day = e.target.value; render(ctx); } });

  document.querySelectorAll('.fab').forEach((f) => f.remove());
  const fab = document.createElement('button');
  fab.className = 'fab';
  mount(fab, html`${icon('plus')}${t('sales.add')}`);
  fab.addEventListener('click', () => entrySheet(ctx));
  document.body.append(fab);

  const s = await call('sales.list', { from: day, to: day });
  if (ctx.stale() || !$('#day')) return;
  const live = s.rows.filter((r) => !r.voided);
  const byItem = {};
  live.forEach((r) => { const b = (byItem[r.itemName] ||= { qty: 0, total: 0 }); b.qty += r.qty; b.total += r.total; });
  const byChannel = {};
  const other = t('common.other');
  live.forEach((r) => { byChannel[r.channel || other] = (byChannel[r.channel || other] || 0) + r.total; });
  const batches = {};
  s.rows.forEach((r) => (batches[r.createdAt + '|' + r.createdBy + '|' + r.channel] ||= []).push(r));

  mount($('#day'), html`
    <div class="card summary-strip">
      <div><div class="val">${money(s.total, { cents: false })}</div><div class="label">${t('nav.sales')}</div></div>
      <div><div class="val">${number(s.dishes, 0)}</div><div class="label">${t('sales.items')}</div></div>
      <div><div class="val">${s.total ? pct(s.cost / s.total * 100) : '—'}</div><div class="label">${t('home.foodCost')}</div></div>
    </div>
    ${Object.keys(byChannel).length > 1 ? html`<div class="chips" style="margin-top:12px">${Object.entries(byChannel).map(([c, v]) =>
      html`<span class="chip" style="cursor:default;display:inline-flex;align-items:center">${c}<span class="count">${money(v, { cents: false })}</span></span>`)}</div>` : ''}
    <section class="section">
      <div class="section-head"><h2>${t('sales.byDish')}</h2></div>
      <div class="card">${Object.keys(byItem).length ? html`<ul class="list">${Object.entries(byItem).sort((a, b) => b[1].total - a[1].total).map(([name, b]) => html`
        <li class="row" style="min-height:52px"><span class="grow"><div class="title">${name}</div></span>
          <span class="muted tabular">×${b.qty}</span><span class="value" style="min-width:90px">${money(b.total)}</span></li>`)}</ul>`
        : emptyState('receipt', t('sales.noneTitle'), state.boot.menu.length ? t('sales.noneText') : t('sales.noMenuText'))}</div>
    </section>
    ${s.rows.length ? html`<section class="section">
      <div class="section-head"><h2>${t('sales.entries')}</h2><span class="small muted">${t('sales.nSaved', { n: Object.keys(batches).length })}</span></div>
      <div class="card"><ul class="list">${Object.values(batches).map((rows) => {
        const r0 = rows[0];
        const total = rows.filter((r) => !r.voided).reduce((a, r) => a + r.total, 0);
        const allVoid = rows.every((r) => r.voided);
        return html`<li><button class="row ${allVoid ? 'voided' : ''}" data-batch="${r0.createdAt + '|' + r0.createdBy + '|' + r0.channel}">
          <span class="avatar">${icon('receipt')}</span>
          <span class="grow"><div class="title">${r0.channel || t('nav.sales')} · ${t('sales.nDishes', { n: rows.length })}</div>
            <div class="sub">${r0.createdBy} · ${timeOf(r0.createdAt)}${allVoid ? ' · ' + t('common.voided') : ''}</div></span>
          <span class="value">${money(total)}</span>${icon('chevR', 'chev')}</button></li>`;
      })}</ul></div>
    </section>` : ''}`);
  $$('[data-batch]').forEach((b) => b.addEventListener('click', () => batchSheet(ctx, batches[b.dataset.batch])));

  if (openNew) entrySheet(ctx);
}

function batchSheet(ctx, rows) {
  const canVoid = ctx.can('manager');
  openSheet({
    title: `${rows[0].channel || t('nav.sales')} · ${relDay(rows[0].date)}`,
    body: html`<p class="small muted" style="margin:0 2px 10px">${t('sales.enteredBy', { who: rows[0].createdBy, time: timeOf(rows[0].createdAt) })}
      ${canVoid ? t('sales.voidHelp') : t('sales.askManager')}</p>
      <div class="card"><ul class="list">${rows.map((r) => html`<li class="row ${r.voided ? 'voided' : ''}">
        <span class="grow"><div class="title">${r.itemName}</div><div class="sub">${r.qty} × ${money(r.unitPrice)}${r.voided ? ' · ' + t('common.voided') : ''}</div></span>
        <span class="value">${money(r.total)}</span>
        ${canVoid && !r.voided ? html`<button class="icon-btn" data-void="${r.id}" aria-label="${t('sales.voidItem', { name: r.itemName })}">${icon('trash')}</button>` : ''}
      </li>`)}</ul></div>`,
    onMount(el, close) {
      $$('[data-void]', el).forEach((b) => b.addEventListener('click', async () => {
        const row = rows.find((r) => r.id === b.dataset.void);
        const ok = await confirmSheet({
          title: t('sales.voidTitle'),
          message: t('sales.voidMessage', { qty: row.qty, name: row.itemName, total: money(row.total) }),
          confirm: t('sales.voidConfirm'), danger: true,
        });
        if (!ok) return;
        await busy(b, async () => {
          await call('sales.void', { id: row.id });
          close();
          toast(t('sales.voided'));
          await ctx.refresh();
          render(ctx);
        });
      }));
    },
  });
}

function entrySheet(ctx) {
  const boot = ctx.state.boot;
  const menu = boot.menu.filter((m) => m.active);
  if (!menu.length) return toast(t('sales.noMenuText'), 'bad');
  const channels = list(boot.settings.salesChannels);
  const cats = {};
  menu.forEach((m) => (cats[m.category || t('common.other')] ||= []).push(m));
  const qtys = {};

  openSheet({
    title: t('sales.add'),
    body: html`<form id="f" novalidate>
      <div class="form-row">
        <label class="field"><span class="label">${t('common.date')}</span><input class="input" type="date" name="date" value="${day}" max="${today()}"></label>
        <label class="field"><span class="label">${t('sales.channel')}</span><select class="select" name="channel">${options(channels, channels[0])}</select></label>
      </div>
      <div class="search" style="margin:0">${icon('search')}<input class="input" type="search" id="q" placeholder="${t('sales.findDish')}" aria-label="${t('sales.findDish')}"></div>
      <div class="dish-grid">${Object.keys(cats).sort().map((c) => html`<div data-cat>
        <div class="cat-title">${c}</div>
        ${cats[c].map((m) => html`<div class="dish-row" data-dish="${m.id}" data-name="${m.name.toLowerCase()}">
          <div class="grow"><div class="title">${m.name}</div><div class="sub">${money(m.price)}${m.recipe.length ? '' : ' · ' + t('sales.noRecipe')}</div></div>
          <div class="stepper"><button type="button" data-step="-1" aria-label="${t('sales.oneLess', { name: m.name })}">${icon('minus')}</button>
            <input type="number" inputmode="numeric" min="0" step="1" value="" placeholder="0" aria-label="${t('sales.qtyOf', { name: m.name })}">
            <button type="button" data-step="1" aria-label="${t('sales.oneMore', { name: m.name })}">${icon('plus')}</button></div>
        </div>`)}</div>`)}</div>
      <p class="small muted" style="margin:14px 2px 0">${t('sales.deductNote')}</p>
    </form>`,
    foot: html`<div class="grow" style="align-self:center"><div class="small muted" id="count">${t('sales.nItems', { n: 0 })}</div><b class="tabular" id="total" style="font-size:18px">${money(0)}</b></div>
      <button class="btn primary" id="save">${t('sales.save')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      const update = () => {
        let total = 0, count = 0;
        Object.entries(qtys).forEach(([id, q]) => { const m = menu.find((x) => x.id === id); total += q * m.price; count += q; });
        el.querySelector('#total').textContent = money(total);
        el.querySelector('#count').textContent = t('sales.nItems', { n: count });
      };
      $$('[data-dish]', el).forEach((row) => {
        const input = row.querySelector('input');
        const set = (v) => {
          v = Math.max(0, Math.floor(Number(v) || 0));
          if (v) qtys[row.dataset.dish] = v; else delete qtys[row.dataset.dish];
          input.value = v || '';
          row.querySelector('.stepper').classList.toggle('has-value', !!v);
          update();
        };
        row.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => set((Number(input.value) || 0) + Number(b.dataset.step))));
        input.addEventListener('input', () => set(input.value));
      });
      el.querySelector('#q').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        $$('[data-dish]', el).forEach((r) => r.classList.toggle('hidden', !!q && !r.dataset.name.includes(q)));
        $$('[data-cat]', el).forEach((c) => c.classList.toggle('hidden', !c.querySelector('[data-dish]:not(.hidden)')));
      });
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const lines = Object.entries(qtys).map(([menuItemId, qty]) => ({ menuItemId, qty }));
        const r = await call('sales.add', { date: form.date.value, channel: form.channel.value, lines });
        close();
        day = form.date.value;
        toast(t('sales.savedToast', { total: money(r.total) }));
        if (r.noRecipe.length) setTimeout(() => toast(t('sales.noRecipeWarn', { names: r.noRecipe.join(', ') }), 'info', 6000), 400);
        await ctx.refresh();
        render(ctx);
      }, form));
    },
  });
}
