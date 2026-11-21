// รับของเข้า → สแกนใบเสร็จ: photo → on-phone Thai OCR (PaddleOCR) → a review page where every line shows its strip of the
// receipt next to the ingredient, quantity and cost the app filled in → saved as one stock-in. Product codes are remembered.
import { call } from '../api.js';
import { html, raw, mount, icon, $, $$, openSheet, confirmSheet, toast, busy, money, number, today, unitLabel } from '../ui.js';
import { t } from '../i18n.js';
import { readImage, isDownloaded, supported, cancel } from '../ocr/index.js';
import { parseReceipt, matchLines, unitFactor, factorFor } from '../ocr/receipt.js';

/** The scan buttons for the top of the stock-in sheet. `onDone(out)` runs after a receipt is saved. */
export function scanCard() {
  if (!supported()) {
    return html`<div class="scan-card"><div class="scan-text"><b>${icon('receipt')}${t('scan.title')}</b><span class="small muted">${t('scan.unsupported')}</span></div></div>`;
  }
  return html`<div class="scan-card">
    <div class="scan-text"><b>${icon('receipt')}${t('scan.title')}</b><span class="small muted">${t('scan.sub')}</span></div>
    <div class="scan-btns"><button type="button" class="btn primary" data-scan="camera">${icon('camera')}${t('scan.camera')}</button>
      <button type="button" class="btn" data-scan="file">${icon('download')}${t('scan.file')}</button></div>
    <input type="file" accept="image/*" capture="environment" data-pick="camera" hidden>
    <input type="file" accept="image/*" data-pick="file" hidden>
  </div>`;
}

export function wireScanCard(host, ctx, { onStart, onDone }) {
  $$('[data-scan]', host).forEach((b) => b.addEventListener('click', () => host.querySelector(`[data-pick="${b.dataset.scan}"]`).click()));
  $$('[data-pick]', host).forEach((input) => input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    onStart && onStart();
    setTimeout(() => scan(ctx, file, onDone), 80);
  }));
}

/* ------------------------------------------------------------ reading */

const ERR_KINDS = ['photo', 'download', 'memory', 'crash', 'stalled', 'read'];

async function scan(ctx, file, onDone) {
  const first = !(await isDownloaded());
  let cancelled = false, done = false, closeIt = () => {}, url = '';
  openSheet({
    title: t('scan.reading'),
    body: html`<div class="scan-progress">
      <div class="scan-photo"><img alt="" id="sp-img"></div>
      <div class="bar" role="progressbar" aria-label="${t('scan.reading')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="4"><span id="sp-bar" style="width:4%"></span></div>
      <p class="small" id="sp-msg" role="status" aria-live="polite">${first ? t('scan.firstTime') : t('scan.working')}</p>
      <p class="small muted">${t('scan.privacy')}</p></div>`,
    onMount(el, close) {
      closeIt = close;
      url = URL.createObjectURL(file);
      $('#sp-img', el).src = url;
    },
    onClose() {
      if (url) URL.revokeObjectURL(url);
      if (!done) { cancelled = true; cancel(); }   // closed while reading: stop the reader and free its memory
    },
  });
  const setBar = (v) => { const b = $('#sp-bar'); if (b) { b.style.width = `${v}%`; b.parentElement.setAttribute('aria-valuenow', String(v)); } };
  const msg = () => $('#sp-msg');
  try {
    const result = await readImage(file, (p) => {
      if (p.stage === 'download') {
        setBar(Math.round(4 + p.p * 56));
        if (msg() && first) msg().textContent = t('scan.downloading', { p: Math.round(p.p * 100) });
      } else if (p.stage === 'read') {
        setBar(70);
        if (msg()) msg().textContent = t('scan.found', { n: p.boxes });
      } else if (p.stage === 'recheck') {
        setBar(88);
        if (msg()) msg().textContent = t('scan.recheck', { n: p.boxes });
      }
    });
    if (cancelled) { if (result.image && result.image.close) result.image.close(); return; }
    setBar(100);
    const boot = ctx.state.boot;
    const parsed = parseReceipt(result, { suppliers: boot.suppliers, today: today() });
    done = true;
    closeIt();
    setTimeout(() => reviewSheet(ctx, result, parsed, onDone), 60);
  } catch (e) {
    if (cancelled || (e && e.kind === 'cancelled')) return;
    done = true;
    closeIt();
    const kind = e && ERR_KINDS.includes(e.kind) ? e.kind : 'read';
    toast(t(`scan.err.${kind}`), 'bad', 7000);
  }
}

/* ------------------------------------------------------------ review */

/** One line's strip of the photo, as a small canvas (the user checks the app's reading against the receipt itself). */
function stripCanvas(image, line, width) {
  if (!image || !line.h) return null;
  const pad = Math.round(line.h * 0.25);
  const sy = Math.max(0, line.y - pad), sh = Math.min(image.height - sy, line.h + pad * 2);
  const c = document.createElement('canvas');
  const scale = Math.min(2, width / image.width) * (window.devicePixelRatio || 1);
  c.width = Math.round(image.width * scale); c.height = Math.round(sh * scale);
  c.getContext('2d').drawImage(image, 0, sy, image.width, sh, 0, 0, c.width, c.height);
  c.className = 'scan-strip';
  c.setAttribute('aria-hidden', 'true');
  return c;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;
const COST_OFF = 0.4;   // more than 40% away from the usual cost per unit: usually a wrong pack size

function reviewSheet(ctx, result, parsed, onDone) {
  const boot = ctx.state.boot;
  const ings = boot.ingredients.filter((i) => i.active && i.kind !== 'prep').sort((a, b) => a.name.localeCompare(b.name, 'th'));
  const byId = Object.fromEntries(boot.ingredients.map((i) => [i.id, i]));
  const sups = boot.suppliers.filter((s) => s.active);
  let supplierId = parsed.supplierId;
  // Each line: what the receipt says (quantity and amount, editable: OCR can misread) and what goes into stock.
  let rows = matchLines(parsed.lines, boot.ingredients, supplierId).map((m, i) => ({ ...m, key: i, skip: false, edited: false, learn: !!m.code }));
  const recost = (r) => { r.unitCost = r.ingQty > 0 && r.amount > 0 ? r4(r.amount / r.ingQty) : null; };
  const costOff = (r) => {
    const ing = byId[r.ingredientId], usual = ing ? Number(ing.costPerUnit) || 0 : 0;
    if (r.skip || !usual || !r.unitCost) return 0;
    const ratio = r.unitCost / usual;
    return Math.abs(ratio - 1) > COST_OFF ? ratio - 1 : 0;
  };
  const ingOptions = (sel) => html`<option value="">${t('scan.pickIngredient')}</option>${ings.map((i) => html`<option value="${i.id}" ${i.id === sel ? raw('selected') : ''}>${i.name}</option>`)}`;
  const howPill = (r) => (r.skip ? html`<span class="pill">${t('scan.skipped')}</span>`
    : !r.ingredientId ? html`<span class="pill bad">${t('scan.howNone')}</span>`
      : !(r.ingQty > 0) ? html`<span class="pill warn">${t('scan.needsCheck')}</span>`
        : r.how === 'code' ? html`<span class="pill good">${t('scan.howCode')}</span>`
          : r.how === 'name' ? html`<span class="pill warn">${t('scan.howName')}</span>` : html`<span class="pill brand">${t('scan.howYou')}</span>`);

  openSheet({
    title: t('scan.reviewTitle'),
    wide: true,
    dismissible: false,
    onClose() { if (result.image && result.image.close) result.image.close(); },
    body: html`<form id="rf" novalidate>
      <div class="scan-head">
        <canvas id="thumb" class="scan-thumb" role="button" tabindex="0" aria-label="${t('scan.photo')}"></canvas>
        <div class="grow">
          <label class="field"><span class="label">${t('stock.supplier')}${parsed.supplierId ? html` <span class="pill good">${t('scan.found1')}</span>` : parsed.supplierHint ? html` <span class="pill warn">${t('scan.notInList', { name: parsed.supplierHint })}</span>` : ''}</span>
            <select class="select" name="supplierId"><option value="">${t('stock.usualSupplierOption')}</option>${sups.map((s) => html`<option value="${s.id}" ${s.id === supplierId ? raw('selected') : ''}>${s.name}</option>`)}</select></label>
          <div class="form-row">
            <label class="field"><span class="label">${t('common.date')}${parsed.date ? '' : html` <span class="pill warn">${t('scan.check')}</span>`}</span><input class="input" type="date" name="date" value="${parsed.date || today()}" max="${today()}"></label>
            <label class="field"><span class="label">${t('stock.invoiceNo')}</span><input class="input" name="invoiceRef" maxlength="60" value="${parsed.receiptNo}" placeholder="${t('common.optional')}"></label>
          </div>
        </div>
      </div>
      <p class="small muted" style="margin:4px 2px 10px">${parsed.lines.length ? t('scan.reviewHelp', { n: parsed.lines.length }) : t('scan.noLines')}</p>
      <div id="lines" class="scan-lines"></div>
      <button type="button" class="btn sm" id="add">${icon('plus')}${t('scan.addLine')}</button>
    </form>`,
    foot: html`<div class="grow scan-sum" id="sum"></div><button class="btn primary" id="save">${t('scan.save')}</button>`,
    onMount(el, close) {
      const form = $('#rf', el), host = $('#lines', el);
      // The whole receipt, small, at the top (tap for a big view).
      const thumb = $('#thumb', el);
      if (result.image) {
        const s = 96 / result.image.width, dpr = window.devicePixelRatio || 1;
        thumb.width = Math.round(96 * dpr); thumb.height = Math.round(result.image.height * s * dpr);
        thumb.style.height = `${Math.round(result.image.height * s)}px`;
        thumb.getContext('2d').drawImage(result.image, 0, 0, thumb.width, thumb.height);
        thumb.addEventListener('click', () => photoSheet(result.image));
        thumb.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); photoSheet(result.image); } });
      } else thumb.remove();

      const total = () => rows.filter((r) => !r.skip).reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const drawSum = () => {
        const n = rows.filter((r) => !r.skip).length, sum = Math.round(total() * 100) / 100;
        const okTotal = parsed.total && Math.abs(sum - parsed.total) < 0.01;
        const allSkipped = rows.length && !n;
        mount($('#sum', el), html`<div class="small muted">${t('scan.sumLabel', { n })}</div><b class="tabular" style="font-size:18px">${money(sum)}</b>
          ${parsed.total ? html`<div class="small ${okTotal ? 'good-ink' : 'bad-ink'}">${okTotal ? t('scan.totalOk') : t('scan.totalDiff', { total: money(parsed.total), diff: money(Math.abs(parsed.total - sum)) })}</div>` : ''}
          ${allSkipped ? html`<div class="small bad-ink">${t('scan.nothing')}</div>` : ''}`);
        const missing = rows.filter((r) => !r.skip && (!r.ingredientId || !(r.ingQty > 0) || !(r.amount > 0))).length;
        $('#save', el).disabled = !n || missing > 0;
        $('#save', el).textContent = missing ? t('scan.missing', { n: missing }) : t('scan.saveN', { n });
      };
      const offNote = (r) => { const off = costOff(r); return off ? t('scan.costOff', { pct: `${off > 0 ? '+' : '−'}${Math.round(Math.abs(off) * 100)}%` }) : ''; };
      const drawLine = (r) => {
        const ing = byId[r.ingredientId];
        const wrap = document.createElement('div');
        wrap.className = `scan-line${r.skip ? ' is-skip' : ''}${!r.skip && !r.ingredientId ? ' is-missing' : ''}`;
        wrap.dataset.key = r.key;
        // "1 ขวด = กี่ มล." is asked unless the receipt's unit converts by itself (กก → กรัม).
        const needFactor = ing && !(r.unit && unitFactor(r.unit, ing.unit));
        mount(wrap, html`<div class="scan-line-top"><span data-pill>${howPill(r)}</span><span class="small muted grow scan-raw">${r.code ? html`<b>${r.code}</b> · ` : ''}${r.name || t('scan.noName')}</span>
            <label class="check small"><input type="checkbox" data-f="skip" ${r.skip ? raw('checked') : ''}>${t('scan.skip')}</label></div>
          <div class="scan-strip-host"></div>
          ${r.manual ? '' : html`<div class="small scan-receipt">${t('scan.onReceipt', { qty: number(r.qty, 3), unit: r.unit || '', price: money(r.unitPrice), amount: money(r.amount) })}${r.discount ? ` · ${t('scan.discount', { d: money(r.discount) })}` : ''}</div>`}
          ${r.skip ? '' : html`<div class="form-row scan-qty">
            <label><span class="label small muted">${t('scan.qty')}</span><input class="input" data-f="qty" type="number" inputmode="decimal" min="0" step="any" value="${r.qty ?? ''}"></label>
            <label><span class="label small muted">${t('scan.amount')}</span><input class="input" data-f="amount" type="number" inputmode="decimal" min="0" step="any" value="${r.amount || ''}" placeholder="0.00"></label>
          </div>
          <select class="select" data-f="ingredientId" aria-label="${t('stock.ingredient')}">${ingOptions(r.ingredientId)}</select>
          <div class="form-row scan-qty">
            ${needFactor ? html`<label><span class="label small muted">${t('scan.factor', { unit: r.unit || t('stock.unit'), ingUnit: unitLabel(ing.unit) })}</span>
              <input class="input" data-f="factor" type="number" inputmode="decimal" min="0" step="any" value="${r.factor || ''}" placeholder="0"></label>` : ''}
            <label><span class="label small muted">${t('scan.got')}</span><div class="input-group"><input class="input" data-f="ingQty" type="number" inputmode="decimal" min="0" step="any" value="${r.ingQty ?? ''}">
              <span class="addon">${ing ? unitLabel(ing.unit) : t('stock.unit')}</span></div></label>
            <label><span class="label small muted">${t('stock.costPerUnit')}</span><input class="input" data-f="unitCost" type="number" value="${r.unitCost ?? ''}" readonly tabindex="-1"></label>
          </div>
          <div class="small warn-ink" data-off aria-live="polite">${offNote(r)}</div>
          ${r.code ? html`<label class="check small"><input type="checkbox" data-f="learn" ${r.learn ? raw('checked') : ''}>${t('scan.learn')}</label>` : ''}`}`);
        const strip = stripCanvas(result.image, r, host.clientWidth || 600);
        if (strip) wrap.querySelector('.scan-strip-host').append(strip);
        const set = (sel, v) => { const x = wrap.querySelector(sel); if (x && document.activeElement !== x) x.value = v ?? ''; };
        const refresh = () => {
          recost(r);
          set('[data-f=unitCost]', r.unitCost);
          const off = wrap.querySelector('[data-off]');
          if (off) off.textContent = offNote(r);
          mount(wrap.querySelector('[data-pill]'), howPill(r));
          drawSum();
        };
        // Choices that change the card's layout redraw it; typed numbers update in place (the keyboard stays up).
        wrap.addEventListener('change', (e) => {
          const f = e.target.dataset.f;
          if (f !== 'skip' && f !== 'learn' && f !== 'ingredientId') return;
          if (f === 'skip') r.skip = e.target.checked;
          if (f === 'learn') r.learn = e.target.checked;
          if (f === 'ingredientId') {
            r.ingredientId = e.target.value; r.how = r.ingredientId ? 'you' : ''; r.edited = true;
            const ing2 = byId[r.ingredientId];
            r.factor = ing2 ? factorFor(r, ing2) : null;
            r.ingQty = r.factor && r.qty > 0 ? r3(r.qty * r.factor) : null;
          }
          recost(r);
          wrap.replaceWith(drawLine(r));
          drawSum();
        });
        wrap.addEventListener('input', (e) => {
          const f = e.target.dataset.f;
          if (!['qty', 'amount', 'factor', 'ingQty'].includes(f)) return;
          const v = Number(e.target.value) > 0 ? Number(e.target.value) : null;
          r.edited = true;
          if (f === 'qty') {
            r.qty = v;
            if (r.factor && v) { r.ingQty = r3(v * r.factor); set('[data-f=ingQty]', r.ingQty); }
            if (v && r.amount) r.unitPrice = r4(r.amount / v);
          } else if (f === 'amount') {
            r.amount = v || 0;
            r.unitPrice = r.qty > 0 ? r4(r.amount / r.qty) : r.amount;
          } else if (f === 'factor') {
            r.factor = v; r.ingQty = v && r.qty > 0 ? r3(r.qty * v) : null; set('[data-f=ingQty]', r.ingQty);
          } else {
            r.ingQty = v;
            // What one receipt unit holds follows from what was received (remembered as the pack size).
            if (v && r.qty > 0) { r.factor = r4(v / r.qty); set('[data-f=factor]', r.factor); }
          }
          refresh();
        });
        return wrap;
      };
      const drawAll = () => { host.innerHTML = ''; rows.forEach((r) => host.append(drawLine(r))); drawSum(); };
      drawAll();

      form.supplierId.addEventListener('change', () => {
        // A different supplier can mean different codes: match again, keeping every line the user touched.
        supplierId = form.supplierId.value;
        const again = matchLines(rows, boot.ingredients, supplierId);
        rows = rows.map((r, i) => (r.edited || r.manual || r.skip ? r : { ...r, ...again[i], key: r.key, skip: false, edited: false, learn: r.learn }));
        drawAll();
      });
      $('#add', el).addEventListener('click', () => {
        rows.push({ key: rows.length, manual: true, edited: true, code: '', name: t('scan.manualLine'), qty: 1, unit: '', unitPrice: 0, amount: 0,
          ingredientId: '', how: '', factor: null, ingQty: null, unitCost: null, skip: false, learn: false });
        drawAll();
        host.lastElementChild.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });

      const send = (force) => call('purchases.fromReceipt', {
        date: form.date.value, supplierId: form.supplierId.value, invoiceRef: form.invoiceRef.value.trim(), force,
        // qty = what goes into stock; receiptQty lets the server work out the pack size it remembers.
        lines: rows.filter((r) => !r.skip).map((r) => ({ ingredientId: r.ingredientId, qty: r.ingQty, unitCost: r.unitCost,
          code: r.code, receiptUnit: r.unit, receiptQty: r.qty, unitPrice: r.unitPrice, learn: !!r.learn && !!r.code })),
      });
      const finish = (out) => {
        close();
        const extra = [out.learned ? t('scan.learned', { n: out.learned }) : '', out.keptExisting ? t('scan.keptExisting', { n: out.keptExisting }) : ''].filter(Boolean).join(' · ');
        toast(t('stock.purchaseSaved', { n: out.count, total: money(out.total) }) + (extra ? ` · ${extra}` : ''), 'good', 6000);
        onDone && onDone(out);
      };
      $('#save', el).addEventListener('click', async () => {
        const off = rows.filter((r) => costOff(r)).length;
        if (off && !(await confirmSheet({ title: t('scan.costOffTitle'), message: t('scan.costOffText', { n: off }), confirm: t('scan.costOffSave') }))) return;
        let dup = null;
        await busy($('#save', el), async () => {
          try { finish(await send(false)); } catch (e) { if (e.code === 'DUPLICATE') dup = e; else throw e; }
        }, form);
        if (!dup) return;
        // Asked once the first save has finished, so saving again isn't blocked by it.
        if (!(await confirmSheet({ title: t('scan.dupTitle'), message: `${dup.message} ${t('scan.dupText')}`, confirm: t('scan.dupSave'), danger: true }))) return;
        await busy($('#save', el), async () => finish(await send(true)), form);
      });
    },
  });
}

function photoSheet(image) {
  openSheet({
    title: t('scan.photo'),
    wide: true,
    body: html`<div class="scan-full"><canvas id="full"></canvas></div>`,
    onMount(el) {
      const c = $('#full', el);
      c.width = image.width; c.height = image.height;
      c.getContext('2d').drawImage(image, 0, 0);
    },
  });
}
