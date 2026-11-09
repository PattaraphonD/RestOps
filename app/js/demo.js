// Demo backend: runs the real business logic (core.js) against localStorage,
// pre-filled with two months of realistic data for a fictional Thai restaurant.
// The sample data is created in the app's current language (English or Thai).
/* global RestoCore */
import { getLang, defaults, t } from './i18n.js';

const KEY = 'ro.demo.db.v1';
export const DEMO_PASSWORD = 'demo1234';

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

function localDb() {
  let data;
  try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { data = null; }
  if (!data) data = { tables: {}, sessions: {} };
  let deferred = false;
  const save = () => {
    if (deferred) return;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota: keep in memory */ }
  };
  const tbl = (name) => (data.tables[name] ||= []);
  return {
    data,
    defer(on) { deferred = on; if (!on) save(); },
    read: (name) => tbl(name).map((r) => ({ ...r })),
    append(name, rows) { rows.forEach((r) => tbl(name).push({ ...r })); save(); },
    updateWhere(name, pred, patch) {
      let n = 0;
      tbl(name).forEach((r) => { if (pred({ ...r })) { Object.assign(r, patch); n++; } });
      save();
      return n;
    },
    removeWhere(name, pred) {
      const before = tbl(name).length;
      data.tables[name] = tbl(name).filter((r) => !pred({ ...r }));
      save();
      return before - data.tables[name].length;
    },
    lock: (fn) => fn(),
    sessions: {
      get(k) { const s = data.sessions[k]; return s && s.exp > Date.now() ? s.v : null; },
      put(k, v, ttl) { data.sessions[k] = { v: String(v), exp: Date.now() + ttl * 1000 }; save(); },
      remove(k) { delete data.sessions[k]; save(); },
    },
  };
}

export function resetDemoData() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export async function createDemoTransport() {
  const db = localDb();
  const api = RestoCore.createApi({ db, sessions: db.sessions, uuid, now: () => new Date() });
  if (!db.data.seeded) {
    db.defer(true);
    seed(api, db, getLang());
    db.data.seeded = true;
    db.data.lang = getLang();
    db.defer(false);
  }
  return async (req) => {
    await new Promise((r) => setTimeout(r, 120)); // feel like a network call
    return api.handle(JSON.parse(JSON.stringify(req)));
  };
}

/* ------------------------------------------------------------------ seed */

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Category and unit keys map to the per-language default lists in i18n.js.
const ICAT = { meat: 0, produce: 1, dairy: 2, dry: 3, sauce: 4, bev: 5, pack: 6 };
const MCAT = { mains: 0, noodles: 1, starters: 2, desserts: 3, drinks: 4 };
const UNIT = { kg: 0, L: 2, pcs: 4, can: 7 };

// lead = delivery days, terms = payment terms in days. Produce is bought at the market (no orders).
const SUPPLIERS = [
  { key: 'meat', en: ['Siam Fresh Meats', 'Khun Somchai'], th: ['สยามเฟรชมีท', 'คุณสมชาย'], phone: '02-555-0101', email: 'orders@example.com', lead: 1, terms: 7 },
  { key: 'sea', en: ['Gulf Coast Seafood', 'Khun Nok'], th: ['อ่าวไทยซีฟู้ด', 'คุณนก'], phone: '02-555-0102', email: 'sales@example.com', lead: 1, terms: 7 },
  { key: 'veg', en: ['Talad Thai Produce', 'Khun Malee'], th: ['ตลาดไทยผักสด', 'คุณมาลี'], phone: '02-555-0103', email: '', lead: 0, terms: 0 },
  { key: 'dry', en: ['Rungrueang Wholesale', 'Account desk'], th: ['ค้าส่งรุ่งเรือง', 'ฝ่ายบัญชี'], phone: '02-555-0104', email: 'b2b@example.com', lead: 2, terms: 30 },
];

// [key, English name, Thai name, category, unit, cost, supplier]
const INGREDIENTS = [
  ['chicken', 'Chicken thigh', 'สะโพกไก่', 'meat', 'kg', 95, 'meat'],
  ['pork', 'Pork shoulder', 'สันคอหมู', 'meat', 'kg', 140, 'meat'],
  ['shrimp', 'Shrimp (white, 31/40)', 'กุ้งขาว (31/40)', 'meat', 'kg', 320, 'sea'],
  ['egg', 'Eggs', 'ไข่ไก่', 'dairy', 'pcs', 4.5, 'dry'],
  ['rice', 'Jasmine rice', 'ข้าวหอมมะลิ', 'dry', 'kg', 38, 'dry'],
  ['sticky', 'Sticky rice', 'ข้าวเหนียว', 'dry', 'kg', 45, 'dry'],
  ['noodle', 'Rice noodles (sen lek)', 'เส้นเล็ก', 'dry', 'kg', 45, 'dry'],
  ['garlic', 'Garlic', 'กระเทียม', 'produce', 'kg', 80, 'veg'],
  ['basil', 'Holy basil', 'ใบกะเพรา', 'produce', 'kg', 60, 'veg'],
  ['chili', "Bird's eye chili", 'พริกขี้หนู', 'produce', 'kg', 90, 'veg'],
  ['lime', 'Lime', 'มะนาว', 'produce', 'kg', 60, 'veg'],
  ['sprout', 'Bean sprouts', 'ถั่วงอก', 'produce', 'kg', 30, 'veg'],
  ['mango', 'Mango (nam dok mai)', 'มะม่วงน้ำดอกไม้', 'produce', 'kg', 70, 'veg'],
  ['fishsauce', 'Fish sauce', 'น้ำปลา', 'sauce', 'L', 55, 'dry'],
  ['oyster', 'Oyster sauce', 'ซอสหอยนางรม', 'sauce', 'L', 90, 'dry'],
  ['paste', 'Green curry paste', 'พริกแกงเขียวหวาน', 'sauce', 'kg', 180, 'dry'],
  ['coconut', 'Coconut milk', 'กะทิ', 'dairy', 'L', 70, 'dry'],
  ['sugar', 'Palm sugar', 'น้ำตาลปี๊บ', 'dry', 'kg', 25, 'dry'],
  ['oil', 'Vegetable oil', 'น้ำมันพืช', 'dry', 'L', 50, 'dry'],
  ['tea', 'Thai tea leaves', 'ใบชาไทย', 'bev', 'kg', 350, 'dry'],
  ['milk', 'Evaporated milk', 'นมข้นจืด', 'dairy', 'L', 80, 'dry'],
  ['cola', 'Cola (can)', 'โคล่า (กระป๋อง)', 'bev', 'can', 14, 'dry'],
  ['cup', 'Takeaway cups', 'แก้วเทคอะเวย์', 'pack', 'pcs', 2.5, 'dry'],
];

// [key, English name, Thai name, category, price, base daily qty, recipe {ingredientKey: qty}]
const MENU = [
  ['kraprao', 'Holy Basil Chicken & Rice', 'กะเพราไก่ราดข้าว', 'noodles', 89, 22, { chicken: 0.15, rice: 0.12, basil: 0.02, chili: 0.01, garlic: 0.01, oil: 0.02, fishsauce: 0.01, oyster: 0.01, egg: 1 }],
  ['curry', 'Green Curry Chicken', 'แกงเขียวหวานไก่', 'mains', 139, 12, { chicken: 0.18, paste: 0.04, coconut: 0.2, basil: 0.01, rice: 0.12, fishsauce: 0.01, sugar: 0.01 }],
  ['padthai', 'Pad Thai with Shrimp', 'ผัดไทยกุ้งสด', 'noodles', 149, 15, { noodle: 0.12, shrimp: 0.1, egg: 1, sprout: 0.05, oil: 0.02, fishsauce: 0.01, sugar: 0.02, lime: 0.02 }],
  ['tomyum', 'Tom Yum Shrimp Soup', 'ต้มยำกุ้ง', 'starters', 189, 7, { shrimp: 0.15, lime: 0.03, chili: 0.01, fishsauce: 0.02 }],
  ['friedrice', 'Pork Fried Rice', 'ข้าวผัดหมู', 'noodles', 99, 14, { rice: 0.15, pork: 0.12, egg: 1, oil: 0.02, garlic: 0.01, fishsauce: 0.01 }],
  ['garlicpork', 'Garlic Pepper Pork & Rice', 'หมูกระเทียมพริกไทยราดข้าว', 'mains', 109, 9, { pork: 0.16, garlic: 0.03, rice: 0.12, oil: 0.02, oyster: 0.01 }],
  ['mango', 'Mango Sticky Rice', 'ข้าวเหนียวมะม่วง', 'desserts', 119, 8, { mango: 0.25, sticky: 0.1, coconut: 0.1, sugar: 0.03 }],
  ['tea', 'Thai Iced Tea', 'ชาไทยเย็น', 'drinks', 55, 25, { tea: 0.015, milk: 0.05, sugar: 0.03, cup: 1 }],
  ['cola', 'Cola', 'โคล่า', 'drinks', 35, 18, { cola: 1 }],
];

function seed(api, db, lang) {
  const TH = lang === 'th';
  const tx = (en, th) => (TH ? th : en);
  const r = rng(20261107);
  const today = localToday();
  const D = RestoCore.util.addDays;
  const round = RestoCore.util.round;
  const icats = defaults('ingredientCategories', lang);
  const mcats = defaults('menuCategories', lang);
  const units = defaults('units', lang);
  const channels = defaults('salesChannels', lang);
  const pay = defaults('paymentMethods', lang);
  const expCats = defaults('expenseCategories', lang); // 0 rent, 1 wages, 2 utilities, 3 gas, 4 packaging, 5 cleaning, 6 marketing, 7 repairs

  api.initialize({ ownerUsername: 'owner', ownerPassword: DEMO_PASSWORD, ownerName: tx('Pim (Owner)', 'พิม (เจ้าของร้าน)'),
    restaurantName: 'Saffron & Sage', lang });
  const owner = db.read('Users')[0];
  const as = (action, payload) => api.runAs(owner, action, payload);

  as('settings.save', { values: { restaurantName: 'Saffron & Sage', currency: 'THB',
    salesChannels: channels.join(', '), expenseCategories: expCats.join(', '), ingredientCategories: icats.join(', '),
    menuCategories: mcats.join(', '), units: units.join(', ') } });
  as('users.save', { item: { username: 'manager', displayName: tx('Arthit (Manager)', 'อาทิตย์ (ผู้จัดการ)'), role: 'manager', password: DEMO_PASSWORD } });
  as('users.save', { item: { username: 'staff', displayName: tx('Ploy (Kitchen)', 'พลอย (ครัว)'), role: 'staff', password: DEMO_PASSWORD } });

  const sup = {};
  SUPPLIERS.forEach((s) => {
    const [name, contactName] = TH ? s.th : s.en;
    sup[s.key] = as('suppliers.save', { item: { name, contactName, phone: s.phone, email: s.email,
      leadTimeDays: s.lead, paymentTermsDays: s.terms } }).id;
  });

  // Average daily usage → sensible minimum levels.
  const usage = {};
  MENU.forEach(([, , , , , base, recipe]) => Object.entries(recipe).forEach(([k, q]) => { usage[k] = (usage[k] || 0) + q * base; }));
  const isCount = (unitKey) => unitKey === 'pcs' || unitKey === 'can';
  const ing = {}, unitOf = {};
  INGREDIENTS.forEach(([key, en, th, cat, unit, cost, s]) => {
    const minLevel = isCount(unit) ? Math.ceil(usage[key] * 1.5) : Math.max(0.3, round(usage[key] * 1.5, 1));
    const parLevel = isCount(unit) ? Math.ceil(usage[key] * 6 / 12) * 12 : Math.ceil(usage[key] * 6 * 2) / 2;
    ing[key] = as('ingredients.save', { item: { name: tx(en, th), category: icats[ICAT[cat]], unit: units[UNIT[unit]],
      costPerUnit: cost, minLevel, parLevel, supplierId: sup[s] } }).id;
    unitOf[key] = unit;
  });

  const dish = {};
  MENU.forEach(([key, en, th, cat, price, , recipe]) => {
    dish[key] = as('menu.save', {
      item: { name: tx(en, th), category: mcats[MCAT[cat]], price },
      recipe: Object.entries(recipe).map(([k, q]) => ({ ingredientId: ing[k], qty: q })),
    }).id;
  });

  const start = D(today, -62);
  // Restock everything up to ~7.5 days of usage (orders go out Monday and Thursday).
  // Market produce is bought on the spot; other suppliers go through the full
  // order → delivery → invoice → payment cycle, with the odd short delivery or price rise.
  const supplierTerms = Object.fromEntries(SUPPLIERS.map((x) => [x.key, x.terms]));
  const invoices = [];
  let invSeq = 1000;
  const restockLines = (keys) => {
    const levels = Object.fromEntries(as('stock.levels').map((s) => [s.id, s.onHand]));
    const bySupplier = {};
    keys.forEach((k) => {
      const target = usage[k] * 7.5;
      const have = levels[ing[k]] || 0;
      let q = Math.max(0, target - have);
      q = isCount(unitOf[k]) ? Math.ceil(q / 12) * 12 : Math.ceil(q * 2) / 2;
      if (q <= 0) return;
      const base = INGREDIENTS.find((x) => x[0] === k);
      const price = round(base[5] * (0.94 + r() * 0.14), 2);
      (bySupplier[base[6]] ||= []).push({ ingredientId: ing[k], qty: q, unitCost: price });
    });
    return bySupplier;
  };
  const buy = (date, keys, { receive = true } = {}) => {
    Object.entries(restockLines(keys)).forEach(([s, lines]) => {
      if (s === 'veg') {
        as('purchases.add', { date, supplierId: sup[s], lines, invoiceRef: tx('Market receipt', 'บิลตลาด') });
        return;
      }
      const po = as('po.save', { send: true, item: { supplierId: sup[s], orderDate: D(date, -1), expectedDate: date },
        lines: lines.map((l) => ({ ingredientId: l.ingredientId, qtyOrdered: l.qty, unitPrice: l.unitCost })) });
      if (!receive) return;
      const short = r() < 0.12;
      as('po.receive', { poId: po.id, date, deliveryRef: 'DN-' + po.poNumber.slice(2),
        lines: po.lines.map((l, i) => ({ poLineId: l.id, qty: short && i === 0 ? round(l.qtyOrdered * 0.8, 2) : l.qtyOrdered, unitPrice: l.unitPrice })) });
      if (short) as('po.close', { id: po.id, reason: tx('Supplier out of stock', 'ซัพพลายเออร์ของหมด') });
      // The supplier's invoice: usually exact; sometimes a price rise or billing the full order after a short delivery.
      // Always leave at least one recent invoice with a price rise, so there is something to review.
      const forceRise = date > D(today, -6) && !buy.forced;
      if (forceRise) buy.forced = true;
      const priceRise = forceRise || r() < 0.1;
      const billFull = short && r() < 0.6;
      const invLines = po.lines.map((l, i) => ({
        ingredientId: l.ingredientId,
        qty: short && i === 0 && !billFull ? round(l.qtyOrdered * 0.8, 2) : l.qtyOrdered,
        unitPrice: priceRise && i === po.lines.length - 1 ? round(l.unitPrice * 1.08, 2) : l.unitPrice,
      }));
      const inv = as('invoices.save', { item: { supplierId: sup[s], poId: po.id, invoiceNo: `${s.toUpperCase()}-${invSeq++}`, invoiceDate: date }, lines: invLines });
      invoices.push({ ...inv, terms: supplierTerms[s] });
    });
  };

  const allKeys = INGREDIENTS.map((x) => x[0]);
  as('purchases.add', { date: start, lines: Object.values(restockLines(allKeys)).flat(), invoiceRef: tx('Opening stock', 'สต็อกยกมา') });
  const wasteReasons = ['stock.reasonSpoiled', 'stock.reasonExpired', 'stock.reasonDropped', 'stock.reasonOverprep'].map((k) => t(k));

  for (let d = start; d <= today; d = D(d, 1)) {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    const isToday = d === today;
    const weekend = dow === 5 || dow === 6 || dow === 0 ? 1.35 : 1;
    const dayFactor = (isToday ? 0.45 : 1) * weekend * (0.85 + r() * 0.3);

    // Restock every Mon / Thu (and skip shrimp & basil in the last few days so alerts show up).
    if ((dow === 1 || dow === 4) && d !== start) {
      const late = d > D(today, -5);
      buy(d, allKeys.filter((k) => !(late && (k === 'shrimp' || k === 'basil'))));
    }

    // Sales in two channels.
    const dine = [], delivery = [];
    MENU.forEach(([key, , , , , base]) => {
      const n = Math.max(0, Math.round(base * dayFactor * (0.8 + r() * 0.4)));
      const split = Math.round(n * (0.55 + r() * 0.15));
      if (split) dine.push({ menuItemId: dish[key], qty: split });
      if (n - split) delivery.push({ menuItemId: dish[key], qty: n - split });
    });
    if (dine.length) as('sales.add', { date: d, channel: channels[0], lines: dine });
    if (delivery.length) as('sales.add', { date: d, channel: channels[2], lines: delivery });

    // Waste a few times a week.
    if (r() < 0.35) {
      const k = ['basil', 'sprout', 'mango', 'lime', 'chicken'][Math.floor(r() * 5)];
      as('movements.add', { date: d, type: 'waste', reason: wasteReasons[Math.floor(r() * 4)],
        lines: [{ ingredientId: ing[k], qty: round(Math.max(0.1, usage[k] * (0.05 + r() * 0.15)), 2) }] });
    }
    // Staff meals.
    if (dow === 3) {
      as('movements.add', { date: d, type: 'usage', reason: tx('Staff meal', 'อาหารพนักงาน'),
        lines: [{ ingredientId: ing.rice, qty: 1.5 }, { ingredientId: ing.chicken, qty: 1 }] });
    }
    // Weekly stock count (Sunday) on high-value items, with small variance.
    if (dow === 0 && !isToday) {
      const levels = Object.fromEntries(as('stock.levels').map((s) => [s.id, s.onHand]));
      as('movements.add', { date: d, type: 'count', reason: tx('Weekly count', 'นับประจำสัปดาห์'),
        lines: ['chicken', 'pork', 'shrimp'].map((k) => ({ ingredientId: ing[k], qty: round(Math.max(0, levels[ing[k]] * (0.96 + r() * 0.04)), 2) })) });
    }

    // Expenses.
    const day = Number(d.slice(8));
    const exp = (cat, description, amount, method = pay[1]) =>
      as('expenses.add', { date: d, category: expCats[cat], description, amount: round(amount, 0), paymentMethod: method });
    if (day === 1) {
      exp(0, tx('Shop rent', 'ค่าเช่าร้าน'), 45000);
      exp(1, tx('Payroll (1st half)', 'เงินเดือน (งวดแรก)'), 52000);
      exp(6, tx('Delivery app promotion', 'โปรโมชันแอปเดลิเวอรี่'), 3000 + r() * 1500, pay[2]);
    }
    if (day === 16) exp(1, tx('Payroll (2nd half)', 'เงินเดือน (งวดสอง)'), 52000);
    if (day === 5) exp(2, tx('Electricity & water', 'ค่าไฟและค่าน้ำ'), 8200 + r() * 1800);
    if (dow === 2) exp(3, tx('LPG refill', 'เติมแก๊ส LPG'), 1150 + r() * 150, pay[0]);
    if (dow === 6 && !isToday) exp(4, tx('Delivery bags & containers', 'ถุงและกล่องเดลิเวอรี่'), 1600 + r() * 600, pay[0]);
    if (day === 20) exp(5, tx('Cleaning supplies', 'อุปกรณ์ทำความสะอาด'), 900 + r() * 400, pay[0]);
    if (r() < 0.03) exp(7, tx('Fridge service', 'ซ่อมตู้เย็น'), 2500, pay[0]);
  }

  // Settle supplier bills: older ones are approved (if they had issues) and paid on their due date;
  // recent ones wait. One past-due bill is left unpaid so the payables view has something to chase.
  const overdueOne = invoices.filter((i) => i.status === 'matched' && i.terms > 0 && i.dueDate < today).pop();
  invoices.forEach((inv) => {
    const age = (new Date(today) - new Date(inv.invoiceDate)) / 86400000;
    if (inv.status === 'exception') {
      if (age < 12) return;                                    // still to review
      if (!seed.disputed) { seed.disputed = true; as('invoices.dispute', { id: inv.id, note: tx('Waiting for credit note', 'รอใบลดหนี้') }); return; }
      as('invoices.approve', { id: inv.id, note: tx('Price increase confirmed by phone', 'ยืนยันการขึ้นราคาทางโทรศัพท์แล้ว') });
    }
    if (inv === overdueOne || inv.dueDate >= today) return;
    as('invoices.pay', { id: inv.id, date: inv.dueDate, method: pay[1], reference: 'TRF' + inv.invoiceNo.replace(/\D/g, '') });
  });
  // Today's purchasing state: a delivery due today, and a draft order waiting to be sent.
  buy(today, ['shrimp', 'pork'], { receive: false });
  const draft = restockLines(['oil', 'sugar', 'fishsauce', 'cup']);
  if (draft.dry) {
    as('po.save', { item: { supplierId: sup.dry, orderDate: today }, lines: draft.dry.map((l) => ({ ingredientId: l.ingredientId, qtyOrdered: Math.max(l.qty, 2), unitPrice: l.unitCost })) });
  }
}
