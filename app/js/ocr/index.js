// The page's side of the OCR: one worker, reused; falls back to the page itself where workers can't draw (older phones).
import { CACHE } from './engine-meta.js';

let worker = null, seq = 0, idleTimer = null, broken = 0;
const waiting = new Map();
const IDLE_MS = 2 * 60 * 1000, STALL_MS = 90 * 1000;

/** Can this phone run the reader? (WebAssembly with SIMD: iOS 16.4+, recent Android Chrome.) */
export function supported() {
  try {
    if (typeof WebAssembly !== 'object' || typeof createImageBitmap !== 'function') return false;
    // A tiny module using a SIMD instruction: only engines with SIMD accept it.
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch { return false; }
}

/** Frees the reader (100+ MB) when it hasn't been used for a while, or after an error. */
function stopWorker() {
  clearTimeout(idleTimer);
  if (worker) { try { worker.terminate(); } catch { /* ignore */ } }
  worker = null;
}
export function cancel() {
  waiting.forEach((w) => w.reject(Object.assign(new Error('cancelled'), { kind: 'cancelled' })));
  waiting.clear();
  stopWorker();
}

function startWorker() {
  if (worker) return worker;
  if (broken >= 2) return false;   // the worker keeps failing on this phone: run on the page instead
  try {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('no OffscreenCanvas');
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      if (e.data.type === 'progress') { w.onProgress(e.data); w.touch(); return; }
      waiting.delete(e.data.id);
      w.done();
      if (e.data.type === 'error') w.reject(Object.assign(new Error(e.data.message), { kind: e.data.kind || 'read' })); else w.resolve(e.data.result);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(stopWorker, IDLE_MS);
    };
    worker.onerror = () => {
      broken++;
      waiting.forEach((w) => w.reject(Object.assign(new Error('worker stopped'), { kind: 'crash' })));
      waiting.clear();
      stopWorker();
    };
  } catch { return false; }
  return worker;
}

function ask(type, payload, onProgress, transfer) {
  const w = startWorker();
  if (!w) return onPage(type, payload, onProgress);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    // No word from the reader for 90 s (the phone ran out of memory and the worker died quietly): give up.
    let stall = null;
    const touch = () => { clearTimeout(stall); stall = setTimeout(() => {
      waiting.delete(id); broken++; stopWorker(); reject(Object.assign(new Error('no answer'), { kind: 'stalled' }));
    }, STALL_MS); };
    touch();
    waiting.set(id, { resolve, reject, onProgress: onProgress || (() => {}), touch, done: () => clearTimeout(stall) });
    w.postMessage({ id, type, ...payload }, transfer || []);
  });
}

async function onPage(type, payload, onProgress = () => {}) {
  const engine = await import('./engine.js');
  if (type === 'init') return engine.init((p) => onProgress({ stage: 'download', p }));
  await engine.init((p) => onProgress({ stage: 'download', p }));
  return engine.read(payload.bitmap, onProgress);
}

/** Is the reader already on this phone (no download needed)? */
export async function isDownloaded() {
  try {
    const c = await caches.open(CACHE);
    return !!(await c.match(new URL('../../vendor/ocr/rec-th.onnx', import.meta.url).href));
  } catch { return false; }
}

/** Gets the reader ready (downloads it the first time). onProgress({ stage: 'download', p: 0–1 }). */
export function prepare(onProgress) { return ask('init', {}, onProgress); }

/** Reads a photo (File or Blob) → { width, height, boxes: [{ x, y, w, h, text, conf }] }. */
export async function readImage(file, onProgress) {
  const bitmap = await decode(file);
  return ask('read', { bitmap }, onProgress, [bitmap]);
}

/** The photo as an ImageBitmap the right way up; older engines don't take the orientation option, some can't open HEIC. */
async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* try plainer ways */ }
  try { return await createImageBitmap(file); } catch { /* next */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return await createImageBitmap(c);
  } catch {
    throw Object.assign(new Error('cannot open photo'), { kind: 'photo' });
  } finally { URL.revokeObjectURL(url); }
}
