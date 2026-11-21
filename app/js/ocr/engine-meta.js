// Shared without loading the OCR runtime (the page imports this; the heavy engine loads only when scanning).
// Named after the runtime and model versions: a new runtime or model gets a fresh cache (the old one is removed).
export const CACHE = 'resto-ocr-ort1.22.0-ppocrv5-th-v1';
export const CACHE_PREFIX = 'resto-ocr-';
