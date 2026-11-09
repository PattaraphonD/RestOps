// Purchasing: purchase orders → sending to suppliers → receiving deliveries → supplier invoices
// matched three ways (ordered / received / invoiced) → approval → payment.
import { call, newRequestId } from '../api.js';
import {
  html, raw, mount, icon, money, number, qty, pct, today, addDays, relDay, fmtDate, timeOf, esc, $, $$,
  openSheet, confirmSheet, toast, busy, options, emptyState,
} from '../ui.js';
import { t, defaults } from '../i18n.js';

const ui = { tab: 'orders', poFilter: 'open', invFilter: 'review' };

const PO_PILL = { draft: '', sent: 'brand', partial: 'warn', received: 'good', closed: '', cancelled: 'bad' };
const INV_PILL = { matched: 'good', exception: 'bad', noPo: 'warn', approved: 'good', disputed: 'bad', paid: 'brand' };
const EXCEPTIONS = ['notOrdered', 'notReceived', 'overBilled', 'priceUp'];

const isLate = (po) => (po.status === 'sent' || po.status === 'partial') && po.expectedDate < today();
const poPill = (po) => html`<span class="pill ${isLate(po) ? 'warn' : PO_PILL[po.status]}">${isLate(po) ? t('po.late') : t(`po.status.${po.status}`)}</span>`;
const invPill = (inv) => html`<span class="pill ${inv.overdue ? 'bad' : INV_PILL[inv.status]}">${inv.overdue ? t('inv.overdue') : t(`inv.status.${inv.status}`)}</span>`;
/** "Today"/"Yesterday" in lower case when used inside a sentence ("deliver today"). Thai is unaffected. */
const dayInline = (d) => {
  const s = relDay(d);
  return s === t('common.today') || s === t('common.yesterday') ? s.toLowerCase() : s;
};
const infoRow = (label, value) => html`<li class="pl-row"><span>${label}</span><b style="text-align:right">${value}</b></li>`;

/* ================================================================= screen */

export async function render(ctx) {
  const { el, params, setTitle, setActions, can } = ctx;
  setTitle(t('po.title'));
  const manager = can('manager');
  if (manager) {
    setActions(html`<button class="icon-btn" id="new-po" aria-label="${t('po.new')}">${icon('plus')}</button>`)
      .querySelector('#new-po').addEventListener('click', () => poEditor(ctx));
  }
  if (!manager) ui.tab = 'orders';

  // Deep links: #/orders/new · /suggest · /receive · /po/ID · /invoices · /invoice/ID · /invoice-new
  const [action, id] = params;
  if (action) { history.replaceState(null, '', '#/orders'); ctx.params = []; }
  if (action === 'invoices') ui.tab = 'invoices';

  mount(el, html`
    <div class="actions-grid" style="margin-top:4px;grid-template-columns:repeat(${manager ? 4 : 2},1fr)">
      ${manager ? html`<button class="action-tile" data-act="suggest"><span class="avatar brand">${icon('sliders')}</span>${t('po.reorder')}</button>
        <button class="action-tile" data-act="new"><span class="avatar brand">${icon('plus')}</span>${t('po.newShort')}</button>` : ''}
      <button class="action-tile" data-act="receive"><span class="avatar brand">${icon('truck')}</span>${t('po.receive')}</button>
      ${manager ? html`<button class="action-tile" data-act="invoice"><span class="avatar brand">${icon('receipt')}</span>${t('inv.addShort')}</button>`
        : html`<a class="action-tile" href="#/stock/purchase" style="text-decoration:none"><span class="avatar brand">${icon('box')}</span>${t('po.noOrderStockIn')}</a>`}
    </div>
    ${manager ? html`<div class="seg" role="group" aria-label="${t('stock.view')}" style="margin-top:18px">
      <button aria-pressed="${ui.tab === 'orders'}" data-tab="orders">${t('po.orders')}</button>
      <button aria-pressed="${ui.tab === 'invoices'}" data-tab="invoices">${t('inv.invoices')}</button>
    </div>` : html`<div style="height:18px"></div>`}
    <div id="tab"><div class="skeleton" style="height:240px"></div></div>`);
  $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'suggest') suggestSheet(ctx);
    if (a === 'new') poEditor(ctx);
    if (a === 'receive') receivePicker(ctx);
    if (a === 'invoice') invoiceEditor(ctx, {});
  }));
  $$('[data-tab]', el).forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(ctx); }));

  if (ui.tab === 'invoices' && manager) await renderInvoices(ctx); else await renderOrders(ctx);

  if (action === 'new' && manager) poEditor(ctx);
  if (action === 'suggest' && manager) suggestSheet(ctx);
  if (action === 'receive') receivePicker(ctx);
  if (action === 'po' && id) poSheet(ctx, id);
  if (action === 'invoice' && id && manager) invoiceSheet(ctx, id);
  if (action === 'invoice-new' && manager) invoiceEditor(ctx, { poId: id });
}

/* ------------------------------------------------------------- orders list */

async function renderOrders(ctx) {
  const tab = $('#tab');
  const filters = ['open', 'awaiting', 'draft', 'done', 'all'];
  const rows = await call('po.list', { status: ui.poFilter });
  if (ctx.stale() || !tab.isConnected) return;
  mount(tab, html`
    <div class="chips" role="group" aria-label="${t('common.filter')}">${filters.map((f) =>
      html`<button class="chip" data-f="${f}" aria-pressed="${ui.poFilter === f}">${t(`po.filter.${f}`)}</button>`)}</div>
    <div class="card">${rows.length ? html`<ul class="list">${rows.map((po) => html`<li>
      <button class="row" data-po="${po.id}">
        <span class="avatar ${po.status === 'received' ? 'good' : isLate(po) ? 'warn' : 'brand'}">${icon('truck')}</span>
        <span class="grow"><div class="title">${po.supplierName || '—'}</div>
          <div class="sub">${po.poNumber} · ${po.status === 'draft' ? t('po.created', { date: dayInline(po.orderDate) }) : t('po.deliverBy', { date: dayInline(po.expectedDate) })}</div>
          ${po.status === 'partial' ? html`<div class="cost-bar" aria-hidden="true"><span style="width:${po.progress}%;background:var(--warn)"></span></div>` : ''}</span>
        <span class="value"><div>${money(po.total, { cents: false })}</div><div>${poPill(po)}</div></span>
      </button></li>`)}</ul>`
      : emptyState('truck', t('po.noneTitle'), ctx.can('manager') ? t('po.noneText') : t('po.noneStaff'))}</div>`);
  $$('[data-f]', tab).forEach((b) => b.addEventListener('click', () => { ui.poFilter = b.dataset.f; renderOrders(ctx); }));
  $$('[data-po]', tab).forEach((b) => b.addEventListener('click', () => poSheet(ctx, b.dataset.po)));
}

/* ----------------------------------------------------------- invoices list */

async function renderInvoices(ctx) {
  const tab = $('#tab');
  const filters = ['review', 'unpaid', 'disputed', 'paid', 'all'];
  const r = await call('invoices.list', { status: ui.invFilter, today: today() });
  if (ctx.stale() || !tab.isConnected) return;
  const s = r.summary;
  mount(tab, html`
    <div class="kpis" style="margin-bottom:12px">
      <div class="card kpi"><div class="label">${t('inv.unpaid')}</div><div class="val">${money(s.unpaid, { cents: false })}</div>
        <div class="delta">${t('inv.nInvoices', { n: s.unpaidCount })}</div></div>
      <div class="card kpi"><div class="label">${t('inv.overdue')}</div><div class="val" style="${s.overdue ? 'color:var(--bad-ink)' : ''}">${money(s.overdue, { cents: false })}</div>
        <div class="delta">${t('inv.dueSoon', { amount: money(s.dueSoon, { cents: false }) })}</div></div>
    </div>
    ${s.toReviewCount ? html`<button class="alert-card" data-f2="review" style="width:100%;margin-bottom:12px;text-align:left">${icon('alert')}
      <span class="grow">${t('inv.toReviewAlert', { n: s.toReviewCount })}<div class="small" style="font-weight:500;opacity:.85">${money(s.toReview)}</div></span></button>` : ''}
    <div class="chips" role="group" aria-label="${t('common.filter')}">${filters.map((f) =>
      html`<button class="chip" data-f="${f}" aria-pressed="${ui.invFilter === f}">${t(`inv.filter.${f}`)}</button>`)}</div>
    <div class="card">${r.rows.length ? html`<ul class="list">${r.rows.map((inv) => html`<li>
      <button class="row" data-inv="${inv.id}">
        <span class="avatar ${inv.status === 'exception' || inv.overdue ? 'bad' : inv.status === 'noPo' ? 'warn' : inv.status === 'paid' ? '' : 'good'}">${icon('receipt')}</span>
        <span class="grow"><div class="title">${inv.supplierName}</div>
          <div class="sub">${inv.invoiceNo}${inv.poNumber ? ' · ' + inv.poNumber : ''} · ${inv.status === 'paid' ? t('inv.paidOn', { date: relDay(inv.paidAt) }) : t('inv.due', { date: relDay(inv.dueDate) })}</div></span>
        <span class="value"><div>${money(inv.total, { cents: false })}</div><div>${invPill(inv)}</div></span>
      </button></li>`)}</ul>`
      : emptyState('receipt', t('inv.noneTitle'), t(`inv.none.${ui.invFilter}`))}</div>`);
  $$('[data-f]', tab).forEach((b) => b.addEventListener('click', () => { ui.invFilter = b.dataset.f; renderInvoices(ctx); }));
  $$('[data-f2]', tab).forEach((b) => b.addEventListener('click', () => { ui.invFilter = 'review'; renderInvoices(ctx); }));
  $$('[data-inv]', tab).forEach((b) => b.addEventListener('click', () => invoiceSheet(ctx, b.dataset.inv)));
}

/* ======================================================== purchase orders */

async function poSheet(ctx, id) {
  let po;
  try { po = await call('po.get', { id }); } catch (e) { return toast(e.message, 'bad'); }
  const manager = ctx.can('manager');
  const canReceive = ['draft', 'sent', 'partial'].includes(po.status) && (po.status !== 'draft' || manager);
  const actions = [];
  if (po.status === 'draft' && manager) actions.push(['edit', 'edit', t('po.edit')]);
  if (['sent', 'partial'].includes(po.status) && manager) actions.push(['send', 'download', t('po.sendAgain')]);
  if (manager && ['sent', 'partial', 'received', 'closed'].includes(po.status)) actions.push(['invoice', 'receipt', t('inv.addForOrder')]);
  if (manager) actions.push(['print', 'download', t('po.print')]);
  if (manager && ['sent', 'partial'].includes(po.status)) actions.push(['close', 'check', t('po.closeShort')]);
  if (manager && ['draft', 'sent'].includes(po.status)) actions.push(['cancel', 'x', t('po.cancel')]);

  openSheet({
    title: `${po.poNumber} · ${po.supplierName}`,
    body: html`
      <div style="margin:-2px 0 12px">${poPill(po)}</div>
      <div class="card summary-strip" style="margin-bottom:12px">
        <div><div class="val">${money(po.total, { cents: false })}</div><div class="label">${t('po.orderValue')}</div></div>
        <div><div class="val">${money(po.receivedValue, { cents: false })}</div><div class="label">${t('po.receivedValue')}</div></div>
        <div><div class="val">${po.progress}%</div><div class="label">${t('po.progress')}</div></div>
      </div>
      <ul class="list card" style="margin-bottom:14px">
        ${infoRow(t('po.orderDate'), relDay(po.orderDate))}
        ${infoRow(t('po.expectedDate'), relDay(po.expectedDate))}
        ${po.sentAt ? infoRow(t('po.sentBy'), `${po.sentBy} · ${relDay(po.sentAt.slice(0, 10))}`) : ''}
        ${po.note ? infoRow(t('common.note'), po.note) : ''}
        ${po.closeReason ? infoRow(t('po.closeReason'), po.closeReason) : ''}
      </ul>
      <div class="section-head"><h2 style="font-size:15px">${t('po.items')}</h2></div>
      <div class="card"><ul class="list">${po.lines.map((l) => html`<li class="row" style="min-height:56px">
        <span class="avatar ${l.qtyReceived >= l.qtyOrdered ? 'good' : l.qtyReceived > 0 ? 'warn' : ''}" style="width:32px;height:32px">${icon(l.qtyReceived >= l.qtyOrdered ? 'check' : 'box')}</span>
        <span class="grow"><div class="title">${l.name}</div>
          <div class="sub">${t('po.receivedOf', { received: number(l.qtyReceived, 3), ordered: qty(l.qtyOrdered, l.unit) })} · ${money(l.unitPrice)}/${l.unit}</div></span>
        <span class="value">${money(l.lineTotal)}</span></li>`)}</ul></div>
      ${po.receipts.length ? html`<div class="section-head" style="margin-top:16px"><h2 style="font-size:15px">${t('po.deliveries')}</h2></div>
        <div class="card"><ul class="list">${po.receipts.map((r) => html`<li class="row ${r.voided ? 'voided' : ''}" style="min-height:52px">
          <span class="grow"><div class="title">${r.ingredientName}</div><div class="sub">${relDay(r.date)} · ${r.createdBy}${r.invoiceRef ? ' · ' + r.invoiceRef : ''}</div></span>
          <span class="value">+${qty(r.qty, r.unit)}</span></li>`)}</ul></div>` : ''}
      ${po.invoices.length ? html`<div class="section-head" style="margin-top:16px"><h2 style="font-size:15px">${t('inv.invoices')}</h2></div>
        <div class="card"><ul class="list">${po.invoices.map((i) => html`<li><button class="row" data-inv="${i.id}">
          <span class="grow"><div class="title">${i.invoiceNo}</div><div class="sub">${relDay(i.invoiceDate)}</div></span>
          <span class="value"><div>${money(i.total)}</div><div>${invPill(i)}</div></span></button></li>`)}</ul></div>` : ''}
      ${actions.length ? html`<div class="card" style="margin-top:16px"><ul class="list">${actions.map(([k, ic, label]) => html`<li>
        <button class="row" data-po-act="${k}" style="min-height:52px"><span class="avatar ${k === 'cancel' ? 'bad' : ''}" style="width:32px;height:32px">${icon(ic)}</span>
          <span class="grow title">${label}</span>${icon('chevR', 'chev')}</button></li>`)}</ul></div>` : ''}`,
    foot: po.status === 'draft' && manager
      ? html`<button class="btn primary block" data-po-act="sendNow">${icon('download')}${t('po.sendToSupplier')}</button>`
      : canReceive ? html`<button class="btn primary block" data-po-act="receive">${icon('truck')}${t('po.receiveDelivery')}</button>` : null,
    onMount(el, close) {
      $$('[data-inv]', el).forEach((b) => b.addEventListener('click', () => { close(); invoiceSheet(ctx, b.dataset.inv); }));
      $$('[data-po-act]', el).forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.poAct;
        if (a === 'edit') { close(); poEditor(ctx, po); }
        if (a === 'sendNow' || a === 'send') { close(); sendSheet(ctx, po); }
        if (a === 'receive') { close(); receiveSheet(ctx, po); }
        if (a === 'invoice') { close(); invoiceEditor(ctx, { poId: po.id, supplierId: po.supplierId }); }
        if (a === 'print') printPo(ctx, po);
        if (a === 'close' || a === 'cancel') {
          const reason = await promptSheet({
            title: a === 'close' ? t('po.closeTitle') : t('po.cancelTitle'),
            message: a === 'close' ? t('po.closeMessage') : t('po.cancelMessage'),
            label: t('po.reason'), confirm: a === 'close' ? t('po.closeShort') : t('po.cancel'), danger: a === 'cancel', required: false,
          });
          if (reason === null) return;
          await busy(b, async () => {
            await call(a === 'close' ? 'po.close' : 'po.cancel', { id: po.id, reason });
            close();
            toast(a === 'close' ? t('po.closed') : t('po.cancelled'));
            await ctx.refresh();
            render(ctx);
          });
        }
      }));
    },
  });
}

/* --------------------------------------------------------- PO editor */

function poEditor(ctx, existing, preset) {
  const boot = ctx.state.boot;
  const suppliers = boot.suppliers.filter((s) => s.active || (existing && s.id === existing.supplierId));
  if (!suppliers.length) return toast(t('po.needSupplier'), 'bad');
  const item = existing || { supplierId: preset?.supplierId || '', orderDate: today(), expectedDate: '', note: '', lines: preset?.lines || [] };
  const ings = boot.ingredients.filter((i) => i.active);
  const rid = newRequestId();
  const leadOf = (sid) => (suppliers.find((s) => s.id === sid) || {}).leadTimeDays ?? 1; // 0 = same-day delivery

  const ingOptions = (supplierId, selected) => {
    const mine = ings.filter((i) => i.supplierId === supplierId);
    const others = ings.filter((i) => i.supplierId !== supplierId);
    const opt = (i) => html`<option value="${i.id}" ${i.id === selected ? raw('selected') : ''}>${i.name} (${i.unit})</option>`;
    return html`<option value="">${t('stock.chooseIngredient')}</option>
      ${mine.length ? html`<optgroup label="${t('po.fromThisSupplier')}">${mine.map(opt)}</optgroup>` : ''}
      <optgroup label="${t('po.otherItems')}">${others.map(opt)}</optgroup>`;
  };
  const lineHtml = (supplierId, l = {}) => {
    const ing = ings.find((i) => i.id === l.ingredientId);
    return html`<div class="line-item" data-line>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="select" name="ingredientId" aria-label="${t('stock.ingredient')}">${ingOptions(supplierId, l.ingredientId)}</select>
        <button type="button" class="icon-btn" data-remove aria-label="${t('stock.removeItem')}">${icon('x')}</button></div>
      <div class="form-row" style="margin-top:8px">
        <label><span class="label small muted">${t('po.qtyToOrder')}</span><div class="input-group">
          <input class="input" name="qtyOrdered" type="number" inputmode="decimal" min="0" step="any" value="${l.qtyOrdered ?? ''}" placeholder="0">
          <span class="addon" data-unit>${ing ? ing.unit : t('stock.unit')}</span></div>
          <span class="hint small muted" data-stock>${ing ? t('po.stockHint', { onHand: qty(ing.onHand, ing.unit), min: number(ing.minLevel, 3) }) : ''}</span></label>
        <label><span class="label small muted">${t('stock.costPerUnit')}</span>
          <input class="input" name="unitPrice" type="number" inputmode="decimal" min="0" step="any" value="${l.unitPrice ?? (ing ? Math.round(ing.costPerUnit * 100) / 100 : '')}"></label>
      </div></div>`;
  };

  openSheet({
    title: existing ? t('po.editTitle', { no: existing.poNumber }) : t('po.new'),
    body: html`<form id="f" novalidate>
      <label class="field"><span class="label">${t('stock.supplier')}</span>
        <select class="select" name="supplierId">${options(suppliers.map((s) => ({ value: s.id, label: s.name })), item.supplierId, { placeholder: t('common.choose') })}</select></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('po.orderDate')}</span><input class="input" type="date" name="orderDate" value="${item.orderDate}"></label>
        <label class="field"><span class="label">${t('po.expectedDate')}</span><input class="input" type="date" name="expectedDate" value="${item.expectedDate || (item.supplierId ? addDays(item.orderDate, leadOf(item.supplierId)) : '')}"></label>
      </div>
      <div class="section-head" style="margin-top:4px"><h2 style="font-size:15px">${t('po.items')}</h2>
        <button type="button" class="link" id="fill-low">${t('po.addLowItems')}</button></div>
      <div id="lines">${(item.lines.length ? item.lines : [{}]).map((l) => lineHtml(item.supplierId, l))}</div>
      <button type="button" class="btn sm" id="add-line">${icon('plus')}${t('stock.addItem')}</button>
      <label class="field" style="margin-top:14px"><span class="label">${t('po.noteForSupplier')}</span>
        <textarea class="textarea" name="note" maxlength="500" placeholder="${t('common.optional')}">${item.note || ''}</textarea></label>
    </form>`,
    foot: html`<div class="grow" style="align-self:center;min-width:0"><div class="small muted">${t('common.total')}</div><b class="tabular" id="total" style="font-size:18px">${money(0)}</b></div>
      <button class="btn" id="save-draft">${t('po.saveDraft')}</button>
      <button class="btn primary" id="save-send">${t('po.saveSend')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      const host = el.querySelector('#lines');
      const sid = () => form.supplierId.value;
      const lines = () => $$('[data-line]', host).map((w) => ({
        el: w, ingredientId: w.querySelector('[name=ingredientId]').value,
        qtyOrdered: w.querySelector('[name=qtyOrdered]').value, unitPrice: w.querySelector('[name=unitPrice]').value,
      }));
      const recalc = () => {
        el.querySelector('#total').textContent = money(lines().reduce((a, l) => a + (Number(l.qtyOrdered) || 0) * (Number(l.unitPrice) || 0), 0));
      };
      const wire = (w) => {
        w.querySelector('[data-remove]').addEventListener('click', () => {
          if ($$('[data-line]', host).length > 1) w.remove(); else w.querySelectorAll('input, select').forEach((x) => { x.value = ''; });
          recalc();
        });
        w.querySelector('select').addEventListener('change', (e) => {
          const ing = ings.find((i) => i.id === e.target.value);
          w.querySelector('[data-unit]').textContent = ing ? ing.unit : t('stock.unit');
          w.querySelector('[data-stock]').textContent = ing ? t('po.stockHint', { onHand: qty(ing.onHand, ing.unit), min: number(ing.minLevel, 3) }) : '';
          if (ing) w.querySelector('[name=unitPrice]').value = Math.round(ing.costPerUnit * 100) / 100;
          recalc();
        });
      };
      const addLine = (l) => {
        const tmp = document.createElement('div');
        mount(tmp, lineHtml(sid(), l));
        const w = tmp.firstElementChild;
        host.append(w);
        wire(w);
        return w;
      };
      $$('[data-line]', host).forEach(wire);
      host.addEventListener('input', recalc);
      recalc();
      form.supplierId.addEventListener('change', () => {
        form.expectedDate.value = sid() ? addDays(form.orderDate.value || today(), leadOf(sid())) : '';
        // Re-group the ingredient lists so this supplier's items come first.
        $$('[data-line]', host).forEach((w) => {
          const sel = w.querySelector('select');
          const v = sel.value;
          mount(sel, ingOptions(sid(), v));
        });
      });
      el.querySelector('#add-line').addEventListener('click', () => addLine().querySelector('select').focus());
      el.querySelector('#fill-low').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        if (!sid()) throw new Error(t('po.chooseSupplierFirst'));
        const groups = await call('po.suggestions');
        const g = groups.find((x) => x.supplierId === sid());
        if (!g) { toast(t('po.nothingLow'), 'info'); return; }
        const have = new Set(lines().map((l) => l.ingredientId));
        lines().filter((l) => !l.ingredientId && !l.qtyOrdered).forEach((l) => l.el.remove());
        g.items.filter((i) => !have.has(i.ingredientId)).forEach((i) => addLine({ ingredientId: i.ingredientId, qtyOrdered: i.suggestedQty, unitPrice: i.unitPrice }));
        recalc();
      }, form));
      const save = (send) => async (e) => busy(e.currentTarget, async () => {
        const payload = {
          item: { id: existing?.id, version: existing?.version, supplierId: sid(), orderDate: form.orderDate.value,
            expectedDate: form.expectedDate.value, note: form.note.value },
          lines: lines().filter((l) => l.ingredientId || l.qtyOrdered).map(({ ingredientId, qtyOrdered, unitPrice }) => ({ ingredientId, qtyOrdered, unitPrice })),
          send,
        };
        let po;
        try { po = await call('po.save', payload, { requestId: rid + (send ? 's' : 'd') }); } catch (err) {
          if (err.code === 'CONFLICT') await ctx.refresh();
          throw err;
        }
        close();
        toast(send ? t('po.savedSent', { no: po.poNumber }) : t('po.savedDraft', { no: po.poNumber }));
        await ctx.refresh();
        render(ctx);
        if (send) setTimeout(() => sendSheet(ctx, po, true), 350);
      }, form);
      el.querySelector('#save-draft').addEventListener('click', save(false));
      el.querySelector('#save-send').addEventListener('click', save(true));
    },
  });
}

/* ------------------------------------------------- send to supplier */

function poMessage(ctx, po) {
  const boot = ctx.state.boot;
  const lines = po.lines.map((l, i) => `${i + 1}. ${l.name} — ${number(l.qtyOrdered, 3)} ${l.unit}`);
  return [
    `${boot.settings.restaurantName}`,
    `${t('po.msgTitle')} ${po.poNumber}`,
    `${t('po.msgTo')}: ${po.supplierName}`,
    `${t('po.msgDeliver')}: ${fmtDate(po.expectedDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`,
    '',
    ...lines,
    '',
    po.note ? `${t('common.note')}: ${po.note}` : '',
    t('po.msgThanks'),
    boot.user.displayName,
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').trim();
}

function sendSheet(ctx, po, justSaved) {
  const sup = ctx.state.boot.suppliers.find((s) => s.id === po.supplierId) || {};
  const text = poMessage(ctx, po);
  const enc = encodeURIComponent(text);
  const markSent = async () => {
    if (po.status !== 'draft') return;
    try { po = await call('po.send', { id: po.id }); toast(t('po.markedSent', { no: po.poNumber })); await ctx.refresh(); render(ctx); }
    catch (e) { toast(e.message, 'bad'); }
  };
  openSheet({
    title: t('po.sendTitle', { no: po.poNumber }),
    body: html`
      ${justSaved ? html`<p class="small muted" style="margin:0 2px 10px">${t('po.sendHelp')}</p>` : ''}
      <textarea class="textarea" readonly rows="9" style="font-size:14px;min-height:180px" aria-label="${t('po.message')}">${text}</textarea>
      <div class="actions-grid" style="margin-top:12px;grid-template-columns:repeat(3,1fr)">
        <button class="action-tile" data-send="line"><span class="avatar brand" style="font-weight:800;font-size:12px">LINE</span>LINE</button>
        <button class="action-tile" data-send="share"><span class="avatar brand">${icon('download')}</span>${t('po.share')}</button>
        <button class="action-tile" data-send="copy"><span class="avatar brand">${icon('clipboard')}</span>${t('po.copy')}</button>
        <button class="action-tile" data-send="email" ${sup.email ? '' : raw('disabled style="opacity:.45"')}><span class="avatar brand">${icon('receipt')}</span>${t('sup.email')}</button>
        <button class="action-tile" data-send="sms" ${sup.phone ? '' : raw('disabled style="opacity:.45"')}><span class="avatar brand">${icon('info')}</span>SMS</button>
        <button class="action-tile" data-send="print"><span class="avatar brand">${icon('download')}</span>${t('po.printShort')}</button>
      </div>
      ${po.status === 'draft' ? html`<p class="small muted" style="margin:12px 2px 0">${t('po.sendMarks')}</p>` : ''}`,
    foot: po.status === 'draft' ? html`<button class="btn block" data-send="mark">${icon('check')}${t('po.markSentOnly')}</button>` : null,
    onMount(el, close) {
      $$('[data-send]', el).forEach((b) => b.addEventListener('click', async () => {
        const how = b.dataset.send;
        if (how === 'line') window.open(`https://line.me/R/msg/text/?${enc}`, '_blank', 'noopener');
        if (how === 'email' && sup.email) location.href = `mailto:${encodeURIComponent(sup.email)}?subject=${encodeURIComponent(`${t('po.msgTitle')} ${po.poNumber}`)}&body=${enc}`;
        if (how === 'sms' && sup.phone) location.href = `sms:${encodeURIComponent(sup.phone)}?&body=${enc}`;
        if (how === 'share') {
          if (navigator.share) { try { await navigator.share({ title: `${t('po.msgTitle')} ${po.poNumber}`, text }); } catch { return; } }
          else { await copy(text); }
        }
        if (how === 'copy') await copy(text);
        if (how === 'print') printPo(ctx, po);
        await markSent();
        if (how === 'mark') close();
      }));
    },
  });
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(t('po.copied')); }
  catch { toast(t('po.copyFailed'), 'bad'); }
}

/** Printable purchase order (save as PDF from the print dialog). */
function printPo(ctx, po) {
  const boot = ctx.state.boot;
  const sup = boot.suppliers.find((s) => s.id === po.supplierId) || {};
  const w = window.open('', '_blank');
  if (!w) return toast(t('po.popupBlocked'), 'bad');
  const rows = po.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td class="r">${esc(number(l.qtyOrdered, 3))} ${esc(l.unit)}</td>
    <td class="r">${esc(money(l.unitPrice))}</td><td class="r">${esc(money(l.lineTotal))}</td></tr>`).join('');
  w.document.write(`<!doctype html><html lang="${document.documentElement.lang}"><head><meta charset="utf-8">
    <title>${esc(po.poNumber)}</title><style>
    body{font:14px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans Thai",sans-serif;color:#111;margin:32px}
    h1{font-size:22px;margin:0}.muted{color:#666}.grid{display:flex;justify-content:space-between;gap:24px;margin:20px 0}
    table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left}
    th{font-size:12px;color:#555}.r{text-align:right}tfoot td{font-weight:700;border-bottom:0}
    .sign{display:flex;gap:40px;margin-top:56px}.sign div{flex:1;border-top:1px solid #999;padding-top:6px;font-size:12px;color:#555}
    @media print{body{margin:12mm}}</style></head><body>
    <div class="grid"><div><h1>${esc(t('po.msgTitle'))}</h1><div class="muted">${esc(boot.settings.restaurantName)}</div></div>
      <div style="text-align:right"><b>${esc(po.poNumber)}</b><br>${esc(t('po.orderDate'))}: ${esc(fmtDate(po.orderDate, { day: 'numeric', month: 'long', year: 'numeric' }))}
      <br>${esc(t('po.expectedDate'))}: ${esc(fmtDate(po.expectedDate, { day: 'numeric', month: 'long', year: 'numeric' }))}</div></div>
    <div><span class="muted">${esc(t('po.msgTo'))}:</span> <b>${esc(po.supplierName)}</b>${sup.contactName ? ' · ' + esc(sup.contactName) : ''}${sup.phone ? ' · ' + esc(sup.phone) : ''}</div>
    <table><thead><tr><th>#</th><th>${esc(t('stock.item'))}</th><th class="r">${esc(t('stock.quantity'))}</th><th class="r">${esc(t('stock.unitCost'))}</th><th class="r">${esc(t('common.total'))}</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><td colspan="4" class="r">${esc(t('common.total'))}</td><td class="r">${esc(money(po.total))}</td></tr></tfoot></table>
    ${po.note ? `<p><span class="muted">${esc(t('common.note'))}:</span> ${esc(po.note)}</p>` : ''}
    <div class="sign"><div>${esc(t('po.signOrdered'))}</div><div>${esc(t('po.signSupplier'))}</div></div>
    </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

/* --------------------------------------------------------- receiving */

async function receivePicker(ctx) {
  let rows;
  try { rows = await call('po.list', { status: 'awaiting' }); } catch (e) { return toast(e.message, 'bad'); }
  rows.sort((a, b) => (a.expectedDate < b.expectedDate ? -1 : 1));
  openSheet({
    title: t('po.receiveTitle'),
    body: rows.length ? html`<p class="small muted" style="margin:0 2px 10px">${t('po.receivePick')}</p>
      <div class="card"><ul class="list">${rows.map((po) => html`<li><button class="row" data-po="${po.id}">
        <span class="avatar ${isLate(po) ? 'warn' : 'brand'}">${icon('truck')}</span>
        <span class="grow"><div class="title">${po.supplierName}</div><div class="sub">${po.poNumber} · ${t('po.deliverBy', { date: dayInline(po.expectedDate) })}</div></span>
        <span class="value">${poPill(po)}</span></button></li>`)}</ul></div>
      <button class="btn block" data-go="#/stock/purchase" style="margin-top:14px">${t('po.noOrderStockIn')}</button>`
      : html`${emptyState('truck', t('po.nothingAwaitingTitle'), t('po.nothingAwaitingText'))}
        <button class="btn block" data-go="#/stock/purchase">${t('po.noOrderStockIn')}</button>`,
    onMount(el, close) {
      // Close first, then navigate once the sheet's history entry is gone.
      el.querySelector('[data-go]')?.addEventListener('click', (e) => {
        const to = e.currentTarget.dataset.go;
        close();
        setTimeout(() => { location.hash = to; }, 300);
      });
      $$('[data-po]', el).forEach((b) => b.addEventListener('click', async () => {
        close();
        try { receiveSheet(ctx, await call('po.get', { id: b.dataset.po })); } catch (e) { toast(e.message, 'bad'); }
      }));
    },
  });
}

function receiveSheet(ctx, po) {
  const rid = newRequestId();
  openSheet({
    title: t('po.receiveFor', { no: po.poNumber }),
    body: html`<form id="f" novalidate>
      <p class="small muted" style="margin:0 2px 12px">${t('po.receiveHelp', { supplier: po.supplierName })}</p>
      <div class="form-row">
        <label class="field"><span class="label">${t('common.date')}</span><input class="input" type="date" name="date" value="${today()}" max="${today()}"></label>
        <label class="field"><span class="label">${t('po.deliveryRef')}</span><input class="input" name="deliveryRef" maxlength="60" placeholder="${t('common.optional')}"></label>
      </div>
      <div class="section-head"><h2 style="font-size:15px">${t('po.items')}</h2>
        <button type="button" class="link" id="fill-all">${t('po.fillAsOrdered')}</button></div>
      ${po.lines.map((l) => html`<div class="line-item" data-line="${l.id}">
        <div class="line-head"><span style="color:var(--ink);font-size:15px">${l.name}</span>
          <span>${t('po.receivedOf', { received: number(l.qtyReceived, 3), ordered: qty(l.qtyOrdered, l.unit) })}</span></div>
        <div class="form-row">
          <label><span class="label small muted">${t('po.receivedNow')}</span><div class="input-group">
            <input class="input" name="qty" type="number" inputmode="decimal" min="0" step="any" value="${l.remaining > 0 ? l.remaining : ''}" placeholder="0" data-remaining="${l.remaining}">
            <span class="addon">${l.unit}</span></div></label>
          <label><span class="label small muted">${t('stock.costPerUnit')}</span>
            <input class="input" name="unitPrice" type="number" inputmode="decimal" min="0" step="any" value="${Math.round(l.unitPrice * 100) / 100}"></label>
        </div>
        <span class="hint small" data-diff style="color:var(--warn-ink)"></span>
      </div>`)}
      <label class="field" style="margin-top:6px"><span class="label">${t('common.note')}</span><input class="input" name="note" maxlength="200" placeholder="${t('po.receiveNotePh')}"></label>
    </form>`,
    foot: html`<div class="grow" style="align-self:center"><div class="small muted">${t('po.receivedValue')}</div><b class="tabular" id="total" style="font-size:18px">${money(0)}</b></div>
      <button class="btn primary" id="save">${t('po.confirmReceipt')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      const recalc = () => {
        let total = 0;
        $$('[data-line]', el).forEach((w) => {
          const line = po.lines.find((l) => l.id === w.dataset.line);
          const q = Number(w.querySelector('[name=qty]').value) || 0;
          const pr = Number(w.querySelector('[name=unitPrice]').value) || 0;
          total += q * pr;
          const notes = [];
          if (q > line.remaining + 1e-9) notes.push(t('po.moreThanOrdered'));
          if (Math.abs(pr - line.unitPrice) > 0.005) notes.push(t('po.priceChanged', { price: money(line.unitPrice) }));
          w.querySelector('[data-diff]').textContent = notes.join(' · ');
        });
        el.querySelector('#total').textContent = money(total);
      };
      form.addEventListener('input', recalc);
      recalc();
      el.querySelector('#fill-all').addEventListener('click', () => {
        $$('[name=qty]', el).forEach((i) => { i.value = Number(i.dataset.remaining) > 0 ? i.dataset.remaining : ''; });
        recalc();
      });
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const lines = $$('[data-line]', el).map((w) => ({ poLineId: w.dataset.line, qty: w.querySelector('[name=qty]').value, unitPrice: w.querySelector('[name=unitPrice]').value }));
        const r = await call('po.receive', { poId: po.id, date: form.date.value, deliveryRef: form.deliveryRef.value, note: form.note.value, lines }, { requestId: rid });
        close();
        toast(r.status === 'received' ? t('po.receivedAll', { no: po.poNumber }) : t('po.receivedPart', { no: po.poNumber }));
        await ctx.refresh();
        render(ctx);
      }, form));
    },
  });
}

/* ---------------------------------------------------- reorder suggestions */

async function suggestSheet(ctx) {
  let groups;
  try { groups = await call('po.suggestions'); } catch (e) { return toast(e.message, 'bad'); }
  openSheet({
    title: t('po.suggestTitle'),
    body: groups.length ? html`<p class="small muted" style="margin:0 2px 12px">${t('po.suggestHelp')}</p>
      ${groups.map((g, gi) => html`<div class="card" style="margin-bottom:14px" data-group="${gi}">
        <div class="section-head" style="padding:14px 16px 0;margin:0"><h2 style="font-size:15px">${g.supplierName || t('po.noSupplierGroup')}</h2>
          <span class="small muted">${t('po.nItems', { n: g.items.length })}</span></div>
        <ul class="list">${g.items.map((i, ii) => html`<li class="row" style="align-items:flex-start">
          <input type="checkbox" checked data-item="${ii}" aria-label="${i.name}" style="width:22px;height:22px;margin-top:2px;accent-color:var(--brand)" ${g.supplierId ? '' : raw('disabled')}>
          <span class="grow"><div class="title">${i.name}</div>
            <div class="sub">${t('po.suggestLine', { onHand: qty(i.onHand, i.unit), min: number(i.minLevel, 3), onOrder: number(i.onOrder, 3) })}</div></span>
          <span style="width:112px;flex:none"><div class="input-group"><input class="input" type="number" inputmode="decimal" min="0" step="any" value="${i.suggestedQty}" data-qty="${ii}" style="padding:8px 8px;min-height:40px" aria-label="${t('po.qtyToOrder')}">
            <span class="addon" style="padding:0 6px;font-size:12px">${i.unit}</span></div></span></li>`)}</ul>
        <div style="padding:0 16px 16px">${g.supplierId
          ? html`<button class="btn primary block" data-create="${gi}">${icon('plus')}${t('po.createDraft')}</button>`
          : html`<p class="small muted" style="margin:0">${t('po.noSupplierHelp')}</p>`}</div>
      </div>`)}`
      : emptyState('check', t('po.suggestNoneTitle'), t('po.suggestNoneText')),
    onMount(el, close) {
      $$('[data-create]', el).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        const gi = Number(b.dataset.create);
        const g = groups[gi];
        const card = el.querySelector(`[data-group="${gi}"]`);
        const lines = g.items.map((i, ii) => ({ i, ii })).filter(({ ii }) => card.querySelector(`[data-item="${ii}"]`).checked)
          .map(({ i, ii }) => ({ ingredientId: i.ingredientId, qtyOrdered: card.querySelector(`[data-qty="${ii}"]`).value, unitPrice: i.unitPrice }))
          .filter((l) => Number(l.qtyOrdered) > 0);
        const po = await call('po.save', { item: { supplierId: g.supplierId, orderDate: today() }, lines }, { requestId: `${newRequestId()}` });
        close();
        toast(t('po.savedDraft', { no: po.poNumber }));
        await ctx.refresh();
        ui.poFilter = 'open'; ui.tab = 'orders';
        render(ctx);
        setTimeout(() => poSheet(ctx, po.id), 350);
      })));
    },
  });
}

/* ========================================================= invoices */

async function invoiceEditor(ctx, { poId, supplierId, existing }) {
  const boot = ctx.state.boot;
  const suppliers = boot.suppliers.filter((s) => s.active || s.id === (existing?.supplierId || supplierId));
  if (!suppliers.length) return toast(t('po.needSupplier'), 'bad');
  const ings = boot.ingredients;
  const vatRate = Number(boot.settings.vatRate) || 0;
  const rid = newRequestId();
  let orders = [];
  try { orders = await call('po.list', { status: 'all', limit: 300 }); } catch (e) { return toast(e.message, 'bad'); }
  orders = orders.filter((o) => o.status !== 'draft' && o.status !== 'cancelled');
  const inv = existing || { supplierId: supplierId || (poId && orders.find((o) => o.id === poId)?.supplierId) || '', poId: poId || '',
    invoiceNo: '', invoiceDate: today(), dueDate: '', vat: '', total: '', note: '', lines: [] };
  const termsOf = (sid) => (suppliers.find((s) => s.id === sid) || {}).paymentTermsDays || 0;
  const poOptions = (sid, selected) => html`<option value="">${t('inv.noOrder')}</option>${orders.filter((o) => o.supplierId === sid).map((o) =>
    html`<option value="${o.id}" ${o.id === selected ? raw('selected') : ''}>${o.poNumber} · ${fmtDate(o.orderDate)} · ${money(o.total, { cents: false })}</option>`)}`;
  const ingOpts = (selected) => html`<option value="">${t('stock.chooseIngredient')}</option>${ings.filter((i) => i.active || i.id === selected).map((i) =>
    html`<option value="${i.id}" ${i.id === selected ? raw('selected') : ''}>${i.name} (${i.unit})</option>`)}`;
  const lineHtml = (l = {}) => html`<div class="line-item" data-line>
    <div style="display:flex;gap:8px;align-items:center">
      <select class="select" name="ingredientId" aria-label="${t('stock.ingredient')}">${ingOpts(l.ingredientId)}</select>
      <button type="button" class="icon-btn" data-remove aria-label="${t('stock.removeItem')}">${icon('x')}</button></div>
    <div class="form-row" style="margin-top:8px">
      <label><span class="label small muted">${t('inv.qtyBilled')}</span><div class="input-group">
        <input class="input" name="qty" type="number" inputmode="decimal" min="0" step="any" value="${l.qty ?? ''}" placeholder="0">
        <span class="addon" data-unit>${(ings.find((i) => i.id === l.ingredientId) || {}).unit || t('stock.unit')}</span></div></label>
      <label><span class="label small muted">${t('inv.priceBilled')}</span>
        <input class="input" name="unitPrice" type="number" inputmode="decimal" min="0" step="any" value="${l.unitPrice ?? ''}"></label>
    </div></div>`;

  openSheet({
    title: existing ? t('inv.editTitle', { no: existing.invoiceNo }) : t('inv.add'),
    body: html`<form id="f" novalidate>
      <label class="field"><span class="label">${t('stock.supplier')}</span>
        <select class="select" name="supplierId">${options(suppliers.map((s) => ({ value: s.id, label: s.name })), inv.supplierId, { placeholder: t('common.choose') })}</select></label>
      <label class="field"><span class="label">${t('inv.forOrder')}</span>
        <select class="select" name="poId">${poOptions(inv.supplierId, inv.poId)}</select>
        <span class="hint">${t('inv.forOrderHint')}</span></label>
      <div class="form-row">
        <label class="field"><span class="label">${t('inv.invoiceNo')}</span><input class="input" name="invoiceNo" value="${inv.invoiceNo}" maxlength="60"></label>
        <label class="field"><span class="label">${t('inv.invoiceDate')}</span><input class="input" type="date" name="invoiceDate" value="${inv.invoiceDate}"></label>
      </div>
      <div class="section-head" style="margin-top:4px"><h2 style="font-size:15px">${t('inv.lines')}</h2>
        <button type="button" class="link" id="fill-po">${t('inv.fillFromOrder')}</button></div>
      <div id="lines">${(inv.lines.length ? inv.lines : [{}]).map((l) => lineHtml(l))}</div>
      <button type="button" class="btn sm" id="add-line">${icon('plus')}${t('stock.addItem')}</button>
      <div class="card" style="margin-top:16px;padding:12px 14px">
        <div class="pl-row" style="padding:6px 0"><span>${t('inv.subtotal')}</span><b class="tabular" id="subtotal">—</b></div>
        <div class="form-row" style="margin-top:8px">
          <label><span class="label small muted">${t('inv.vatAmount', { rate: number(vatRate, 2) })}</span><input class="input" name="vat" type="number" inputmode="decimal" min="0" step="any" value="${inv.vat}"></label>
          <label><span class="label small muted">${t('inv.totalOnInvoice')}</span><input class="input" name="total" type="number" inputmode="decimal" min="0" step="any" value="${inv.total}"></label>
        </div>
        <span class="hint small muted" id="total-hint"></span>
      </div>
      <label class="field" style="margin-top:14px"><span class="label">${t('inv.dueDate')}</span><input class="input" type="date" name="dueDate" value="${inv.dueDate}">
        <span class="hint" id="due-hint"></span></label>
      <label class="field"><span class="label">${t('common.note')}</span><input class="input" name="note" maxlength="500" value="${inv.note}" placeholder="${t('common.optional')}"></label>
    </form>`,
    foot: html`<button class="btn primary block" id="save">${icon('check')}${t('inv.saveMatch')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      const host = el.querySelector('#lines');
      let vatTouched = existing && existing.vat !== '';
      let totalTouched = existing && existing.total !== '';
      const lines = () => $$('[data-line]', host).map((w) => ({
        el: w, ingredientId: w.querySelector('[name=ingredientId]').value, qty: w.querySelector('[name=qty]').value, unitPrice: w.querySelector('[name=unitPrice]').value,
      }));
      const recalc = () => {
        const sub = lines().reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
        el.querySelector('#subtotal').textContent = money(sub);
        if (!vatTouched) form.vat.value = (Math.round(sub * vatRate) / 100).toFixed(2);
        const expected = sub + (Number(form.vat.value) || 0);
        if (!totalTouched) form.total.value = expected.toFixed(2);
        const diff = (Number(form.total.value) || 0) - expected;
        el.querySelector('#total-hint').textContent = Math.abs(diff) > 1 ? t('inv.totalDiffHint', { diff: money(diff) }) : '';
        el.querySelector('#total-hint').style.color = Math.abs(diff) > 1 ? 'var(--bad-ink)' : '';
      };
      const dueHint = () => {
        const sid = form.supplierId.value;
        const auto = addDays(form.invoiceDate.value || today(), termsOf(sid));
        el.querySelector('#due-hint').textContent = form.dueDate.value ? '' : t('inv.dueAuto', { date: fmtDate(auto, { day: 'numeric', month: 'short' }), n: termsOf(sid) });
      };
      const wire = (w) => {
        w.querySelector('[data-remove]').addEventListener('click', () => {
          if ($$('[data-line]', host).length > 1) w.remove(); else w.querySelectorAll('input, select').forEach((x) => { x.value = ''; });
          recalc();
        });
        w.querySelector('select').addEventListener('change', (e) => {
          const ing = ings.find((i) => i.id === e.target.value);
          w.querySelector('[data-unit]').textContent = ing ? ing.unit : t('stock.unit');
        });
      };
      const addLine = (l) => {
        const tmp = document.createElement('div');
        mount(tmp, lineHtml(l));
        const w = tmp.firstElementChild;
        host.append(w);
        wire(w);
        return w;
      };
      $$('[data-line]', host).forEach(wire);
      form.addEventListener('input', (e) => {
        if (e.target.name === 'vat') vatTouched = true;
        if (e.target.name === 'total') totalTouched = true;
        recalc(); dueHint();
      });
      form.supplierId.addEventListener('change', () => { mount(form.poId, poOptions(form.supplierId.value, '')); dueHint(); });
      const fill = async () => {
        if (!form.poId.value) throw new Error(t('inv.chooseOrderFirst'));
        const po = await call('po.get', { id: form.poId.value });
        host.innerHTML = '';
        const src = po.lines.filter((l) => l.qtyReceived > 0);
        (src.length ? src : po.lines).forEach((l) => addLine({ ingredientId: l.ingredientId, qty: src.length ? l.qtyReceived : l.qtyOrdered, unitPrice: Math.round(l.unitPrice * 100) / 100 }));
        recalc();
      };
      el.querySelector('#fill-po').addEventListener('click', (e) => busy(e.currentTarget, fill, form));
      el.querySelector('#add-line').addEventListener('click', () => addLine().querySelector('select').focus());
      recalc(); dueHint();
      if (!existing && inv.poId) busy(el.querySelector('#fill-po'), fill, form);
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = Object.fromEntries(new FormData(form));
        const payload = {
          item: { ...v, id: existing?.id, version: existing?.version },
          lines: lines().filter((l) => l.ingredientId || l.qty).map(({ ingredientId, qty: q, unitPrice }) => ({ ingredientId, qty: q, unitPrice })),
        };
        let saved;
        try { saved = await call('invoices.save', payload, { requestId: rid }); } catch (err) {
          if (err.code === 'CONFLICT') await ctx.refresh();
          throw err;
        }
        close();
        toast(saved.status === 'matched' ? t('inv.savedMatched') : saved.status === 'noPo' ? t('inv.savedNoPo') : t('inv.savedException', { n: saved.exceptionCount }),
          saved.status === 'exception' ? 'bad' : 'good', 4500);
        await ctx.refresh();
        ui.tab = 'invoices';
        render(ctx);
        setTimeout(() => invoiceSheet(ctx, saved.id), 350);
      }, form));
    },
  });
}

function flagPill(f, line) {
  const good = f === 'priceDown' || f === 'notBilled';
  const text = f === 'priceUp' || f === 'priceDown' ? t(`inv.flag.${f}`, { pct: pct(Math.abs(line.priceDiffPct)) }) : t(`inv.flag.${f}`);
  return html`<span class="pill ${EXCEPTIONS.includes(f) ? 'bad' : good ? '' : 'warn'}">${EXCEPTIONS.includes(f) ? icon('alert') : ''}${text}</span>`;
}

async function invoiceSheet(ctx, id) {
  let inv;
  try { inv = await call('invoices.get', { id }); } catch (e) { return toast(e.message, 'bad'); }
  const m = inv.match;
  const banner = {
    matched: ['good', 'check', t('inv.banner.matched')],
    exception: ['bad', 'alert', t('inv.banner.exception', { n: inv.exceptionCount, amount: money(inv.varianceAmount) })],
    noPo: ['warn', 'info', t('inv.banner.noPo')],
    approved: ['good', 'check', t('inv.banner.approved', { who: inv.reviewedBy })],
    disputed: ['bad', 'alert', t('inv.banner.disputed', { who: inv.reviewedBy })],
    paid: ['good', 'check', t('inv.banner.paid', { date: relDay(inv.paidAt), method: inv.paymentMethod || '—' })],
  }[inv.status];
  const canPay = inv.status === 'matched' || inv.status === 'approved';
  const canApprove = ['exception', 'noPo', 'disputed'].includes(inv.status);

  openSheet({
    title: `${inv.supplierName} · ${inv.invoiceNo}`,
    body: html`
      <div class="alert-card ${banner[0] === 'good' ? '' : banner[0]}" style="margin-bottom:12px;${banner[0] === 'good' ? 'background:var(--good-soft);color:var(--good-ink);border-color:color-mix(in srgb,var(--good) 30%,var(--line))' : ''}">
        ${icon(banner[1])}<span class="grow">${banner[2]}${inv.reviewNote ? html`<div class="small" style="font-weight:500;opacity:.9">“${inv.reviewNote}”</div>` : ''}</span></div>
      <ul class="list card" style="margin-bottom:14px">
        ${infoRow(t('inv.invoiceDate'), relDay(inv.invoiceDate))}
        ${inv.status !== 'paid' ? html`<li class="pl-row"><span>${t('inv.dueDate')}</span><b style="${inv.overdue ? 'color:var(--bad-ink)' : ''}">${relDay(inv.dueDate)}${inv.overdue ? ' · ' + t('inv.overdue') : ''}</b></li>` : ''}
        ${inv.poNumber ? html`<li><button class="pl-row" data-po="${inv.poId}" style="width:100%;background:none;border:0;cursor:pointer;color:inherit"><span>${t('inv.forOrder')}</span><b style="color:var(--brand)">${inv.poNumber} ›</b></button></li>` : ''}
        ${inv.paymentRef ? infoRow(t('inv.paymentRef'), inv.paymentRef) : ''}
        ${inv.note ? infoRow(t('common.note'), inv.note) : ''}
        ${infoRow(t('common.enteredBy'), [inv.createdBy, `${relDay(inv.createdAt.slice(0, 10))} ${timeOf(inv.createdAt)}`].filter(Boolean).join(' · '))}
      </ul>
      <div class="section-head"><h2 style="font-size:15px">${inv.poId ? t('inv.matchTitle') : t('inv.lines')}</h2></div>
      <div class="card"><ul class="list">${m.lines.map((l) => html`<li style="padding:12px 16px">
        <div style="display:flex;justify-content:space-between;gap:10px"><span><b>${l.name}</b> <span class="small muted">· ${l.unit}</span></span>
          <b class="tabular">${l.invoiced ? money(l.invoiced * l.invoicePrice) : '—'}</b></div>
        ${inv.poId ? html`<div class="match-grid tabular">
          <div><span>${t('inv.ordered')}</span>${l.ordered !== undefined ? number(l.ordered, 3) : '—'}</div>
          <div><span>${t('inv.received')}</span>${l.received !== undefined ? number(l.received, 3) : '—'}</div>
          <div><span>${t('inv.invoiced')}</span>${number(l.invoiced, 3)}${l.billedBefore ? html`<small> +${number(l.billedBefore, 3)}</small>` : ''}</div>
          <div><span>${t('inv.price')}</span>${l.invoicePrice !== undefined ? number(l.invoicePrice, 2) : '—'}${l.poPrice !== undefined && l.invoicePrice !== undefined && Math.abs(l.invoicePrice - l.poPrice) > 0.005 ? html`<small style="display:block">${t('inv.wasPrice', { price: number(l.poPrice, 2) })}</small>` : ''}</div>
        </div>` : html`<div class="small muted">${number(l.invoiced, 3)} ${l.unit} × ${money(l.invoicePrice)}</div>`}
        ${l.flags.length ? html`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${l.flags.filter((f) => f !== 'noPo').map((f) => flagPill(f, l))}</div>` : ''}
      </li>`)}</ul>
        <div class="pl-row total" style="border-top:1px solid var(--line)"><span>${t('inv.subtotal')}</span><span>${money(m.totals.subtotal)}</span></div>
        <div class="pl-row"><span>${t('inv.vat')}</span><span>${money(m.totals.vat)}</span></div>
        <div class="pl-row total"><span>${t('inv.totalOnInvoice')}</span><span>${money(m.totals.total)}</span></div>
        ${m.header.includes('totalMismatch') ? html`<div class="pl-row" style="color:var(--bad-ink);font-weight:650">${icon('alert')}<span class="grow" style="margin-left:6px">${t('inv.flag.totalMismatch', { expected: money(m.totals.computedTotal) })}</span></div>` : ''}
      </div>
      ${inv.poId ? html`<p class="small muted" style="margin:10px 4px 0">${t('inv.matchExplain', { tol: number(Number(ctx.state.boot.settings.priceTolerancePct) || 0, 2) })}</p>` : ''}
      ${inv.status !== 'paid' ? html`<div class="card" style="margin-top:16px"><ul class="list">
        ${canApprove ? html`<li><button class="row" data-inv-act="approve" style="min-height:52px"><span class="avatar good" style="width:32px;height:32px">${icon('check')}</span><span class="grow title">${t('inv.approve')}</span>${icon('chevR', 'chev')}</button></li>` : ''}
        ${inv.status !== 'disputed' ? html`<li><button class="row" data-inv-act="dispute" style="min-height:52px"><span class="avatar bad" style="width:32px;height:32px">${icon('alert')}</span><span class="grow title">${t('inv.dispute')}</span>${icon('chevR', 'chev')}</button></li>` : ''}
        <li><button class="row" data-inv-act="edit" style="min-height:52px"><span class="avatar" style="width:32px;height:32px">${icon('edit')}</span><span class="grow title">${t('inv.edit')}</span>${icon('chevR', 'chev')}</button></li>
      </ul></div>` : ''}`,
    foot: canPay ? html`<button class="btn primary block" data-inv-act="pay">${icon('wallet')}${t('inv.markPaid', { amount: money(inv.total) })}</button>` : null,
    onMount(el, close) {
      el.querySelector('[data-po]')?.addEventListener('click', () => { close(); poSheet(ctx, inv.poId); });
      $$('[data-inv-act]', el).forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.invAct;
        if (a === 'edit') { close(); invoiceEditor(ctx, { existing: { ...inv, lines: inv.lines } }); return; }
        if (a === 'pay') { close(); paySheet(ctx, inv); return; }
        const note = await promptSheet({
          title: a === 'approve' ? t('inv.approveTitle') : t('inv.disputeTitle'),
          message: a === 'approve' ? (inv.status === 'noPo' ? t('inv.approveNoPoMsg') : t('inv.approveMsg')) : t('inv.disputeMsg'),
          label: t('inv.reviewNote'), confirm: a === 'approve' ? t('inv.approve') : t('inv.dispute'), danger: a === 'dispute',
          required: a === 'dispute' || inv.status !== 'noPo',
        });
        if (note === null) return;
        await busy(b, async () => {
          await call(a === 'approve' ? 'invoices.approve' : 'invoices.dispute', { id: inv.id, note });
          close();
          toast(a === 'approve' ? t('inv.approved') : t('inv.disputed'));
          await ctx.refresh();
          render(ctx);
          setTimeout(() => invoiceSheet(ctx, inv.id), 350);
        });
      }));
    },
  });
}

function paySheet(ctx, inv) {
  const methods = defaults('paymentMethods');
  const rid = newRequestId();
  openSheet({
    title: t('inv.payTitle', { no: inv.invoiceNo }),
    body: html`<form id="f" novalidate>
      <div class="card summary-strip" style="margin-bottom:14px;grid-template-columns:1fr 1fr">
        <div><div class="val">${money(inv.total)}</div><div class="label">${inv.supplierName}</div></div>
        <div><div class="val" style="${inv.overdue ? 'color:var(--bad-ink)' : ''}">${relDay(inv.dueDate)}</div><div class="label">${t('inv.dueDate')}</div></div>
      </div>
      <div class="form-row">
        <label class="field"><span class="label">${t('inv.paymentDate')}</span><input class="input" type="date" name="date" value="${today()}" max="${today()}"></label>
        <label class="field"><span class="label">${t('exp.paidBy')}</span><select class="select" name="method">${options(methods, methods[1])}</select></label>
      </div>
      <label class="field"><span class="label">${t('inv.paymentRef')}</span><input class="input" name="reference" maxlength="80" placeholder="${t('inv.paymentRefPh')}"></label>
      <p class="small muted" style="margin:0 2px">${t('inv.payNote')}</p>
    </form>`,
    foot: html`<button class="btn primary block" id="save">${icon('check')}${t('inv.confirmPaid')}</button>`,
    onMount(el, close) {
      const form = el.querySelector('#f');
      el.querySelector('#save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await call('invoices.pay', { id: inv.id, ...Object.fromEntries(new FormData(form)) }, { requestId: rid });
        close();
        toast(t('inv.paid', { amount: money(inv.total) }));
        await ctx.refresh();
        render(ctx);
      }, form));
    },
  });
}

/* ------------------------------------------------------------- helpers */

/** Asks for a note. Resolves to the text, or null when cancelled. */
function promptSheet({ title, message, label, confirm, danger, required }) {
  return new Promise((resolve) => {
    let done = false;
    openSheet({
      title,
      body: html`<form id="pf" novalidate><p style="margin:2px 2px 12px;color:var(--ink-2)">${message}</p>
        <label class="field"><span class="label">${label}${required ? '' : html` <span class="muted">(${t('common.optional')})</span>`}</span>
        <textarea class="textarea" name="note" maxlength="500"></textarea></label></form>`,
      foot: html`<button class="btn" data-close>${t('common.cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${confirm}</button>`,
      onMount(el, close) {
        el.querySelector('[data-ok]').addEventListener('click', () => {
          const v = el.querySelector('[name=note]').value.trim();
          if (required && !v) { el.querySelector('[name=note]').focus(); toast(t('inv.noteRequired'), 'bad'); return; }
          done = true; resolve(v); close();
        });
      },
      onClose() { if (!done) resolve(null); },
    });
  });
}
