// On-phone Thai OCR: PaddleOCR PP-OCRv5 (mobile text detector + Thai recogniser) on ONNX Runtime Web (WebAssembly).
// Runs in a worker (see worker.js) or, where a worker can't draw, on the page. Models are self-hosted under /vendor/ocr
// and kept in their own cache, so they download once per phone (about 24 MB) and work offline after that.
import * as ort from '../../vendor/ocr/ort.wasm.bundle.min.mjs';

const BASE = new URL('../../vendor/ocr/', import.meta.url).href;
const FILES = { wasm: 'ort-wasm-simd-threaded.wasm', det: 'det.onnx', rec: 'rec-th.onnx', dict: 'dict-th.json' };
const SIZES = { wasm: 11210254, det: 4826518, rec: 7891015, dict: 2818 };   // for the download progress bar
import { CACHE, CACHE_PREFIX, betterReading } from './engine-meta.js';
export { CACHE };

// PaddleOCR settings (inference.yml): detector long side 960, DB thresholds; recogniser height 48.
const DET_LONG = 1536, DET_THRESH = 0.3, BOX_THRESH = 0.55, UNCLIP = 1.6;
const REC_H = 48, REC_BATCH = 6, REC_MIN_W = 320, REC_MAX_W = 3200;
const RETRY_CONF = 0.9, RETRY_MAX = 40;

ort.env.wasm.numThreads = 1;      // no cross-origin isolation needed
ort.env.wasm.proxy = false;
ort.env.logLevel = 'error';

let ready = null;
let det = null, rec = null, dict = null;

/** Downloads (or reads from the cache) one model file, reporting bytes as they arrive. */
async function load(name, onBytes) {
  const url = BASE + FILES[name];
  let cache = null, hit = null;
  try { cache = await caches.open(CACHE); hit = await cache.match(url); } catch { /* no Cache API */ }
  if (hit) {
    const buf = await hit.arrayBuffer();
    if (!EXACT[name] || buf.byteLength === SIZES[name]) { onBytes(name, buf.byteLength); return buf; }
    try { await cache.delete(url); } catch { /* ignore */ }   // a damaged copy: fetch it again
  }
  const res = await fetch(url);
  if (!res.ok) throw ocrError('download', `${FILES[name]} ${res.status}`);
  // Read the body once, straight into one buffer (no second copy: phones are short of memory).
  const expected = SIZES[name];
  let buf, got = 0;
  if (res.body && EXACT[name]) {
    const out = new Uint8Array(expected), reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > expected) throw ocrError('download', `${FILES[name]} too large`);
      out.set(value, got); got += value.length; onBytes(name, got);
    }
    if (got !== expected) throw ocrError('download', `${FILES[name]} incomplete`);
    buf = out.buffer;
  } else {
    buf = await res.arrayBuffer(); got = buf.byteLength; onBytes(name, got);
  }
  if (cache) { try { await cache.put(url, new Response(buf)); } catch { /* storage full: it still works, just downloads again next time */ } }
  return buf;
}
function ocrError(kind, detail) { const e = new Error(detail); e.kind = kind; return e; }
const EXACT = { wasm: true, det: true, rec: true };

/** Loads the runtime and both models once. progress(fraction 0–1, fromNetwork). */
export function init(progress = () => {}) {
  if (ready) return ready;
  ready = (async () => {
    const got = {}, total = Object.values(SIZES).reduce((a, b) => a + b, 0);
    const onBytes = (name, n) => { got[name] = n; progress(Math.min(1, Object.values(got).reduce((a, b) => a + b, 0) / total)); };
    // Earlier versions' caches go (each is about 24 MB).
    try { for (const k of await caches.keys()) if (k.startsWith(CACHE_PREFIX) && k !== CACHE) await caches.delete(k); } catch { /* ignore */ }
    // One file at a time: a phone short of memory holds one download, not three.
    const wasm = await load('wasm', onBytes), detBuf = await load('det', onBytes), recBuf = await load('rec', onBytes), dictBuf = await load('dict', onBytes);
    ort.env.wasm.wasmBinary = wasm;
    const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 };   // errors only (the models carry harmless unused weights)
    det = await ort.InferenceSession.create(detBuf, opts);
    rec = await ort.InferenceSession.create(recBuf, opts);
    dict = JSON.parse(new TextDecoder().decode(dictBuf));
    // Ask the phone to keep the 24 MB download (iOS may otherwise clear it when storage runs low).
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* best effort */ }
    progress(1);
    return true;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

/* ------------------------------------------------------------ images */

function canvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }

/** The photo on a canvas, 1800–2400 px on its long side: small photos are enlarged (small text reads better), big ones reduced. */
function toCanvas(bitmap, angleDeg = 0) {
  const long = Math.max(bitmap.width, bitmap.height);
  const scale = long > 2400 ? 2400 / long : long < 1800 ? 1800 / long : 1;
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const a = angleDeg * Math.PI / 180, cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  const W = Math.round(w * cos + h * sin), H = Math.round(w * sin + h * cos);
  const c = canvas(W, H), g = ctx2d(c);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.translate(W / 2, H / 2); g.rotate(a);
  g.drawImage(bitmap, -w / 2, -h / 2, w, h);
  return c;
}

/*
 * A second look at lines the reader was unsure of. Two cleaned-up versions of the line are read, and a reading is kept
 * only when the reader is surer of it than of the first one, so a clean photo can't get worse. (Cleaning the whole
 * photo instead was tried on the owner's receipts: it helped one and turned misread totals into items on another.)
 */
const stretchTo = (gray, px, loQ, hiQ) => {
  const n = gray.length, hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]]++;
  const at = (q) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * q) return v; } return 255; };
  const lo = at(loQ), hi = Math.max(lo + 1, at(hiQ));
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(255, ((gray[i] - lo) * 255) / (hi - lo))), p = i * 4;
    px[p] = px[p + 1] = px[p + 2] = v;
  }
};
/** Only the ink: coloured paper and print (Makro's pink and red) turn white, dark ink stays, stretched to black and white. */
function inkOnly(px) {
  const n = px.length / 4, gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const p = i * 4; gray[i] = Math.max(px[p], px[p + 1], px[p + 2]); }
  stretchTo(gray, px, 0.02, 0.9);
}
/** Faded print (old thermal paper, dim light): the line in grey, its faintest ink stretched to black. */
function contrast(px) {
  const n = px.length / 4, gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const p = i * 4; gray[i] = (px[p] * 77 + px[p + 1] * 150 + px[p + 2] * 29) >> 8; }
  stretchTo(gray, px, 0.01, 0.95);
}
const RECHECKS = [inkOnly, contrast];

/* ------------------------------------------------------------ detection (DB) */

async function detect(src) {
  const W = src.width, H = src.height, r = DET_LONG / Math.max(W, H);
  const rw = Math.max(32, Math.round(W * r / 32) * 32), rh = Math.max(32, Math.round(H * r / 32) * 32);
  const c = canvas(rw, rh), g = ctx2d(c);
  g.drawImage(src, 0, 0, rw, rh);
  const px = g.getImageData(0, 0, rw, rh).data, n = rw * rh;
  const x = new Float32Array(3 * n);
  // BGR order, ImageNet mean/std (as PaddleOCR feeds its detector).
  const mean = [0.406, 0.456, 0.485], std = [0.225, 0.224, 0.229];
  for (let i = 0; i < n; i++) {
    const R = px[i * 4] / 255, G = px[i * 4 + 1] / 255, B = px[i * 4 + 2] / 255;
    x[i] = (B - mean[2]) / std[2];
    x[n + i] = (G - mean[1]) / std[1];
    x[2 * n + i] = (R - mean[0]) / std[0];
  }
  const out = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, rh, rw]) });
  const prob = out[det.outputNames[0]].data;
  // Connected regions above the threshold → boxes (axis-aligned; the photo is straightened first).
  const seen = new Uint8Array(n), stack = new Int32Array(n), boxes = [], angles = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || prob[s] <= DET_THRESH) continue;
    let top = 0, count = 0, sum = 0, minX = rw, maxX = 0, minY = rh, maxY = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    stack[top++] = s; seen[s] = 1;
    while (top) {
      const p = stack[--top], py = (p / rw) | 0, pxx = p - py * rw;
      count++; sum += prob[p];
      if (pxx < minX) minX = pxx; if (pxx > maxX) maxX = pxx; if (py < minY) minY = py; if (py > maxY) maxY = py;
      sx += pxx; sy += py; sxx += pxx * pxx; syy += py * py; sxy += pxx * py;
      const nb = [p - 1, p + 1, p - rw, p + rw];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (q < 0 || q >= n || seen[q] || prob[q] <= DET_THRESH) continue;
        if ((k === 0 && pxx === 0) || (k === 1 && pxx === rw - 1)) continue;
        seen[q] = 1; stack[top++] = q;
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    if (count < 8 || h < 3 || sum / count < BOX_THRESH) continue;
    if (w > h * 4 && count > 60) {
      const mx = sx / count, my = sy / count;
      const cxx = sxx / count - mx * mx, cyy = syy / count - my * my, cxy = sxy / count - mx * my;
      angles.push({ a: 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI, wgt: w });
    }
    // Grow the shrunken DB region back to the full text (PaddleOCR "unclip").
    const d = (w * h * UNCLIP) / (2 * (w + h));
    boxes.push({ x0: Math.max(0, minX - d), y0: Math.max(0, minY - d), x1: Math.min(rw, maxX + 1 + d), y1: Math.min(rh, maxY + 1 + d) });
  }
  const fx = W / rw, fy = H / rh;
  return {
    boxes: boxes.map((b) => ({ x: b.x0 * fx, y: b.y0 * fy, w: (b.x1 - b.x0) * fx, h: (b.y1 - b.y0) * fy })),
    angle: weightedMedian(angles),
  };
}
function weightedMedian(list) {
  if (!list.length) return 0;
  list.sort((p, q) => p.a - q.a);
  const half = list.reduce((s, v) => s + v.wgt, 0) / 2;
  let acc = 0;
  for (const v of list) { acc += v.wgt; if (acc >= half) return v.a; }
  return list[list.length - 1].a;
}

/* ------------------------------------------------------------ recognition (CTC) */

async function recognise(src, boxes, filter = null) {
  const g = ctx2d(src);
  const items = boxes.map((b, i) => {
    const w = Math.max(1, Math.round(b.w)), h = Math.max(1, Math.round(b.h));
    return { i, b, w, h, tw: Math.max(8, Math.min(REC_MAX_W, Math.round(REC_H * w / h))) };
  }).sort((a, b) => a.tw - b.tw);
  const out = new Array(boxes.length);
  for (let s = 0; s < items.length; s += REC_BATCH) {
    // Like PaddleOCR: each crop keeps its shape and the batch is padded to at least 320 px wide.
    const batch = items.slice(s, s + REC_BATCH), maxW = Math.max(REC_MIN_W, ...batch.map((it) => it.tw));
    const plane = REC_H * maxW, x = new Float32Array(batch.length * 3 * plane);
    batch.forEach((it, k) => {
      const c = canvas(it.tw, REC_H), cg = ctx2d(c);
      cg.drawImage(src, it.b.x, it.b.y, it.b.w, it.b.h, 0, 0, it.tw, REC_H);
      const px = cg.getImageData(0, 0, it.tw, REC_H).data, base = k * 3 * plane;
      if (filter) filter(px);
      for (let yy = 0; yy < REC_H; yy++) {
        for (let xx = 0; xx < it.tw; xx++) {
          const p = (yy * it.tw + xx) * 4, o = yy * maxW + xx;
          x[base + o] = (px[p + 2] / 255 - 0.5) / 0.5;               // B
          x[base + plane + o] = (px[p + 1] / 255 - 0.5) / 0.5;       // G
          x[base + 2 * plane + o] = (px[p] / 255 - 0.5) / 0.5;       // R
        }
      }
    });
    const res = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', x, [batch.length, 3, REC_H, maxW]) });
    const t = res[rec.outputNames[0]], [, T, C] = t.dims, data = t.data;
    batch.forEach((it, k) => {
      let text = '', last = -1, confSum = 0, confN = 0;
      for (let step = 0; step < T; step++) {
        let best = 0, bestP = -Infinity;
        const off = (k * T + step) * C;
        for (let c = 0; c < C; c++) { const v = data[off + c]; if (v > bestP) { bestP = v; best = c; } }
        if (best !== 0 && best !== last) {
          text += best - 1 < dict.length ? dict[best - 1] : ' ';
          confSum += bestP; confN++;
        }
        last = best;
      }
      out[it.i] = { text: text.trim(), conf: confN ? confSum / confN : 0 };
    });
    await new Promise((r) => setTimeout(r, 0));   // let progress messages through
  }
  return out;
}

/** Reads a receipt photo: the text boxes with their positions, in reading order. */
export async function read(bitmap, progress = () => {}) {
  await init();
  const t0 = Date.now();
  let src = toCanvas(bitmap);
  let found = await detect(src);
  // A photo taken at a slight angle: straighten it and look again (lines then stay on one row).
  if (Math.abs(found.angle) > 0.7 && Math.abs(found.angle) < 20) {
    src = toCanvas(bitmap, -found.angle);
    found = await detect(src);
  }
  progress({ stage: 'read', boxes: found.boxes.length });
  const t1 = Date.now();
  const texts = await recognise(src, found.boxes);
  // Lines the reader was unsure of get a second look (each clean-up in turn, only on the lines still unsure).
  for (const filter of RECHECKS) {
    const weak = texts.map((t, i) => (t.text && t.conf < RETRY_CONF ? i : -1)).filter((i) => i >= 0)
      .sort((a, b) => texts[a].conf - texts[b].conf).slice(0, RETRY_MAX);
    if (!weak.length) break;
    progress({ stage: 'recheck', boxes: weak.length });
    const again = await recognise(src, weak.map((i) => found.boxes[i]), filter);
    weak.forEach((i, k) => { if (betterReading(texts[i], again[k])) texts[i] = again[k]; });
  }
  const boxes = found.boxes.map((b, i) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), text: texts[i].text, conf: Math.round(texts[i].conf * 1000) / 1000 }))
    .filter((b) => b.text);
  // The straightened photo goes back too: the review screen shows each line's strip of it.
  let image = null;
  try { image = typeof src.transferToImageBitmap === 'function' ? src.transferToImageBitmap() : await createImageBitmap(src); } catch { /* preview only */ }
  return { width: src.width, height: src.height, boxes, image, ms: { detect: t1 - t0, read: Date.now() - t1 } };
}
