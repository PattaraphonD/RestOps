// Small dependency-free SVG charts with hover/tap tooltips.
import { esc, html, money, fmtDate, number } from './ui.js';
import { t } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';

function niceStep(max, count = 4) {
  if (max <= 0) return 1;
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}
function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${number(n / 1e6, 1)}M`;
  if (a >= 1e3) return `${number(n / 1e3, a >= 1e4 ? 0 : 1)}k`;
  return number(n, 0);
}
/** Vertical bar from baseline y0 to y1, rounded only at the data end. */
function barPath(x, y0, w, y1, r = 3) {
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  r = Math.min(r, w / 2, h);
  if (h < 0.5) return '';
  if (up) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

function tooltipFor(container) {
  let tip = container.querySelector('.tooltip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'tooltip hidden'; container.append(tip); }
  return tip;
}

/**
 * Daily cash flow: money in (sales) above the baseline, money out (purchases + expenses) below.
 */
export function cashFlowChart(container, days) {
  container.classList.add('chart');
  const W = Math.max(280, container.clientWidth || 340);
  const H = 210, padL = 40, padR = 6, padT = 10, padB = 24;
  const maxIn = Math.max(1, ...days.map((d) => d.cashIn));
  const maxOut = Math.max(1, ...days.map((d) => d.cashOut));
  const step = niceStep(Math.max(maxIn, maxOut), 3);
  const top = Math.ceil(maxIn / step) * step;
  const bottom = Math.ceil(maxOut / step) * step;
  const innerH = H - padT - padB;
  const y = (v) => padT + (top - v) / (top + bottom) * innerH;
  const y0 = y(0);
  const n = Math.max(days.length, 1);
  const band = (W - padL - padR) / n;
  const bw = Math.max(2, Math.min(14, band * 0.62));
  const x = (i) => padL + i * band + (band - bw) / 2;

  let grid = '', labels = '';
  for (let v = -bottom; v <= top + 1e-9; v += step) {
    const yy = y(v);
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" ${v === 0 ? 'style="stroke:var(--axis)"' : ''}/>`;
    labels += `<text x="${padL - 6}" y="${yy + 4}" text-anchor="end">${v < 0 ? '−' : ''}${compact(Math.abs(v))}</text>`;
  }
  let bars = '', hits = '', xlabels = '';
  days.forEach((d, i) => {
    bars += `<path d="${barPath(x(i), y0 - 1, bw, y(d.cashIn))}" fill="var(--series-1)"/>`;
    bars += `<path d="${barPath(x(i), y0 + 1, bw, y(-d.cashOut))}" fill="var(--series-2)"/>`;
    hits += `<rect class="hover-band" data-i="${i}" x="${padL + i * band}" y="${padT}" width="${band}" height="${innerH}"/>`;
    const day = Number(d.date.slice(8));
    if (day === 1 || (day - 1) % 7 === 0) xlabels += `<text x="${x(i) + bw / 2}" y="${H - 6}" text-anchor="middle">${day}</text>`;
  });

  container.innerHTML = `
    <div class="legend"><span><i style="background:var(--series-1)"></i>${esc(t('chart.moneyIn'))}</span>
      <span><i style="background:var(--series-2)"></i>${esc(t('chart.moneyOut'))}</span></div>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t('chart.cashFlowLabel'))}">
      <g class="grid">${grid}</g>${labels}${bars}${xlabels}<g>${hits}</g>
    </svg>`;
  const svg = container.querySelector('svg');
  const tip = tooltipFor(container);
  let active = null;
  const show = (i) => {
    const d = days[i];
    if (active) active.classList.remove('on');
    active = svg.querySelector(`.hover-band[data-i="${i}"]`);
    active.classList.add('on');
    tip.innerHTML = `<b>${esc(fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><br>
      <i style="background:var(--series-1)"></i>${esc(t('chart.in'))} ${esc(money(d.cashIn, { cents: false }))}<br>
      <i style="background:var(--series-2)"></i>${esc(t('chart.out'))} ${esc(money(d.cashOut, { cents: false }))}<br>
      ${esc(t('chart.net'))} <b>${esc(money(d.net, { cents: false }))}</b>`;
    tip.classList.remove('hidden');
    const scale = svg.getBoundingClientRect().width / W;
    const cx = (padL + (i + 0.5) * band) * scale;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(cx, half), container.clientWidth - half)}px`;
    tip.style.top = `${(container.querySelector('.legend').offsetHeight + 10) + padT * scale}px`;
  };
  const hide = () => { tip.classList.add('hidden'); if (active) active.classList.remove('on'); active = null; };
  svg.addEventListener('pointermove', (e) => {
    const t = e.target.closest('.hover-band');
    if (t) show(Number(t.dataset.i));
  });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  svg.addEventListener('click', (e) => { const t = e.target.closest('.hover-band'); if (t) show(Number(t.dataset.i)); });
}

/**
 * Horizontal bars for one measure (e.g. top sellers by quantity). Labels sit above each bar.
 * rows: [{ label, value, valueLabel, detail }]
 */
export function barList(container, rows) {
  container.classList.add('chart');
  const W = Math.max(280, container.clientWidth || 340);
  const rowH = 40, barH = 10, padR = 8;
  const H = rows.length * rowH + 4;
  const max = Math.max(1, ...rows.map((r) => r.value));
  let out = '';
  rows.forEach((r, i) => {
    const y = i * rowH;
    const w = Math.max(3, (W - padR) * (r.value / max));
    out += `<g class="item" data-i="${i}">
      <rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}"/>
      <text class="ink" x="0" y="${y + 15}">${esc(r.label)}</text>
      <text class="val" x="${W - padR}" y="${y + 15}" text-anchor="end">${esc(r.valueLabel)}</text>
      <rect x="0" y="${y + 22}" width="${W - padR}" height="${barH}" rx="${barH / 2}" fill="var(--surface-3)"/>
      <rect x="0" y="${y + 22}" width="${w}" height="${barH}" rx="${barH / 2}" fill="var(--series-1)"/>
    </g>`;
  });
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t('chart.barLabel'))}">${out}</svg>`;
  const svg = container.querySelector('svg');
  const tip = tooltipFor(container);
  const show = (i) => {
    const r = rows[i];
    tip.innerHTML = `<b>${esc(r.label)}</b><br>${esc(r.detail || r.valueLabel)}`;
    tip.classList.remove('hidden');
    const scale = svg.getBoundingClientRect().width / W;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(container.clientWidth / 2, half), container.clientWidth - half)}px`;
    tip.style.top = `${i * rowH * scale + 4}px`;
  };
  svg.addEventListener('pointermove', (e) => { const g = e.target.closest('.item'); if (g) show(Number(g.dataset.i)); });
  svg.addEventListener('click', (e) => { const g = e.target.closest('.item'); if (g) show(Number(g.dataset.i)); });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') tip.classList.add('hidden'); });
}

/**
 * Tiny trend line (no axes) for a series of numbers, oldest first. Returns markup (html-safe).
 * The <title> summarises first → last for screen readers; `format` formats those two values.
 */
export function sparkline(points, { width = 280, height = 48, format = (v) => number(v, 2) } = {}) {
  const vals = (points || []).map(Number).filter((v) => Number.isFinite(v));
  if (!vals.length) return html``;
  const pad = 4;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min;
  const x = (i) => (vals.length === 1 ? width / 2 : pad + i * (width - pad * 2) / (vals.length - 1));
  const y = (v) => (span === 0 ? height / 2 : pad + (max - v) / span * (height - pad * 2));
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = vals.length - 1;
  const label = t('chart.sparkLabel', { first: format(vals[0]), last: format(vals[last]), n: vals.length });
  return html`<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${label}">
    <title>${label}</title>
    ${vals.length > 1 ? html`<path d="${d}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    <circle cx="${x(last).toFixed(1)}" cy="${y(vals[last]).toFixed(1)}" r="3.5" fill="var(--series-1)"/></svg>`;
}

/**
 * Menu engineering quadrant: x = share of dishes sold (%), y = margin per dish. Bubble area ∝ revenue.
 * Divider lines at the popularity threshold and the average margin. Tapping a dot dispatches
 * CustomEvent('pick', { detail: menuItemId }) on the container.
 */
const CLS_COLOR = { star: 'var(--good)', plowhorse: 'var(--series-1)', puzzle: 'var(--warn)', dog: 'var(--bad)' };
export function quadrantChart(container, items, { avgCm, threshold, labels }) {
  container.classList.add('chart');
  const W = Math.max(300, container.clientWidth || 340), H = 280;
  const L = 44, R = 12, T = 22, B = 34;
  const maxX = Math.max(threshold * 2, ...items.map((i) => i.mixPct)) * 1.1 || 10;
  const ys = items.map((i) => i.cmPerDish);
  const maxY = Math.max(avgCm, ...ys, 1) * 1.15;
  const minY = Math.min(0, ...ys) * 1.15;
  const x = (v) => L + (v / maxX) * (W - L - R);
  const y = (v) => T + (maxY - v) / (maxY - minY || 1) * (H - T - B);
  const maxRev = Math.max(1, ...items.map((i) => i.revenue));
  const rad = (rev) => 6 + 14 * Math.sqrt(Math.max(0, rev) / maxRev);
  const tx = x(threshold), ty = y(avgCm);
  const corner = (cls, cx, cy, anchor) => `<text class="ink" x="${cx}" y="${cy}" text-anchor="${anchor}" style="font-size:11px;font-weight:700;fill:${CLS_COLOR[cls]}">${esc(labels[cls])}</text>`;
  let dots = '';
  items.slice().sort((a, b) => b.revenue - a.revenue).forEach((i) => {
    dots += `<g class="item dot" data-id="${esc(i.menuItemId)}" tabindex="0" role="button" aria-label="${esc(i.name)}">
      <title>${esc(i.name)}: ${esc(labels[i.cls])}</title>
      <circle cx="${x(i.mixPct).toFixed(1)}" cy="${y(i.cmPerDish).toFixed(1)}" r="${rad(i.revenue).toFixed(1)}"
        fill="${CLS_COLOR[i.cls]}" fill-opacity=".55" stroke="${CLS_COLOR[i.cls]}" stroke-width="1.5"/></g>`;
  });
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(labels.chart)}">
    <desc>${esc(labels.desc)}</desc>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="var(--surface-2)" rx="6"/>
    <line x1="${tx}" x2="${tx}" y1="${T}" y2="${H - B}" stroke="var(--line-strong)" stroke-dasharray="4 4"/>
    <line x1="${L}" x2="${W - R}" y1="${ty}" y2="${ty}" stroke="var(--line-strong)" stroke-dasharray="4 4"/>
    ${corner('puzzle', L + 6, T + 14, 'start')}${corner('star', W - R - 6, T + 14, 'end')}
    ${corner('dog', L + 6, H - B - 6, 'start')}${corner('plowhorse', W - R - 6, H - B - 6, 'end')}
    <text class="val" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">${esc(labels.x)}</text>
    <text class="val" x="12" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">${esc(labels.y)}</text>
    ${dots}</svg>`;
  const pick = (g) => container.dispatchEvent(new CustomEvent('pick', { detail: g.dataset.id }));
  container.querySelectorAll('.dot').forEach((g) => {
    g.addEventListener('click', () => pick(g));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(g); } });
  });
}

/**
 * Promotion results: daily margin of the promoted dishes. Promotion days are drawn in the brand colour,
 * the 4 weeks before in grey, and the baseline per-day average as a dashed line.
 */
export function promoChart(container, days, { baseline, label }) {
  container.classList.add('chart');
  const W = Math.max(300, container.clientWidth || 340), H = 180, L = 40, R = 8, T = 10, B = 22;
  const vals = days.map((d) => d.cm);
  const max = Math.max(1, baseline, ...vals) * 1.1, min = Math.min(0, ...vals) * 1.1;
  const y = (v) => T + (max - v) / (max - min || 1) * (H - T - B);
  const bw = (W - L - R) / Math.max(1, days.length);
  let bars = '';
  days.forEach((d, i) => {
    const x = L + i * bw + bw * 0.15, w = Math.max(1, bw * 0.7);
    const y0 = y(0), y1 = y(d.cm);
    bars += `<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0.5, Math.abs(y1 - y0)).toFixed(1)}"
      rx="2" fill="${d.inPromo ? 'var(--series-1)' : 'var(--line-strong)'}"><title>${esc(fmtDate(d.date))}: ${esc(money(d.cm, { cents: false }))}</title></rect>`;
  });
  const first = days.findIndex((d) => d.inPromo);
  const yb = y(baseline);
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>
    ${bars}
    <line x1="${L}" x2="${W - R}" y1="${yb}" y2="${yb}" stroke="var(--ink-2)" stroke-dasharray="5 4"/>
    <text class="val" x="${L - 4}" y="${yb + 4}" text-anchor="end">${esc(compact(baseline))}</text>
    ${first >= 0 ? `<line x1="${L + first * bw}" x2="${L + first * bw}" y1="${T}" y2="${H - B}" stroke="var(--series-1)" stroke-dasharray="2 3"/>` : ''}
    <text class="val" x="${L}" y="${H - 6}">${esc(fmtDate(days[0] ? days[0].date : ''))}</text>
    <text class="val" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(fmtDate(days.length ? days[days.length - 1].date : ''))}</text>
  </svg>`;
}
