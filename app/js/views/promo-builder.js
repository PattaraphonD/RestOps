// Promotion builder (4 steps with a live profit check) and the delivery-app offer check.
import { call } from '../api.js';
import { html, raw, mount, icon, money, pct, number, today, $$, openSheet, toast, busy } from '../ui.js';
import { t, locale } from '../i18n.js';
import { priceOn } from './pricing-view.js';

const R = () => window.RestoPricing;
export const TYPES = ['percentOff', 'amountOff', 'fixedPrice', 'bundle', 'buyXGetY'];
const VERDICT_CLS = { profitable: 'good', thin: 'warn', loss: 'bad' };
const VERDICT_ICON = { profitable: 'check', thin: 'alert', loss: 'alert' };
const RANK = { loss: 0, thin: 1, profitable: 2 };

export const target = (boot) => Number(boot.settings.targetFoodCostPct) || 30;
export const verdictPill = (v) => html`<span class="pill ${VERDICT_CLS[v] || ''}">${icon(VERDICT_ICON[v] || 'info')}${t(`promo.verdict.${v}`)}</span>`;

/** The same profit engine the server uses, on this device's menu and channel data. */
export function econFor(boot, promo, channel) {
  const menu = Object.fromEntries(boot.menu.map((m) => [m.id, m]));
  return R().promoEconomics({
    type: promo.type, value: promo.value, platformFundedPct: Number(promo.platformFundedPct) || 0,
    campaignCommissionPct: promo.campaignCommissionPct === '' || promo.campaignCommissionPct === undefined ? null : promo.campaignCommissionPct,
    targetPct: target(boot), channel,
    items: (promo.items || []).filter((i) => menu[i.menuItemId]).map((i) => {
      const d = menu[i.menuItemId];
      return { id: d.id, name: d.name, listPrice: priceOn(d, channel.id), foodCost: d.foodCost, qty: Number(i.qty) || 1 };
    }),
  });
}
export const promoChannels = (boot, promo) => {
  const all = boot.channels || [];
  return promo.channelIds && promo.channelIds.length ? all.filter((c) => promo.channelIds.includes(c.id)) : all.filter((c) => c.active);
};
/** One line describing the offer: "20 % off", "฿179 set", "Buy 2 get 1"… */
export function valueText(p) {
  if (p.type === 'percentOff') return t('promo.sum.percentOff', { n: number(p.value, 1) });
  if (p.type === 'amountOff') return t('promo.sum.amountOff', { amount: money(p.value) });
  if (p.type === 'fixedPrice') return t('promo.sum.fixedPrice', { amount: money(p.value) });
  if (p.type === 'bundle') return t('promo.sum.bundle', { amount: money(p.value) });
  const b = R().parseBxgy(p.value) || { x: '?', y: '?' };
  return t('promo.sum.buyXGetY', { x: b.x, y: b.y });
}
/** Plain-language reason for a verdict. `n` = dishes summed in `o` (amounts are shown as the average per dish). */
export function reason(o, n = 1) {
  if (!o) return '';
  const per = (v) => money(v / Math.max(1, n));
  const avg = n > 1 ? ' ' + t('promo.avgNote') : '';
  if (o.verdict === 'loss') return t('promo.reason.loss', { amount: per(-o.cmDuring) }) + avg;
  const up = o.uplift === null || o.uplift === undefined ? '' : ' ' + t('promo.reason.uplift', { pct: pct(o.uplift * 100, 0) });
  return t(`promo.reason.${o.verdict}`, { amount: per(o.cmDuring) }) + avg + up;
}
const weekdayNames = () => [...Array(7)].map((_, i) => new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(Date.UTC(2026, 10, 15 + i, 12))));

/** Per-channel profit tables (used by the builder's step 4 and the detail sheet). */
export function econTables(list) {
  return html`${list.map((c) => html`<div class="card" style="margin-bottom:12px">
    <div class="pl-row"><b>${c.channelName}</b>${c.overall ? verdictPill(c.overall.verdict) : ''}</div>
    ${c.overall ? html`<p class="small" style="margin:0 14px 8px">${reason(c.overall, c.rows.length)}</p>` : ''}
    <ul class="list">${c.rows.map((r) => html`<li class="row" style="min-height:52px">
      <span class="grow"><div class="title">${r.name}</div>
        <div class="sub">${t('promo.rowLine', { list: money(r.listPrice), paid: money(r.promoPrice), credited: money(r.credited) })}</div>
        <div class="sub">${t('promo.cmLine', { before: money(r.cmBefore), during: money(r.cmDuring) })}</div></span>
      <span class="value">${verdictPill(r.verdict)}</span></li>`)}</ul></div>`)}`;
}

export function promoBuilder(ctx, existing, { preset, onSaved } = {}) {
  const boot = ctx.state.boot;
  const st = {
    step: 1, id: existing && existing.id, version: existing && existing.version,
    type: (existing || preset || {}).type || 'percentOff',
    value: (existing || preset || {}).value ?? '',
    items: ((existing || preset || {}).items || []).map((i) => ({ menuItemId: i.menuItemId, qty: i.qty || 1 })),
    platformFundedPct: (existing || preset || {}).platformFundedPct || 0,
    campaignCommissionPct: (existing || preset || {}).campaignCommissionPct ?? '',
    channelIds: [...((existing || preset || {}).channelIds || [])],
    startDate: (existing || {}).startDate || today(), endDate: (existing || {}).endDate || '',
    weekdays: [...((existing || {}).weekdays || [])], name: (existing || {}).name || '', note: (existing || {}).note || '',
    search: '',
  };
  const dishes = boot.menu.filter((m) => m.active && m.recipe.length);
  const channels = (boot.channels || []).filter((c) => c.active);

  const results = () => promoChannels(boot, st).map((c) => {
    const e = econFor(boot, st, c);
    return { channelId: c.id, channelName: c.name, ...e };
  });
  const ready = () => st.items.length && st.value !== '' && st.value !== null;
  const worst = (list) => list.filter((c) => c.overall).sort((a, b) => RANK[a.overall.verdict] - RANK[b.overall.verdict] || a.overall.cmDuring - b.overall.cmDuring)[0];

  const sheet = openSheet({
    title: existing ? t('promo.edit') : t('promo.new'),
    body: html`<div class="small muted" id="pb-steps" style="margin:-4px 2px 10px"></div><div id="pb-body"></div>`,
    foot: html`<div id="pb-foot" style="width:100%"></div>`,
    onMount() {},
  });
  const el = sheet.el;

  function stepBody() {
    if (st.step === 1) {
      const q = st.search.trim().toLowerCase();
      return html`
        <div class="field"><span class="label" id="ty-l">${t('promo.type')}</span>
          <div class="chips" role="group" aria-labelledby="ty-l" style="flex-wrap:wrap">${TYPES.map((ty) =>
            html`<button type="button" class="chip" data-type="${ty}" aria-pressed="${st.type === ty}">${t(`promo.type.${ty}`)}</button>`)}</div>
          <span class="hint">${t(`promo.typeHelp.${st.type}`)}</span></div>
        <div class="search" style="margin:4px 0 8px">${icon('search')}<input class="input" type="search" id="pb-q" value="${st.search}" placeholder="${t('menu.search')}" aria-label="${t('menu.search')}"></div>
        <div class="card"><ul class="list">${dishes.filter((d) => !q || d.name.toLowerCase().includes(q)).map((d) => {
          const sel = st.items.find((i) => i.menuItemId === d.id);
          return html`<li class="row" style="min-height:52px">
            <label class="grow" style="display:flex;gap:10px;align-items:center;cursor:pointer">
              <input type="checkbox" data-dish="${d.id}" ${sel ? raw('checked') : ''} style="width:22px;height:22px"><span><div class="title">${d.name}</div>
              <div class="sub">${money(d.price)} · ${t('menu.costShort', { amount: money(d.foodCost) })}</div></span></label>
            ${st.type === 'bundle' && sel ? html`<input class="input" type="number" min="1" step="1" inputmode="numeric" data-qty="${d.id}" value="${sel.qty}" style="max-width:72px" aria-label="${t('promo.qtyIn', { name: d.name })}">` : ''}
          </li>`;
        })}</ul></div>`;
    }
    if (st.step === 2) {
      const label = t(`promo.valueLabel.${st.type}`);
      return html`
        <label class="field"><span class="label">${label}</span>
          ${st.type === 'buyXGetY' ? html`<input class="input" id="pb-value" value="${st.value}" placeholder="2+1" inputmode="text">`
            : html`<div class="input-group"><input class="input" id="pb-value" type="number" inputmode="decimal" min="0" step="any" value="${st.value}">
              <span class="addon">${st.type === 'percentOff' ? '%' : boot.settings.currency}</span></div>`}
          <span class="hint">${t(`promo.valueHelp.${st.type}`)}</span></label>
        <details ${Number(st.platformFundedPct) || st.campaignCommissionPct !== '' ? raw('open') : ''} style="margin-bottom:12px">
          <summary class="small" style="cursor:pointer;padding:6px 2px;font-weight:650">${t('recipe.more')}</summary>
          <label class="field"><span class="label">${t('promo.platformShare')}</span>
            <div class="input-group"><input class="input" id="pb-pf" type="number" inputmode="decimal" min="0" max="100" step="any" value="${st.platformFundedPct}"><span class="addon">%</span></div>
            <span class="hint">${t('promo.platformShareHelp')}</span></label>
          <label class="field"><span class="label">${t('promo.campaignCommission')}</span>
            <div class="input-group"><input class="input" id="pb-cc" type="number" inputmode="decimal" min="0" max="99.9" step="any" value="${st.campaignCommissionPct}" placeholder="${t('promo.sameAsChannel')}"><span class="addon">%</span></div>
            <span class="hint">${t('promo.campaignCommissionHelp')}</span></label>
        </details>`;
    }
    if (st.step === 3) {
      const days = weekdayNames();
      return html`
        <label class="field"><span class="label">${t('promo.name')}</span><input class="input" id="pb-name" value="${st.name}" maxlength="80" placeholder="${t('promo.namePlaceholder')}"></label>
        <div class="field"><span class="label" id="ch-l">${t('promo.channels')}</span>
          <div class="chips" role="group" aria-labelledby="ch-l" style="flex-wrap:wrap">${channels.map((c) =>
            html`<button type="button" class="chip" data-ch="${c.id}" aria-pressed="${!st.channelIds.length || st.channelIds.includes(c.id)}">${c.name}</button>`)}</div>
          <span class="hint">${t('promo.channelsHelp')}</span></div>
        <div class="form-row">
          <label class="field"><span class="label">${t('promo.start')}</span><input class="input" type="date" id="pb-start" value="${st.startDate}"></label>
          <label class="field"><span class="label">${t('promo.end')}</span><input class="input" type="date" id="pb-end" value="${st.endDate}"></label>
        </div>
        <div class="field"><span class="label" id="wd-l">${t('promo.weekdays')}</span>
          <div class="chips" role="group" aria-labelledby="wd-l" style="flex-wrap:wrap">${days.map((d, i) =>
            html`<button type="button" class="chip" data-wd="${i}" aria-pressed="${!st.weekdays.length || st.weekdays.includes(i)}">${d}</button>`)}</div>
          <span class="hint">${t('promo.weekdaysHelp')}</span></div>
        <label class="field"><span class="label">${t('common.note')}</span><input class="input" id="pb-note" value="${st.note}" maxlength="300"></label>`;
    }
    return ready() ? econTables(results()) : html`<p class="muted">${t('promo.pickFirst')}</p>`;
  }

  function foot() {
    const list = ready() ? results() : [];
    const w = worst(list);
    return html`
      ${st.step >= 2 && w ? html`<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px" aria-live="polite">
        ${verdictPill(w.overall.verdict)}<span class="small grow">${w.channelName}: ${reason(w.overall, w.rows.length)}</span></div>` : ''}
      <div style="display:flex;gap:10px">
        ${st.step > 1 ? html`<button type="button" class="btn" data-go="-1">${t('promo.back')}</button>` : ''}
        ${st.step < 4 ? html`<button type="button" class="btn primary" data-go="1">${t('promo.next')}</button>`
          : html`<button type="button" class="btn" data-save="draft">${t('promo.saveDraft')}</button>
            <button type="button" class="btn primary" data-save="schedule">${t('promo.schedule')}</button>`}
      </div>`;
  }

  function draw() {
    mount(el.querySelector('#pb-steps'), html`${[1, 2, 3, 4].map((n) => html`<span style="${n === st.step ? 'font-weight:700;color:var(--ink)' : ''}">${n}. ${t(`promo.step${n}`)}</span>${n < 4 ? ' › ' : ''}`)}`);
    mount(el.querySelector('#pb-body'), stepBody());
    mount(el.querySelector('#pb-foot'), foot());
    wire();
  }
  const refreshFoot = () => { mount(el.querySelector('#pb-foot'), foot()); wireFoot(); };

  function wire() {
    const body = el.querySelector('#pb-body');
    $$('[data-type]', body).forEach((b) => b.addEventListener('click', () => {
      st.type = b.dataset.type;
      if (st.type !== 'bundle') st.items.forEach((i) => { i.qty = 1; });
      st.value = '';
      draw();
    }));
    const qInput = body.querySelector('#pb-q');
    if (qInput) qInput.addEventListener('input', (e) => { st.search = e.target.value; draw(); body.querySelector('#pb-q').focus(); });
    $$('[data-dish]', body).forEach((c) => c.addEventListener('change', () => {
      if (c.checked) st.items.push({ menuItemId: c.dataset.dish, qty: 1 });
      else st.items = st.items.filter((i) => i.menuItemId !== c.dataset.dish);
      draw();
    }));
    $$('[data-qty]', body).forEach((q) => q.addEventListener('input', () => {
      const it = st.items.find((i) => i.menuItemId === q.dataset.qty);
      if (it) it.qty = Math.max(1, Math.round(Number(q.value) || 1));
      refreshFoot();
    }));
    const bind = (sel, key, asNum) => { const x = body.querySelector(sel); if (x) x.addEventListener('input', () => { st[key] = asNum && x.value !== '' ? Number(x.value) : x.value; refreshFoot(); }); };
    bind('#pb-value', 'value', st.type !== 'buyXGetY');
    bind('#pb-pf', 'platformFundedPct', true);
    bind('#pb-cc', 'campaignCommissionPct', true);
    bind('#pb-name', 'name');
    bind('#pb-note', 'note');
    bind('#pb-start', 'startDate');
    bind('#pb-end', 'endDate');
    $$('[data-ch]', body).forEach((b) => b.addEventListener('click', () => {
      const all = channels.map((c) => c.id);
      let on = st.channelIds.length ? [...st.channelIds] : [...all];
      on = on.includes(b.dataset.ch) ? on.filter((x) => x !== b.dataset.ch) : [...on, b.dataset.ch];
      st.channelIds = on.length === all.length ? [] : on;
      draw();
    }));
    $$('[data-wd]', body).forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.wd);
      let on = st.weekdays.length ? [...st.weekdays] : [0, 1, 2, 3, 4, 5, 6];
      on = on.includes(i) ? on.filter((x) => x !== i) : [...on, i].sort();
      st.weekdays = on.length === 7 ? [] : on;
      draw();
    }));
    wireFoot();
  }
  function wireFoot() {
    const f = el.querySelector('#pb-foot');
    $$('[data-go]', f).forEach((b) => b.addEventListener('click', () => {
      const next = st.step + Number(b.dataset.go);
      if (Number(b.dataset.go) > 0 && st.step === 1 && !st.items.length) return toast(t('promo.pickDish'), 'bad');
      if (Number(b.dataset.go) > 0 && st.step === 2 && (st.value === '' || st.value === null)) return toast(t('promo.enterValue'), 'bad');
      st.step = Math.min(4, Math.max(1, next));
      draw();
    }));
    $$('[data-save]', f).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      const saved = await call('promotions.save', {
        item: { id: st.id, version: st.version, name: st.name || valueText(st), type: st.type, value: st.value,
          channelIds: st.channelIds, startDate: st.startDate, endDate: st.endDate, weekdays: st.weekdays,
          platformFundedPct: st.platformFundedPct, campaignCommissionPct: st.campaignCommissionPct, note: st.note,
          draft: b.dataset.save === 'draft' },
        items: st.items,
      });
      sheet.close();
      toast(b.dataset.save === 'draft' ? t('promo.savedDraft') : t('promo.scheduled'));
      await ctx.refresh();
      if (onSaved) onSaved(saved);
    })));
  }
  draw();
}

/** "Should I join Grab's 20 % off campaign?" A focused calculator with a counter-offer. */
export function offerCheck(ctx, channelId, { onSaved } = {}) {
  const boot = ctx.state.boot;
  const delivery = (boot.channels || []).filter((c) => c.active && c.type === 'delivery');
  const pool = (boot.channels || []).filter((c) => c.active);
  const chans = delivery.length ? delivery : pool;
  const dishes = boot.menu.filter((m) => m.active && m.recipe.length);
  const st = { channelId: channelId && chans.some((c) => c.id === channelId) ? channelId : (chans[0] || {}).id,
    mode: 'percentOff', value: 20, pf: 0, cc: '', picked: dishes.map((d) => d.id) };

  openSheet({
    title: t('offer.title'),
    body: html`<form id="of" novalidate>
      <label class="field"><span class="label">${t('pricing.channel')}</span><select class="select" name="ch">${chans.map((c) =>
        html`<option value="${c.id}" ${c.id === st.channelId ? raw('selected') : ''}>${c.name} (${pct(c.commissionPct, 0)})</option>`)}</select></label>
      <div class="seg" role="group" aria-label="${t('offer.discountKind')}">
        <button type="button" data-mode="percentOff" aria-pressed="true">${t('offer.percent')}</button>
        <button type="button" data-mode="amountOff" aria-pressed="false">${t('offer.amount')}</button></div>
      <div class="form-row">
        <label class="field"><span class="label">${t('offer.discount')}</span><input class="input" name="value" type="number" inputmode="decimal" min="0" step="any" value="${st.value}"></label>
        <label class="field"><span class="label">${t('promo.platformShare')}</span><div class="input-group"><input class="input" name="pf" type="number" inputmode="decimal" min="0" max="100" step="any" value="0"><span class="addon">%</span></div></label>
      </div>
      <label class="field"><span class="label">${t('promo.campaignCommission')}</span><div class="input-group"><input class="input" name="cc" type="number" inputmode="decimal" min="0" max="99.9" step="any" placeholder="${t('promo.sameAsChannel')}"><span class="addon">%</span></div>
        <span class="hint">${t('promo.campaignCommissionHelp')}</span></label>
      <details style="margin-bottom:12px"><summary class="small" style="cursor:pointer;padding:6px 2px;font-weight:650">${t('offer.dishes', { n: dishes.length })}</summary>
        <div class="card"><ul class="list">${dishes.map((d) => html`<li class="row"><label style="display:flex;gap:10px;align-items:center;cursor:pointer">
          <input type="checkbox" data-pick="${d.id}" checked style="width:22px;height:22px"> ${d.name}</label></li>`)}</ul></div></details>
      <div id="of-out"></div>
    </form>`,
    foot: html`<button class="btn primary block" id="of-save">${t('offer.saveDraft')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#of');
      const draw = () => {
        const ch = pool.find((c) => c.id === st.channelId);
        const promo = { type: st.mode, value: st.value, platformFundedPct: st.pf, campaignCommissionPct: st.cc,
          items: st.picked.map((id) => ({ menuItemId: id, qty: 1 })) };
        const out = el.querySelector('#of-out');
        if (!ch || !st.picked.length || !(Number(st.value) > 0)) { mount(out, html`<p class="muted">${t('offer.fillIn')}</p>`); return; }
        const e = econFor(boot, promo, ch);
        const losing = e.rows.filter((r) => r.verdict === 'loss');
        const co = st.mode === 'percentOff' ? R().counterOffer({ platformFundedPct: st.pf, campaignCommissionPct: promo.campaignCommissionPct === '' ? null : promo.campaignCommissionPct,
          targetPct: target(boot), channel: ch, items: econItems(boot, promo, ch) }) : null;
        mount(out, html`
          <div class="card pad" style="margin-bottom:12px">
            <div style="display:flex;gap:8px;align-items:center">${verdictPill(e.overall.verdict)}<b class="grow">${reason(e.overall, e.rows.length)}</b></div>
            ${losing.length ? html`<p class="small" style="margin:8px 0 0;color:var(--bad-ink)">${t('offer.losing', { n: losing.length, names: losing.slice(0, 3).map((r) => r.name).join(', ') })}</p>` : ''}
          </div>
          ${co ? html`<div class="card pad" style="margin-bottom:12px;border-left:4px solid var(--brand)">
            <div class="small" style="font-weight:700;margin-bottom:6px">${icon('info')} ${t('offer.counter')}</div>
            <p style="margin:0 0 4px">${co.onTarget.maxPct === null ? t('offer.noTarget')
              : t('offer.onTarget', { pct: number(co.onTarget.maxPct, 1), n: co.onTarget.excluded.length })}</p>
            <p class="small muted" style="margin:0">${co.breakEven.maxPct === null ? t('offer.noBreakEven')
              : t('offer.breakEven', { pct: number(co.breakEven.maxPct, 1), n: co.breakEven.excluded.length })}</p></div>` : ''}
          ${econTables([{ channelName: ch.name, rows: e.rows.slice().sort((a, b) => a.cmDuring - b.cmDuring), overall: null }])}`);
      };
      $$('[data-mode]', el).forEach((b) => b.addEventListener('click', () => {
        st.mode = b.dataset.mode;
        $$('[data-mode]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        draw();
      }));
      form.ch.addEventListener('change', () => { st.channelId = form.ch.value; draw(); });
      form.value.addEventListener('input', () => { st.value = form.value.value === '' ? '' : Number(form.value.value); draw(); });
      form.pf.addEventListener('input', () => { st.pf = Number(form.pf.value) || 0; draw(); });
      form.cc.addEventListener('input', () => { st.cc = form.cc.value === '' ? '' : Number(form.cc.value); draw(); });
      $$('[data-pick]', el).forEach((c) => c.addEventListener('change', () => {
        st.picked = $$('[data-pick]', el).filter((x) => x.checked).map((x) => x.dataset.pick);
        draw();
      }));
      el.querySelector('#of-save').addEventListener('click', () => {
        close();
        promoBuilder(ctx, null, { preset: { type: st.mode, value: st.value, platformFundedPct: st.pf, campaignCommissionPct: st.cc,
          channelIds: [st.channelId], items: st.picked.map((id) => ({ menuItemId: id, qty: 1 })) }, onSaved });
      });
      draw();
    },
  });
}

function econItems(boot, promo, ch) {
  const menu = Object.fromEntries(boot.menu.map((m) => [m.id, m]));
  return promo.items.filter((i) => menu[i.menuItemId]).map((i) => {
    const d = menu[i.menuItemId];
    return { id: d.id, name: d.name, listPrice: priceOn(d, ch.id), foodCost: d.foodCost, qty: 1 };
  });
}
