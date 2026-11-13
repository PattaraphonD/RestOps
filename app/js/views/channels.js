// Sales channels: dine-in, takeaway and delivery apps, each with its commission and packaging cost.
import { call } from '../api.js';
import { html, raw, mount, icon, money, number, $$, openSheet, toast, busy, emptyState } from '../ui.js';
import { t, defaults } from '../i18n.js';

const TYPES = ['dineIn', 'takeaway', 'delivery', 'other'];
const TYPE_ICON = { dineIn: 'fork', takeaway: 'box', delivery: 'truck', other: 'grid' };

export const channelIcon = (type) => TYPE_ICON[type] || 'grid';
export const typeLabel = (type) => t(`channels.type.${TYPES.includes(type) ? type : 'other'}`);
const summary = (c) => t('channels.summary', { pct: `${number(c.commissionPct, 1)}%`, pack: money(c.packagingCost) });

export function renderChannels(ctx) {
  const { el, setTitle, setActions, state, can } = ctx;
  setTitle(t('channels.title'), { back: true });
  if (!can('manager')) { mount(el, emptyState('settings', t('channels.managersOnly'), t('channels.managersOnlyText'))); return; }
  setActions(html`<button class="icon-btn" id="new" aria-label="${t('channels.new')}">${icon('plus')}</button>`)
    .querySelector('#new').addEventListener('click', () => channelSheet(ctx));
  const rows = state.boot.channels.slice();
  const active = rows.filter((c) => c.active);
  mount(el, html`
    <p class="small muted" style="margin:4px 4px 12px">${t('channels.help')}</p>
    <div class="card"><ul class="list">${rows.map((c) => {
      const pos = active.indexOf(c);
      return html`<li class="row" style="${c.active ? '' : 'opacity:.55'};gap:6px">
        <button class="row grow" data-id="${c.id}" style="padding:0;min-height:56px;border:0;background:none">
          <span class="avatar brand">${icon(channelIcon(c.type))}</span>
          <span class="grow"><div class="title">${c.name}${c.active ? '' : html` <span class="pill">${t('channels.off')}</span>`}</div>
            <div class="sub">${typeLabel(c.type)} · ${summary(c)}</div></span></button>
        ${c.active ? html`<button class="icon-btn" data-move="-1" data-for="${c.id}" aria-label="${t('channels.moveUp', { name: c.name })}" ${pos === 0 ? raw('disabled') : ''}>${icon('chevL')}</button>
          <button class="icon-btn" data-move="1" data-for="${c.id}" aria-label="${t('channels.moveDown', { name: c.name })}" ${pos === active.length - 1 ? raw('disabled') : ''}>${icon('chevR')}</button>` : ''}
      </li>`;
    })}</ul></div>`);
  $$('[data-id]', el).forEach((b) => b.addEventListener('click', () => channelSheet(ctx, rows.find((c) => c.id === b.dataset.id))));
  $$('[data-move]', el).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const i = active.findIndex((c) => c.id === b.dataset.for);
    const j = i + Number(b.dataset.move);
    if (j < 0 || j >= active.length) return;
    const order = active.slice();
    [order[i], order[j]] = [order[j], order[i]];
    // Save the new positions of the two channels that swapped.
    for (const k of [i, j]) {
      const c = order[k];
      await call('channels.save', { item: { ...c, sortOrder: k } });
    }
    await ctx.refresh();
    renderChannels(ctx);
  })));
}

export function channelSheet(ctx, item) {
  const isNew = !item;
  item = item || { type: 'delivery', commissionPct: 0, packagingCost: 0, commissionOnDiscounted: true, active: true };
  const presets = defaults('channelPresets');
  let fromPreset = null; // the preset whose rate must be confirmed

  openSheet({
    title: isNew ? t('channels.new') : t('channels.edit'),
    body: html`<form id="f" novalidate>
      ${isNew ? html`<div class="section-head" style="margin-top:0"><h2 style="font-size:15px">${t('channels.presetTitle')}</h2></div>
        <div class="chips" role="group" aria-label="${t('channels.presetTitle')}" style="margin-bottom:12px">
          ${presets.map((p, i) => html`<button type="button" class="chip" data-preset="${i}" aria-pressed="false">${p.name}</button>`)}
          <button type="button" class="chip" data-preset="custom" aria-pressed="true">${t('channels.custom')}</button>
        </div>` : ''}
      <label class="field"><span class="label">${t('common.name')}</span><input class="input" name="name" value="${item.name || ''}" maxlength="40"></label>
      <div class="field"><span class="label" id="type-l">${t('channels.type')}</span>
        <div class="seg" role="group" aria-labelledby="type-l">${TYPES.map((ty) =>
          html`<button type="button" data-type="${ty}" aria-pressed="${item.type === ty}">${typeLabel(ty)}</button>`)}</div></div>
      <div class="form-row">
        <label class="field"><span class="label">${t('channels.commission')}</span>
          <div class="input-group"><input class="input" name="commissionPct" type="number" inputmode="decimal" min="0" max="99.9" step="any" value="${item.commissionPct}"><span class="addon">%</span></div></label>
        <label class="field"><span class="label">${t('channels.packaging')}</span>
          <input class="input" name="packagingCost" type="number" inputmode="decimal" min="0" step="any" value="${item.packagingCost}"></label>
      </div>
      <div id="rate-note" hidden>
        <p class="small" style="margin:-6px 2px 8px;color:var(--warn-ink)">${icon('alert')} ${t('channels.typicalRate')}</p>
        <label class="check"><input type="checkbox" name="confirmRate"> ${t('channels.confirmRate')}</label>
      </div>
      <label class="check"><input type="checkbox" name="commissionOnDiscounted" ${item.commissionOnDiscounted ? raw('checked') : ''}> ${t('channels.onDiscounted')}</label>
      <p class="small muted" style="margin:-4px 2px 12px">${t('channels.onDiscountedHelp')}</p>
      ${isNew ? '' : html`<label class="check"><input type="checkbox" name="active" ${item.active ? raw('checked') : ''}> ${t('channels.active')}</label>`}
    </form>`,
    foot: html`<button class="btn primary block" id="save">${isNew ? t('channels.add') : t('common.saveChanges')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      let type = item.type;
      const setType = (ty) => {
        type = ty;
        $$('[data-type]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === ty)));
      };
      $$('[data-type]', el).forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
      const note = el.querySelector('#rate-note');
      const syncNote = () => {
        const unchanged = fromPreset && Number(form.commissionPct.value) === Number(fromPreset.commissionPct);
        note.hidden = !unchanged;
        if (!unchanged) form.confirmRate.checked = false;
      };
      form.commissionPct.addEventListener('input', syncNote);
      $$('[data-preset]', el).forEach((b) => b.addEventListener('click', () => {
        $$('[data-preset]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        if (b.dataset.preset === 'custom') { fromPreset = null; syncNote(); return; }
        fromPreset = presets[Number(b.dataset.preset)];
        form.name.value = fromPreset.name;
        form.commissionPct.value = fromPreset.commissionPct;
        setType(fromPreset.type);
        if (!Number(form.packagingCost.value)) form.packagingCost.focus();
        syncNote();
      }));
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        if (!note.hidden && !form.confirmRate.checked) throw new Error(t('channels.confirmFirst'));
        const payload = {
          id: item.id, version: item.version, name: form.name.value, type,
          commissionPct: form.commissionPct.value, packagingCost: form.packagingCost.value,
          commissionOnDiscounted: form.commissionOnDiscounted.checked,
          active: isNew ? true : form.active.checked,
        };
        if (!isNew) payload.sortOrder = item.sortOrder;
        try { await call('channels.save', { item: payload }); }
        catch (err) { if (err.code === 'CONFLICT') await ctx.refresh(); throw err; }
        close();
        toast(isNew ? t('channels.added') : t('channels.saved'));
        await ctx.refresh();
        renderChannels(ctx);
      }, form));
    },
  });
}
