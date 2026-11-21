// Runs the OCR off the page's thread, so the screen stays smooth while a receipt is read.
import { init, read } from './engine.js';

self.onmessage = async (e) => {
  const { id, type, bitmap } = e.data || {};
  const say = (msg) => self.postMessage({ id, ...msg });
  try {
    if (type === 'init') {
      await init((p) => say({ type: 'progress', stage: 'download', p }));
      say({ type: 'done', result: true });
    } else if (type === 'read') {
      await init((p) => say({ type: 'progress', stage: 'download', p }));
      const result = await read(bitmap, (p) => say({ type: 'progress', ...p }));
      bitmap.close && bitmap.close();
      self.postMessage({ id, type: 'done', result }, result.image ? [result.image] : []);
    }
  } catch (err) {
    say({ type: 'error', kind: (err && err.kind) || (/memory|allocation|RangeError/i.test(String(err && err.message)) ? 'memory' : 'read'), message: String(err && err.message ? err.message : err) });
  }
};
