// Restore an owner's backup file into a NEW, EMPTY Supabase database.
//
//   node tools/supabase_restore.mjs <backup-file.json>
//
// Order for a new project: `npx supabase db push --remote` → this script → `node tools/supabase_setup.mjs --reset-owner`.
// It refuses to touch a database that already has data. Passwords are not in backups: the owner gets a new
// one from --reset-owner, then resets staff passwords in the app (More → Team).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import readline from 'node:readline/promises';

const require = createRequire(import.meta.url);
globalThis.RestoCosting = require('../app/js/costing.js');
globalThis.RestoPricing = require('../app/js/pricing.js');
globalThis.RestoCore = require('../app/js/core.js');
const H = require('../server/handler.js');
const { postgresDeps } = require('../server/pgjs.js');
const postgres = require('postgres');

const file = process.argv.find((a) => a.endsWith('.json'));
if (!file) {
  console.error('ใส่ไฟล์สำรองข้อมูลด้วย / Give the backup file: node tools/supabase_restore.mjs restaurant-ops-backup-YYYY-MM-DD.json');
  process.exit(1);
}
let backup;
try { backup = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
  console.error('อ่านไฟล์ไม่ได้ / Could not read the file:', e.message);
  process.exit(1);
}
const rows = backup && backup.counts ? Object.values(backup.counts).reduce((a, n) => a + n, 0) : 0;
console.log(`\nไฟล์สำรอง / Backup: ${backup.restaurantName || '?'} · ${String(backup.exportedAt || '').slice(0, 16)} · ${rows} rows · v${backup.version || '?'}\n`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let url = process.env.SUPABASE_DB_URL;
if (!url) url = (await rl.question('วางที่อยู่ฐานข้อมูล (connection string URI) / Paste the database URI: ')).trim();
if (!process.argv.includes('--yes')) {
  const ok = (await rl.question('พิมพ์ RESTORE เพื่อยืนยัน / Type RESTORE to confirm: ')).trim();
  if (ok !== 'RESTORE') { console.log('ยกเลิกแล้ว / Cancelled.'); process.exit(1); }
}
rl.close();

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });
try {
  const r = await H.restoreBackup(postgresDeps(sql), backup);
  console.log(`\nกู้ข้อมูลแล้ว ${r.rows} แถว / Restored ${r.rows} rows.\n` +
    'ต่อไป / Next: node tools/supabase_setup.mjs --reset-owner  (รหัสผ่านใหม่ของเจ้าของร้าน / a new owner password)\n');
} catch (e) {
  console.error('\nกู้ข้อมูลไม่สำเร็จ / Restore failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
