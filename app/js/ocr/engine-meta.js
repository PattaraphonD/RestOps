// Shared without loading the OCR runtime (the page imports this; the heavy engine loads only when scanning).
// Named after the runtime and model versions: a new runtime or model gets a fresh cache (the old one is removed).
export const CACHE = 'resto-ocr-ort1.22.0-ppocrv5-th-v1';
export const CACHE_PREFIX = 'resto-ocr-';

/**
 * Whether a second reading of a line replaces the first: there was text to begin with, the new reading is fairly sure
 * of itself (≥ 0.6) and surer than the first, it isn't shorter, and it keeps every digit ("1305.50" → "305.50" is
 * surer of less, not better).
 */
export function betterReading(was, again) {
  if (!was.text || !again.text || again.conf < 0.6 || again.conf <= was.conf + 0.03) return false;
  const chars = (t) => t.replace(/\s/g, '').length, digits = (t) => (t.match(/\d/g) || []).length;
  if (chars(again.text) < chars(was.text) * 0.85) return false;
  if (digits(was.text) && digits(again.text) !== digits(was.text)) return false;
  return true;
}
