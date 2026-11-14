// Menu profit board: every dish on every channel on one screen — price, cost, food cost % against
// target, and per channel the real profit (after running costs) over the margin before running costs.
import { call } from '../api.js';
import { html, mount, icon, money, pct, number, today, $$, emptyState, foodCostPill } from '../ui.js';
import { t } from '../i18n.js';
import { target, rounding } from './pricing-view.js';

const P = () => window.RestoPricing;
const ui = { filter: 'all', sort: 'name' };

const signed = (v) => {
  const r = Math.round(v);
  return (r > 0 ? '+' : r < 0 ? '−' : '') + number(Math.abs(r), 0);
};
const channelSub = (c) => [c.commissionPct ? t('pb.gp', { pct: number(c.commissionPct, 1) }) : '',
  c.packagingCost ? t('pb.box', { amount: money(c.packagingCost, { cents: false }) }) : ''].filter(Boolean).join(' · ') || t('pb.noFees');

export async function renderBoard(ctx, host, { openDish, openChannel } = {}) {
  const boot = ctx.state.boot;
  const channels = (boot.channels || []).filter((c) => c.active).sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
  mount(host, html`<div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:320px;margin-top:12px"></div>`);
  const oh = await call('costs.overhead', { today: today() }).catch(() => ({ perDish: null }));
  if (ctx.stale() || !host.isConnected) return;

  const dishes = boot.menu.filter((m) => m.active);
  const board = P().profitBoard({
    dishes: dishes.map((m) => ({ id: m.id, price: m.price, foodCost: m.foodCost, prices: m.prices || {}, hasRecipe: (m.recipe || []).length > 0 })),
    channels: channels.map((c) => ({ id: c.id, commissionPct: c.commissionPct, packagingCost: c.packagingCost })),
    targetPct: target(boot), rounding: rounding(boot), overheadPerDish: oh.perDish,
  });
  const dishOf = Object.fromEntries(dishes.map((m) => [m.id, m]));
  const tgt = target(boot);
  const hasReal = board.overheadPerDish !== null;

  // A filter whose chip isn't shown (no running costs yet, or no dish without a recipe) falls back to all.
  if ((ui.filter === 'loss' && !hasReal) || (ui.filter === 'noRecipe' && !board.counts.noRecipe)) ui.filter = 'all';
  if (ui.sort === 'profit' && !hasReal) ui.sort = 'name';
  const draw = () => {
    let rows = board.rows.slice();
    if (ui.filter === 'loss') rows = rows.filter((r) => r.loss);
    else if (ui.filter === 'overTarget') rows = rows.filter((r) => r.overTarget);
    else if (ui.filter === 'noRecipe') rows = rows.filter((r) => r.noRecipe);
    const name = (r) => dishOf[r.id].name;
    const cat = (r) => dishOf[r.id].category || '';
    if (ui.sort === 'foodCost') rows.sort((a, b) => (b.foodCostPct ?? -1) - (a.foodCostPct ?? -1));
    else if (ui.sort === 'profit') rows.sort((a, b) => (a.worstReal ?? Infinity) - (b.worstReal ?? Infinity));
    else rows.sort((a, b) => cat(a).localeCompare(cat(b), 'th') || name(a).localeCompare(name(b), 'th'));

    const chip = (key, label, n, dot) => html`<button class="chip pb-chip" data-f="${key}" aria-pressed="${ui.filter === key}">
      ${dot ? html`<i class="pb-dot ${dot}"></i>` : ''}${label}<b>${n}</b></button>`;
    const cell = (r, c) => {
      const x = r.cells[c.id];
      if (!x) return html`<span class="muted">—</span>`;
      const top = hasReal ? x.realProfit : x.cm;
      return html`<div class="pb-top ${Math.round(top) < 0 ? 'neg' : ''}">${signed(top)}</div>
        ${hasReal ? html`<div class="pb-sub">${signed(x.cm)}</div>` : ''}
        ${x.suggested !== null ? html`<div class="pb-suggest" title="${t('pb.suggestTitle')}">${t('pb.suggest', { price: money(x.suggested, { cents: false }) })}</div>` : ''}`;
    };
    const fc = (r) => (r.noRecipe ? html`<span class="pill">${t('pb.noRecipe')}</span>` : r.foodCostPct === null ? '—'
      : html`<span class="pb-fc ${r.overTarget ? 'over' : ''}">${pct(r.foodCostPct, 0)}</span>`);

    mount(host, html`
      <div class="card pad pb-overhead">${hasReal
        ? html`<div class="grow"><div class="label">${t('pb.overhead')}</div>
            <div class="small muted">${t('pb.overheadHow', { expenses: money(oh.expenses, { cents: false }), dishes: number(oh.dishes, 0) })}</div></div>
          <div class="val">${money(board.overheadPerDish)}<span class="small muted"> / ${t('pb.perDish')}</span></div>`
        : html`<div class="grow"><div class="label">${t('pb.overhead')}</div><div class="small muted">${t('pb.overheadNone')}</div></div>`}</div>
      <div class="pb-bar">
        <div class="chips pb-chips" role="group" aria-label="${t('pb.filter')}">
          ${chip('all', t('pb.all'), board.counts.all)}
          ${hasReal ? chip('loss', t('pb.loss'), board.counts.loss, 'bad') : ''}
          ${chip('overTarget', t('pb.overTarget'), board.counts.overTarget, 'warn')}
          ${board.counts.noRecipe ? chip('noRecipe', t('pb.noRecipeF'), board.counts.noRecipe, '') : ''}
        </div>
        <label class="pb-sort"><span class="small muted">${t('pb.sort')}</span>
          <select class="select" id="pb-sort">
            <option value="name" ${ui.sort === 'name' ? 'selected' : ''}>${t('pb.sortName')}</option>
            <option value="foodCost" ${ui.sort === 'foodCost' ? 'selected' : ''}>${t('pb.sortFoodCost')}</option>
            ${hasReal ? html`<option value="profit" ${ui.sort === 'profit' ? 'selected' : ''}>${t('pb.sortProfit')}</option>` : ''}
          </select></label>
      </div>
      ${!rows.length ? html`<div class="card">${emptyState('check', t('pb.emptyTitle'), t('pb.emptyText'))}</div>` : html`
      <div class="card pb-table-wrap"><table class="pb-table">
        <thead>
          <tr class="pb-group"><th colspan="4"></th><th colspan="${channels.length}" class="pb-gh">${t('pb.profitHead')}
            <div class="pb-ghsub">${hasReal ? t('pb.profitHeadSub') : t('pb.profitHeadSubCm')}</div></th></tr>
          <tr><th class="pb-name">${t('pb.dish')}</th><th class="num">${t('pb.price')}</th><th class="num">${t('pb.cost')}</th>
            <th class="num">${t('pb.fc')}<div class="pb-thsub">${t('pb.target', { n: number(tgt, 1) })}</div></th>
            ${channels.map((c, i) => html`<th class="num pb-ch${i === 0 ? ' first' : ''}"><button class="pb-chbtn" data-ch="${c.id}">${c.name}</button>
              <div class="pb-thsub">${channelSub(c)}</div></th>`)}</tr>
        </thead>
        <tbody>${rows.map((r) => html`<tr data-dish="${r.id}" class="${r.loss ? 'loss' : ''}">
          <td class="pb-name"><button class="pb-dish">${icon('chevR', 'pb-chev')}<span><b>${dishOf[r.id].name}</b>
            <div class="pb-thsub">${dishOf[r.id].category || ''}</div></span></button></td>
          <td class="num"><b>${money(r.price, { cents: false })}</b></td>
          <td class="num muted">${r.noRecipe ? '—' : money(r.foodCost, { cents: false })}</td>
          <td class="num">${fc(r)}</td>
          ${channels.map((c, i) => html`<td class="num pb-cell${i === 0 ? ' first' : ''}">${cell(r, c)}</td>`)}
        </tr>`)}</tbody>
      </table></div>
      <div class="pb-cards">${rows.map((r) => html`<div class="card pb-card ${r.loss ? 'loss' : ''}">
        <button class="pb-card-head" data-dish="${r.id}"><span class="grow"><b>${dishOf[r.id].name}</b>
          <div class="small muted">${t('pb.cardLine', { price: money(r.price, { cents: false }), cost: r.noRecipe ? '—' : money(r.foodCost, { cents: false }) })}</div></span>
          ${r.noRecipe ? html`<span class="pill">${t('pb.noRecipe')}</span>` : foodCostPill(r.foodCostPct, tgt)}${icon('chevR', 'chev')}</button>
        ${r.noRecipe ? '' : html`<div class="pb-grid">${channels.map((c) => html`<div class="pb-mini">
          <div class="pb-mini-name">${c.name}</div>${cell(r, c)}</div>`)}</div>`}
      </div>`)}</div>`}
      <p class="small muted" style="margin:10px 4px">${hasReal ? t('pb.legend', { amount: money(board.overheadPerDish) }) : t('pb.legendCm')} ${t('pb.suggestNote', { n: number(tgt, 1) })}</p>`);

    $$('[data-f]', host).forEach((b) => b.addEventListener('click', () => { ui.filter = b.dataset.f; draw(); }));
    host.querySelector('#pb-sort')?.addEventListener('change', (e) => { ui.sort = e.target.value; draw(); });
    $$('[data-dish]', host).forEach((b) => b.addEventListener('click', () => openDish && openDish(dishOf[b.dataset.dish])));
    $$('[data-ch]', host).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openChannel && openChannel(b.dataset.ch); }));
  };
  draw();
}
