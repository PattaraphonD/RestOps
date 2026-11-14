// Managed categories for ingredients, dishes and expenses: the "หมวดหมู่" page under More, and the category
// picker used by the ingredient, dish and expense forms (with "+ add a category" for managers).
import { call } from '../api.js';
import { html, mount, icon, $$, openSheet, toast, busy, emptyState } from '../ui.js';
import { t } from '../i18n.js';

export const TYPES = ['ingredient', 'menu', 'expense'];
const NEW = '__new';
let pageType = 'ingredient';

const ofType = (boot, type) => (boot.categories || []).filter((c) => c.type === type);

/** <select name="categoryId"> with this list's active categories (and the item's current one, even if retired). */
export function categoryField(ctx, type, selectedId, { required = false } = {}) {
  const list = ofType(ctx.state.boot, type).filter((c) => c.active || c.id === selectedId);
  return html`<label class="field"><span class="label">${t('common.category')}</span>
    <select class="select" name="categoryId" data-cat-type="${type}" ${required ? 'required' : ''}>
      <option value="">${required ? t('common.choose') : t('common.none')}</option>
      ${list.map((c) => html`<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.name}${c.active ? '' : ` (${t('cat.retired')})`}</option>`)}
      ${ctx.can('manager') ? html`<option value="${NEW}">${t('cat.addInline')}</option>` : ''}
    </select></label>`;
}

/** Makes "+ add a category" in a picker open a small form, then selects the new category. */
export function wireCategoryField(ctx, root) {
  $$('select[data-cat-type]', root).forEach((sel) => {
    let last = sel.value === NEW ? '' : sel.value;
    sel.addEventListener('change', () => {
      if (sel.value !== NEW) { last = sel.value; return; }
      sel.value = last;
      editSheet(ctx, { type: sel.dataset.catType }, (saved) => {
        const opt = document.createElement('option');
        opt.value = saved.id; opt.textContent = saved.name;
        sel.insertBefore(opt, sel.querySelector(`option[value="${NEW}"]`));
        sel.value = saved.id; last = saved.id;
      });
    });
  });
}

function editSheet(ctx, item, done) {
  const isNew = !item.id;
  openSheet({
    title: isNew ? t('cat.new', { list: t(`cat.type.${item.type}`) }) : t('cat.edit'),
    body: html`<form id="cf" novalidate>
      <label class="field"><span class="label">${t('cat.name')}</span>
        <input class="input" name="name" maxlength="60" value="${item.name || ''}" required></label>
      ${!isNew && item.type !== 'expense' && item.inUse ? html`<p class="small muted" style="margin:-4px 2px 12px">${t('cat.renameNote', { n: item.inUse })}</p>` : ''}
      ${!isNew && item.type === 'expense' ? html`<p class="small muted" style="margin:-4px 2px 12px">${t('cat.expenseNote')}</p>` : ''}
    </form>`,
    foot: html`${!isNew ? html`<button class="btn" id="retire">${item.active ? t('cat.retire') : t('cat.restore')}</button>` : ''}
      <button class="btn primary" id="save">${t('common.save')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#cf');
      form.name.focus();
      const save = (extra) => busy(el.querySelector('#save'), async () => {
        const saved = await call('categories.save', { item: Object.assign({ id: item.id, version: item.version, type: item.type, name: form.name.value }, extra) });
        close();
        toast(t('cat.saved', { name: saved.name }));
        await ctx.refresh();
        done && done(saved);
      }, form);
      el.querySelector('#save').addEventListener('click', () => save({}));
      form.addEventListener('submit', (e) => { e.preventDefault(); save({}); });
      const retire = el.querySelector('#retire');
      if (retire) retire.addEventListener('click', () => {
        if (!item.active) return save({ active: true });
        busy(retire, async () => {
          await call('categories.retire', { id: item.id });
          close();
          toast(t('cat.retiredToast', { name: item.name }));
          await ctx.refresh();
          done && done(null);
        }, form);
      });
    },
  });
}

/** More → หมวดหมู่ */
export function renderCategories(ctx) {
  const { el, setTitle, setActions, state, can } = ctx;
  setTitle(t('cat.title'), { back: true });
  if (!can('manager')) { mount(el, emptyState('settings', t('more.ownersOnly'), '')); return; }
  setActions(html`<button class="icon-btn" id="new-cat" aria-label="${t('cat.add')}">${icon('plus')}</button>`)
    .querySelector('#new-cat').addEventListener('click', () => editSheet(ctx, { type: pageType }, () => renderCategories(ctx)));
  const rows = ofType(state.boot, pageType);
  const live = rows.filter((c) => c.active);
  mount(el, html`
    <div class="seg" role="group" aria-label="${t('cat.title')}" style="margin-top:4px">
      ${TYPES.map((k) => html`<button aria-pressed="${pageType === k}" data-type="${k}">${t(`cat.type.${k}`)}</button>`)}</div>
    <p class="small muted" style="margin:0 4px 10px">${t(`cat.help.${pageType}`)}</p>
    <div class="card">${rows.length ? html`<ul class="list">${rows.map((c) => {
      const i = live.indexOf(c);
      return html`<li class="row cat-row${c.active ? '' : ' retired'}">
        <button class="grow cat-name" data-edit="${c.id}"><div class="title">${c.name}</div>
          <div class="sub">${c.active ? t(pageType === 'expense' ? 'cat.usedExpense' : 'cat.used', { n: c.inUse }) : t('cat.retired')}</div></button>
        ${c.active ? html`<button class="icon-btn" data-move="-1" data-id="${c.id}" ${i <= 0 ? 'disabled' : ''} aria-label="${t('cat.up')}">${icon('arrowUp')}</button>
          <button class="icon-btn" data-move="1" data-id="${c.id}" ${i >= live.length - 1 ? 'disabled' : ''} aria-label="${t('cat.down')}">${icon('arrowDown')}</button>` : ''}
      </li>`;
    })}</ul>` : emptyState('grid', t('cat.emptyTitle'), t('cat.emptyText'))}</div>`);
  $$('[data-type]', el).forEach((b) => b.addEventListener('click', () => { pageType = b.dataset.type; renderCategories(ctx); }));
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => editSheet(ctx, rows.find((c) => c.id === b.dataset.edit), () => renderCategories(ctx))));
  $$('[data-move]', el).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const ids = live.map((c) => c.id);
    const from = ids.indexOf(b.dataset.id), to = from + Number(b.dataset.move);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await call('categories.reorder', { type: pageType, ids: ids.concat(rows.filter((c) => !c.active).map((c) => c.id)) });
    await ctx.refresh();
    renderCategories(ctx);
  })));
}
