// Channel pricing: what each dish earns on each channel after commission and packaging,
// suggested prices that meet the food cost target, and a bulk "apply suggested" with a preview.
import { call } from '../api.js';
import { html, raw, mount, icon, money, pct, $$, openSheet, toast, busy, emptyState, foodCostPill } from '../ui.js';
import { t } from '../i18n.js';
import { channelIcon } from './channels.js';

const P = () => window.RestoPricing;
const ui = { channelId: null, mode: 'board' };

export const target = (boot) => Number(boot.settings.targetFoodCostPct) || 30;
export const rounding = (boot) => P().effectiveRounding(boot.settings.priceRounding, boot.settings.currency);
export const priceOn = (dish, channelId) => (dish.prices && dish.prices[channelId] !== undefined ? dish.prices[channelId] : dish.price);

/** Economics of one dish on one channel. foodCost/price may be overridden by an open editor. */
export function economics(boot, channel, { price, foodCost }) {
  return P().channelEconomics({ price, foodCost, packaging: channel.packagingCost, commissionPct: channel.commissionPct,
    targetPct: target(boot), rounding: rounding(boot) });
}

/** One line of figures under a channel price: net, margin, food cost % of net, and a verdict pill. */
export function econLine(boot, e) {
  return html`<span>${t('pricing.net', { amount: money(e.netRevenue) })} · ${t('pricing.margin', { amount: money(e.cm) })}</span>
    ${e.foodCostPctNet === null ? '' : html` · ${foodCostPill(e.foodCostPctNet, target(boot))}`}`;
}

/** Pricing tab: the profit board for all channels (default) or one channel at a time. */
export function renderPricing(ctx, host, opts = {}) {
  const boot = ctx.state.boot;
  const channels = (boot.channels || []).filter((c) => c.active);
  if (!channels.length) { mount(host, html`<div class="card">${emptyState('truck', t('pricing.noChannels'), '')}</div>`); return; }
  mount(host, html`<div class="seg" role="group" aria-label="${t('pb.view')}">
      <button aria-pressed="${ui.mode === 'board'}" data-mode="board">${t('pb.modeBoard')}</button>
      <button aria-pressed="${ui.mode === 'channel'}" data-mode="channel">${t('pb.modeChannel')}</button></div>
    <div id="pricing-body"></div>`);
  $$('[data-mode]', host).forEach((b) => b.addEventListener('click', () => { ui.mode = b.dataset.mode; renderPricing(ctx, host, opts); }));
  const body = host.querySelector('#pricing-body');
  if (ui.mode === 'board') {
    return import('./profit-board.js').then((m) => m.renderBoard(ctx, body, {
      openDish: opts.openDish,
      openChannel: (id) => { ui.channelId = id; ui.mode = 'channel'; renderPricing(ctx, host, opts); },
    }));
  }
  return renderChannelPricing(ctx, body, opts);
}

function renderChannelPricing(ctx, host, { openDish } = {}) {
  const boot = ctx.state.boot;
  const channels = (boot.channels || []).filter((c) => c.active);
  if (!channels.some((c) => c.id === ui.channelId)) ui.channelId = (channels.find((c) => c.type === 'delivery') || channels[0]).id;
  const ch = channels.find((c) => c.id === ui.channelId);
  const dishes = boot.menu.filter((m) => m.active && m.recipe.length);
  const rows = dishes.map((m) => {
    const price = priceOn(m, ch.id);
    return { m, price, own: m.prices && m.prices[ch.id] !== undefined, e: economics(boot, ch, { price, foodCost: m.foodCost }) };
  }).sort((a, b) => (a.e.meetsTarget === b.e.meetsTarget ? a.m.name.localeCompare(b.m.name) : a.e.meetsTarget ? 1 : -1));
  const below = rows.filter((r) => !r.e.meetsTarget && r.e.suggested !== null && r.e.suggested > r.price);
  const avgCm = rows.length ? rows.reduce((a, r) => a + r.e.cm, 0) / rows.length : 0;

  mount(host, html`
    <div class="chips" role="group" aria-label="${t('pricing.channel')}" style="margin-top:2px">${channels.map((c) =>
      html`<button class="chip" data-ch="${c.id}" aria-pressed="${c.id === ch.id}">${icon(channelIcon(c.type))} ${c.name}</button>`)}</div>
    <div class="card summary-strip">
      <div><div class="val">${rows.length - below.length}</div><div class="label">${t('pricing.meeting')}</div></div>
      <div><div class="val" style="${below.length ? 'color:var(--bad-ink)' : ''}">${below.length}</div><div class="label">${t('pricing.missing')}</div></div>
      <div><div class="val">${money(avgCm, { cents: false })}</div><div class="label">${t('pricing.avgMargin')}</div></div>
    </div>
    <p class="small muted" style="margin:10px 4px">${t('pricing.channelLine', { pct: pct(ch.commissionPct, 1), pack: money(ch.packagingCost) })}</p>
    ${below.length ? html`<button class="btn primary block" id="apply" style="margin-bottom:12px">${icon('check')}${t('pricing.applyAll', { channel: ch.name })}</button>`
      : rows.length ? html`<p class="small" style="margin:0 4px 12px;color:var(--good-ink)">${icon('check')} ${t('pricing.allGood', { channel: ch.name })}</p>` : ''}
    <div class="card">${rows.length ? html`<ul class="list">${rows.map((r) => html`<li>
      <button class="row" data-dish="${r.m.id}">
        <span class="grow"><div class="title">${r.m.name}</div>
          <div class="sub">${econLine(boot, r.e)}</div></span>
        <span class="value" style="text-align:right"><b class="tabular">${money(r.price)}</b>
          <div class="sub">${r.own ? t('pricing.channelPrice') : t('pricing.menuPrice')}</div>
          ${!r.e.meetsTarget && r.e.suggested !== null && r.e.suggested > r.price ? html`<div class="sub" style="color:var(--bad-ink)">${t('pricing.suggested', { price: money(r.e.suggested) })}</div>` : ''}</span>
      </button></li>`)}</ul>` : emptyState('chef', t('pricing.noDishes'), t('pricing.noDishesText'))}</div>
    <p class="small muted" style="margin:10px 4px">${t('pricing.note', { n: target(boot) })}</p>`);

  $$('[data-ch]', host).forEach((b) => b.addEventListener('click', () => { ui.channelId = b.dataset.ch; renderChannelPricing(ctx, host, { openDish }); }));
  $$('[data-dish]', host).forEach((b) => b.addEventListener('click', () => openDish && openDish(boot.menu.find((m) => m.id === b.dataset.dish))));
  const apply = host.querySelector('#apply');
  if (apply) apply.addEventListener('click', () => previewSheet(ctx, ch, below, () => renderChannelPricing(ctx, host, { openDish })));
}

export function selectChannel(id) { ui.channelId = id; ui.mode = 'channel'; }

function previewSheet(ctx, ch, rows, done) {
  const boot = ctx.state.boot;
  openSheet({
    title: t('pricing.previewTitle', { channel: ch.name }),
    body: html`<p class="small muted" style="margin:0 2px 12px">${t('pricing.previewHelp', { n: target(boot) })}</p>
      <div class="card"><ul class="list">${rows.map((r) => {
        const after = economics(boot, ch, { price: r.e.suggested, foodCost: r.m.foodCost });
        return html`<li><label class="row" style="cursor:pointer">
          <input type="checkbox" data-pick="${r.m.id}" checked aria-label="${r.m.name}" style="width:22px;height:22px">
          <span class="grow"><div class="title">${r.m.name}</div>
            <div class="sub">${t('pricing.newMargin', { amount: money(after.cm) })}${after.foodCostPctNet === null ? '' : html` · ${foodCostPill(after.foodCostPctNet, target(boot))}`}</div></span>
          <span class="value tabular">${t('pricing.oldNew', { old: money(r.price), now: money(r.e.suggested) })}</span></label></li>`;
      })}</ul></div>`,
    foot: html`<button class="btn primary block" id="go">${t('pricing.applyN', { n: rows.length })}</button>`,
    onMount(el, close) {
      const go = el.querySelector('#go');
      const picked = () => $$('[data-pick]', el).filter((x) => x.checked).map((x) => x.dataset.pick);
      $$('[data-pick]', el).forEach((x) => x.addEventListener('change', () => {
        const n = picked().length;
        go.textContent = t('pricing.applyN', { n });
        go.disabled = !n;
      }));
      go.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const ids = picked();
        const items = rows.filter((r) => ids.includes(r.m.id)).map((r) => ({ menuItemId: r.m.id, price: r.e.suggested }));
        const res = await call('menu.applyPrices', { channelId: ch.id, items });
        close();
        toast(t('pricing.applied', { n: res.count }));
        await ctx.refresh();
        done();
      }));
    },
  });
}

/**
 * "Prices by channel" rows inside the dish editor. Returns { html, wire(el, getCost, getPrice), values() }.
 * The base price and food cost come from the open form, so the rows follow every edit live.
 */
export function channelPriceEditor(boot, dish) {
  const channels = (boot.channels || []).filter((c) => c.active);
  const markup = html`<div class="section-head" style="margin-top:16px"><h2 style="font-size:15px">${t('pricing.byChannel')}</h2></div>
    <p class="small muted" style="margin:-4px 2px 10px">${t('pricing.byChannelHelp')}</p>
    <div class="card"><ul class="list">${channels.map((c) => html`<li class="ch-price" data-chrow="${c.id}" style="padding:10px 14px">
      <div style="display:flex;gap:10px;align-items:center">
        <span class="grow"><b>${c.name}</b> <span class="muted small">${pct(c.commissionPct, 0)}</span></span>
        <input class="input" style="max-width:120px" type="number" inputmode="decimal" min="0" step="any" data-chprice="${c.id}"
          value="${dish.prices && dish.prices[c.id] !== undefined ? dish.prices[c.id] : ''}" aria-label="${t('pricing.priceOn', { channel: c.name })}">
      </div>
      <div class="small muted" data-econ style="margin-top:6px">—</div>
      <div data-suggest style="margin-top:6px" hidden>
        <span class="small" style="color:var(--bad-ink)">${icon('alert')} <span data-stext></span></span>
        <button type="button" class="btn sm" data-use="${c.id}" style="margin-left:6px">${t('pricing.use')}</button></div>
    </li>`)}</ul></div>`;
  return {
    html: channels.length ? markup : raw(''),
    wire(el, getCost, getPrice) {
      const recalc = () => {
        const cost = getCost();
        channels.forEach((c) => {
          const row = el.querySelector(`[data-chrow="${c.id}"]`);
          const input = row.querySelector('[data-chprice]');
          const price = input.value === '' ? getPrice() : Number(input.value) || 0;
          input.placeholder = getPrice() ? String(getPrice()) : '';
          const e = economics(boot, c, { price, foodCost: cost });
          mount(row.querySelector('[data-econ]'), cost ? econLine(boot, e) : html`${t('pricing.noRecipe')}`);
          const show = cost > 0 && !e.meetsTarget && e.suggested !== null && e.suggested > price;
          row.querySelector('[data-suggest]').hidden = !show;
          if (show) row.querySelector('[data-stext]').textContent = t('pricing.suggested', { price: money(e.suggested) });
          row.dataset.suggested = show ? e.suggested : '';
        });
      };
      $$('[data-chprice]', el).forEach((x) => x.addEventListener('input', recalc));
      $$('[data-use]', el).forEach((b) => b.addEventListener('click', () => {
        const row = el.querySelector(`[data-chrow="${b.dataset.use}"]`);
        row.querySelector('[data-chprice]').value = row.dataset.suggested;
        recalc();
      }));
      return recalc;
    },
    values(el) {
      return channels.map((c) => ({ channelId: c.id, price: el.querySelector(`[data-chprice="${c.id}"]`).value }));
    },
  };
}
