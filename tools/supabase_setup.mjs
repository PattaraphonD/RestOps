// One-time setup of the Supabase database, run by the owner on their own computer.
//
//   node tools/supabase_setup.mjs                 create default settings and the first owner account
//   node tools/supabase_setup.mjs --reset-owner   give the owner a new temporary password
//
// It asks for the database connection string (Supabase → Project Settings → Database →
// Connection string → URI, with your database password filled in). Nothing is saved to disk.
// The tables must exist first: `npx supabase db push --remote` (see docs/SUPABASE.md).
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline/promises';

const require = createRequire(import.meta.url);
globalThis.RestoCosting = require('../app/js/costing.js');
globalThis.RestoPricing = require('../app/js/pricing.js');
globalThis.RestoCore = require('../app/js/core.js');
const H = require('../server/handler.js');
const { postgresDeps } = require('../server/pgjs.js');
const postgres = require('postgres');

const reset = process.argv.includes('--reset-owner');
let url = process.env.SUPABASE_DB_URL;
if (!url) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  url = (await rl.question('วางที่อยู่ฐานข้อมูล (connection string URI) / Paste the database URI: ')).trim();
  rl.close();
}
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error('ที่อยู่ต้องขึ้นต้นด้วย postgresql:// / The URI must start with postgresql://');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });
const deps = postgresDeps(sql);
const password = randomBytes(9).toString('base64url').slice(0, 12);

try {
  const [{ ok }] = await sql`select to_regclass('public."Settings"') is not null as ok`;
  if (!ok) {
    console.error('ยังไม่มีตารางในฐานข้อมูล ให้รัน: npx supabase db push --remote\nThe tables are missing. Run: npx supabase db push --remote');
    process.exit(1);
  }
  if (reset) {
    const who = await H.resetOwnerPassword(deps, password);
    console.log(`\nรหัสผ่านใหม่ของ "${who.username}" / New password for "${who.username}": ${password}\n` +
      'เข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านที่ เพิ่มเติม → บัญชีของฉัน / Sign in and change it under More → My account.\n');
  } else {
    const result = await H.setupDatabase(deps, { ownerUsername: 'owner', ownerPassword: password, ownerName: 'เจ้าของร้าน', lang: 'th' });
    if (result.ownerCreated) {
      console.log('\nตั้งค่าเสร็จแล้ว / Setup complete\n\nเข้าสู่ระบบด้วย / Sign in with:\n' +
        `  ชื่อผู้ใช้ / Username: owner\n  รหัสผ่าน / Password: ${password}\n\n` +
        'เปลี่ยนรหัสผ่านนี้ในแอป (เพิ่มเติม → บัญชีของฉัน) / Change it in the app (More → My account).\n');
    } else {
      console.log('\nฐานข้อมูลพร้อมแล้ว และมีบัญชีเจ้าของร้านอยู่แล้ว (ไม่ได้เปลี่ยนอะไร)\n' +
        'The database is ready and an owner already exists (nothing changed). Use --reset-owner for a new password.\n');
    }
  }
} catch (e) {
  console.error('ตั้งค่าไม่สำเร็จ / Setup failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
