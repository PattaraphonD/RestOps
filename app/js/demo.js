// Demo backend: runs the real business logic (core.js) against localStorage,
// pre-filled with two months of realistic data for a fictional Thai restaurant.
// The sample data is created in the app's current language (English or Thai).
/* global RestoCore, RestoCosting */
import { getLang, defaults, t } from './i18n.js';

const KEY = 'ro.demo.db.v8';
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
const UNIT = { kg: 0, L: 2, pcs: 4, bottle: 6, can: 7 };
// The same units as costing.js codes, for planning in plain numbers.
const UNIT_CODE = { kg: 'kg', L: 'l', pcs: 'pcs', can: 'can' };

// lead = delivery days, terms = payment terms in days. Produce is bought at the market (no orders).
const SUPPLIERS = [
  { key: 'meat', en: ['Siam Fresh Meats', 'Khun Somchai'], th: ['สยามเฟรชมีท', 'คุณสมชาย'], phone: '02-555-0101', email: 'orders@example.com', lead: 1, terms: 7 },
  { key: 'sea', en: ['Gulf Coast Seafood', 'Khun Nok'], th: ['อ่าวไทยซีฟู้ด', 'คุณนก'], phone: '02-555-0102', email: 'sales@example.com', lead: 1, terms: 7 },
  { key: 'veg', en: ['Talad Thai Produce', 'Khun Malee'], th: ['ตลาดไทยผักสด', 'คุณมาลี'], phone: '02-555-0103', email: '', lead: 0, terms: 0 },
  { key: 'dry', en: ['Rungrueang Wholesale', 'Account desk'], th: ['ค้าส่งรุ่งเรือง', 'ฝ่ายบัญชี'], phone: '02-555-0104', email: 'b2b@example.com', lead: 2, terms: 30 },
];

// [key, English name, Thai name, category, unit, cost, supplier, yield %]
// Yield is the usable share after trimming, peeling or juicing (none = 100 %).
const INGREDIENTS = [
  ['chicken', 'Chicken thigh', 'สะโพกไก่', 'meat', 'kg', 95, 'meat', 90],
  ['pork', 'Pork shoulder', 'สันคอหมู', 'meat', 'kg', 140, 'meat'],
  ['bones', 'Chicken carcass/bones', 'โครงไก่', 'meat', 'kg', 25, 'meat'],
  ['fat', 'Chicken fat', 'มันไก่', 'meat', 'kg', 40, ''],
  ['shrimp', 'Shrimp (white, 31/40)', 'กุ้งขาว (31/40)', 'meat', 'kg', 320, 'sea', 85],
  ['egg', 'Eggs', 'ไข่ไก่', 'dairy', 'pcs', 4.5, 'dry'],
  ['rice', 'Jasmine rice', 'ข้าวหอมมะลิ', 'dry', 'kg', 38, 'dry'],
  ['sticky', 'Sticky rice', 'ข้าวเหนียว', 'dry', 'kg', 45, 'dry'],
  ['noodle', 'Rice noodles (sen lek)', 'เส้นเล็ก', 'dry', 'kg', 45, 'dry'],
  ['garlic', 'Garlic', 'กระเทียม', 'produce', 'kg', 80, 'veg', 85],
  ['basil', 'Holy basil', 'ใบกะเพรา', 'produce', 'kg', 60, 'veg', 70],
  ['chili', "Bird's eye chili", 'พริกขี้หนู', 'produce', 'kg', 90, 'veg'],
  ['lime', 'Lime', 'มะนาว', 'produce', 'kg', 60, 'veg', 45],
  ['sprout', 'Bean sprouts', 'ถั่วงอก', 'produce', 'kg', 30, 'veg', 95],
  ['mango', 'Mango (nam dok mai)', 'มะม่วงน้ำดอกไม้', 'produce', 'kg', 70, 'veg', 60],
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

// Other units an ingredient is used in: 1 unit = factor × stock unit.
// A UNIT key is swapped for the language's own unit name (bottle → ขวด).
const CONVERSIONS = {
  egg: [{ unit: 'g', factor: 1 / 55 }],
  fishsauce: [{ unit: 'bottle', factor: 0.7 }],
};

// Preps made in the kitchen, all measured in litres:
// [key, English name, Thai name, batch (L), kept in stock, shelf life (days),
//  recipe [[ingredientKey, net qty, unit]], production weekdays (0 = Sun … 6 = Sat)]
const PREPS = [
  ['chillioil', 'Chilli oil', 'น้ำมันพริก', 2, true, 30,
    [['oil', 1.6, 'l'], ['chili', 300, 'g'], ['garlic', 200, 'g'], ['sugar', 50, 'g']], [1]],
  ['stock', 'Chicken stock', 'น้ำซุปไก่', 10, true, 4,
    [['bones', 5, 'kg'], ['garlic', 100, 'g']], [1, 4]],
  ['namjim', 'Nam jim seafood sauce', 'น้ำจิ้มซีฟู้ด', 1, true, 5,
    [['garlic', 100, 'g'], ['chili', 100, 'g'], ['lime', 400, 'g'], ['fishsauce', 200, 'ml'], ['sugar', 150, 'g']], [2, 5]],
  ['tomyumbase', 'Tom yum base', 'น้ำต้มยำ', 1, true, 4,
    [['chillioil', 100, 'ml'], ['stock', 0.8, 'l'], ['lime', 100, 'g'], ['chili', 30, 'g'], ['fishsauce', 60, 'ml']], [1, 4]],
  ['sweetcream', 'Sweet coconut cream', 'น้ำกะทิหวาน', 1, false, 2,
    [['coconut', 0.9, 'l'], ['sugar', 150, 'g']], []],
];

// [key, English name, Thai name, category, price, base daily qty, recipe [[ingredientKey, net qty, unit]]]
// Major allergens per ingredient (codes from RestoCosting.ALLERGENS). Dishes and preps derive theirs.
const ALLERGENS = { shrimp: ['crustaceans'], egg: ['eggs'], fishsauce: ['fish'], oyster: ['molluscs', 'soy', 'gluten'],
  milk: ['milk'], paste: ['crustaceans'] };

const MENU = [
  ['kraprao', 'Holy Basil Chicken & Rice', 'กะเพราไก่ราดข้าว', 'noodles', 89, 22, [['chicken', 150, 'g'], ['rice', 120, 'g'],
    ['basil', 20, 'g'], ['chili', 10, 'g'], ['garlic', 10, 'g'], ['oil', 20, 'ml'], ['fishsauce', 15, 'ml'], ['oyster', 10, 'ml'], ['egg', 1, 'pcs']]],
  ['curry', 'Green Curry Chicken', 'แกงเขียวหวานไก่', 'mains', 139, 12, [['chicken', 180, 'g'], ['paste', 40, 'g'],
    ['coconut', 200, 'ml'], ['basil', 10, 'g'], ['rice', 120, 'g'], ['fishsauce', 15, 'ml'], ['sugar', 10, 'g']]],
  ['padthai', 'Pad Thai with Shrimp', 'ผัดไทยกุ้งสด', 'noodles', 149, 15, [['noodle', 120, 'g'], ['shrimp', 90, 'g'], ['egg', 1, 'pcs'],
    ['sprout', 50, 'g'], ['oil', 20, 'ml'], ['fishsauce', 15, 'ml'], ['sugar', 20, 'g'], ['lime', 20, 'g'], ['chillioil', 15, 'ml']]],
  ['tomyum', 'Tom Yum Shrimp Soup', 'ต้มยำกุ้ง', 'starters', 189, 7, [['shrimp', 120, 'g'], ['tomyumbase', 0.3, 'l']]],
  ['friedrice', 'Pork Fried Rice', 'ข้าวผัดหมู', 'noodles', 99, 14, [['rice', 150, 'g'], ['pork', 120, 'g'], ['egg', 1, 'pcs'],
    ['oil', 20, 'ml'], ['garlic', 10, 'g'], ['fishsauce', 10, 'ml'], ['namjim', 20, 'ml']]],
  ['garlicpork', 'Garlic Pepper Pork & Rice', 'หมูกระเทียมพริกไทยราดข้าว', 'mains', 109, 9, [['pork', 160, 'g'], ['garlic', 30, 'g'],
    ['rice', 120, 'g'], ['oil', 20, 'ml'], ['oyster', 10, 'ml']]],
  ['mango', 'Mango Sticky Rice', 'ข้าวเหนียวมะม่วง', 'desserts', 119, 8, [['mango', 200, 'g'], ['sticky', 100, 'g'], ['sweetcream', 0.1, 'l']]],
  ['tea', 'Thai Iced Tea', 'ชาไทยเย็น', 'drinks', 55, 25, [['tea', 15, 'g'], ['milk', 50, 'ml'], ['sugar', 30, 'g'], ['cup', 1, 'pcs']]],
  ['cola', 'Cola', 'โคล่า', 'drinks', 35, 18, [['cola', 1, 'can']]],
];

// Production runs land 88–100 % of the recipe batch; plan with the average.
const RUN_YIELD = 0.94;

// Daily needs worked out from the recipes, in each item's stock unit (gross, trim loss included).
//   usage[raw]  = raw ingredients used per day, through every prep (what purchasing must cover)
//   prepDaily[p] = how much of a stocked prep is used per day by dishes, and by other preps
//                  made on different days (what each production run must cover)
function planUsage() {
  const L = (lines) => lines.map(([k, q, u]) => ({ ingredientId: k, qty: q, unit: u }));
  const book = RestoCosting.buildBook([
    ...INGREDIENTS.map(([key, , , , unit, cost, , y]) => ({ id: key, unit: UNIT_CODE[unit], costPerUnit: cost,
      yieldPct: y || 100, kind: 'raw', conversions: CONVERSIONS[key] || [] })),
    ...PREPS.map(([key, , , batch, track, , lines, days]) => ({ id: key, unit: 'l', yieldPct: 100, kind: 'prep',
      batchQty: batch, trackStock: track, prepLines: L(lines), days })),
  ]);
  // Gross stock-unit amounts one line takes: down to raw ingredients (all) or stopping at stocked preps.
  const takes = (line, mult, all, acc) => {
    const it = book.byId[line.ingredientId];
    const g = RestoCosting.grossQty(RestoCosting.convertQty(line.qty, line.unit, it), it.yieldPct) * mult;
    if (it.kind === 'prep' && (all || !it.trackStock)) {
      const per = g / it.batchQty / (it.trackStock ? RUN_YIELD : 1);
      it.prepLines.forEach((l) => takes(l, per, all, acc));
    } else acc[it.id] = (acc[it.id] || 0) + g;
    return acc;
  };
  const usage = {}, prepDaily = {};
  MENU.forEach(([, , , , , base, recipe]) => L(recipe).forEach((l) => {
    takes(l, base, true, usage);
    takes(l, base, false, prepDaily);
  }));
  // Preps feed other preps: walk consumers before what they consume (PREPS lists ingredients first).
  [...PREPS].reverse().forEach(([key, , , batch, track, , lines, days]) => {
    if (!track || !prepDaily[key]) return;
    L(lines).forEach((l) => {
      const child = book.byId[l.ingredientId];
      // A prep made on the same days as its consumer is planned from that day's runs instead.
      if (child.kind === 'prep' && days.every((d) => child.days.includes(d))) return;
      takes(l, prepDaily[key] / batch / RUN_YIELD, false, prepDaily);
    });
  });
  return { usage, prepDaily, takes, book };
}

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

  // Sales channels: the first bootstrap turns the settings list into records; give them real terms,
  // retire the generic "Delivery" row and add the two delivery apps (rates are typical, not contractual).
  const migrated = as('bootstrap', {}).channels;
  const chan = {};
  chan.dine = as('channels.save', { item: { ...migrated[0], name: channels[0], type: 'dineIn', commissionPct: 0, packagingCost: 0 } }).id;
  chan.take = as('channels.save', { item: { ...migrated[1], name: channels[1], type: 'takeaway', commissionPct: 0, packagingCost: 4 } }).id;
  chan.grab = as('channels.save', { item: { name: 'Grab', type: 'delivery', commissionPct: 30, packagingCost: 6, commissionOnDiscounted: true } }).id;
  chan.lineman = as('channels.save', { item: { name: 'LINE MAN', type: 'delivery', commissionPct: 30, packagingCost: 6, commissionOnDiscounted: true } }).id;
  as('channels.save', { item: { ...migrated[2], active: false } });

  const sup = {};
  SUPPLIERS.forEach((s) => {
    const [name, contactName] = TH ? s.th : s.en;
    sup[s.key] = as('suppliers.save', { item: { name, contactName, phone: s.phone, email: s.email,
      leadTimeDays: s.lead, paymentTermsDays: s.terms } }).id;
  });

  // Average daily usage (preps included) → sensible minimum levels and restock amounts.
  const { usage, prepDaily, takes, book: plan } = planUsage();
  const isCount = (unitKey) => unitKey === 'pcs' || unitKey === 'can';
  const unitName = (u) => (UNIT[u] === undefined ? u : units[UNIT[u]]);
  const ing = {}, unitOf = {}, codeN = {};
  // Stock codes by category, e.g. ME-001 (meat), PR-002 (produce).
  const codeFor = (cat) => { const p = String(cat).slice(0, 2).toUpperCase(); codeN[p] = (codeN[p] || 0) + 1; return `${p}-${String(codeN[p]).padStart(3, '0')}`; };
  INGREDIENTS.forEach(([key, en, th, cat, unit, cost, s, y]) => {
    const use = usage[key] || 0;
    const minLevel = !use ? 0 : isCount(unit) ? Math.ceil(use * 1.5) : Math.max(0.3, round(use * 1.5, 1));
    const parLevel = !use ? '' : isCount(unit) ? Math.ceil(use * 6 / 12) * 12 : Math.ceil(use * 6 * 2) / 2;
    ing[key] = as('ingredients.save', {
      item: { name: tx(en, th), code: codeFor(cat), category: icats[ICAT[cat]], unit: units[UNIT[unit]], costPerUnit: cost,
        minLevel, parLevel, supplierId: s ? sup[s] : '', yieldPct: y || '', allergens: ALLERGENS[key] || [] },
      units: (CONVERSIONS[key] || []).map((c) => ({ unit: unitName(c.unit), factor: c.factor })),
    }).id;
    unitOf[key] = unit;
  });
  const lines = (recipe) => recipe.map(([k, q, u]) => ({ ingredientId: ing[k], qty: q, unit: unitName(u) }));
  PREPS.forEach(([key, en, th, batchQty, trackStock, shelfLifeDays, recipe]) => {
    ing[key] = as('ingredients.save', {
      item: { name: tx(en, th), category: icats[ICAT.sauce], unit: units[UNIT.L], kind: 'prep', batchQty, trackStock,
        shelfLifeDays, minLevel: trackStock ? round(prepDaily[key] || 0, 1) : 0, parLevel: '' },
      prepRecipe: lines(recipe),
    }).id;
  });

  const dish = {};
  MENU.forEach(([key, en, th, cat, price, , recipe]) => {
    // Delivery apps: menu price + 20 %, rounded up to 5 (drinks keep the menu price).
    const app = key === 'tea' || key === 'cola' ? null : Math.ceil(price * 1.2 / 5) * 5;
    dish[key] = as('menu.save', { item: { name: tx(en, th), category: mcats[MCAT[cat]], price }, recipe: lines(recipe),
      prices: app ? [{ channelId: chan.grab, price: app }, { channelId: chan.lineman, price: app }] : [] }).id;
  });

  const start = D(today, -62);
  // Restock everything up to ~7.5 days of usage (orders go out Monday and Thursday; opening stock covers 12 days).
  // Market produce is bought on the spot; other suppliers go through the full
  // order → delivery → invoice → payment cycle, with the odd short delivery or price rise.
  const supplierTerms = Object.fromEntries(SUPPLIERS.map((x) => [x.key, x.terms]));
  const invoices = [];
  let invSeq = 1000;
  const restockLines = (keys, days = 7.5) => {
    const levels = Object.fromEntries(as('stock.levels').map((s) => [s.id, s.onHand]));
    const bySupplier = {};
    keys.forEach((k) => {
      const target = (usage[k] || 0) * days;
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

  // Kitchen production on its set weekdays (everything on the first day), before the day's sales.
  // Each run makes enough (half) batches to last until the next one, plus what other preps made today use.
  let runs = 0;
  const produce = (d, dow, first) => {
    const due = PREPS.filter(([, , , , track, , , days]) => track && (first || days.includes(dow)));
    if (!due.length) return;
    const levels = Object.fromEntries(as('stock.levels').map((s) => [s.id, s.onHand]));
    const batches = {}, fed = {};
    // Plan consumers first (PREPS lists ingredients before the preps that use them).
    [...due].reverse().forEach(([key, , , batch, , , recipe, days]) => {
      const gap = days.length > 1 ? 4 : 7;
      const want = (prepDaily[key] || 0) * 1.15 * (gap + 1) * 1.2 + (fed[key] || 0) - (levels[ing[key]] || 0);
      batches[key] = Math.max(0.5, Math.ceil(want / (batch * RUN_YIELD) * 2) / 2);
      recipe.forEach(([k, q, u]) => { if (plan.byId[k].kind === 'prep') takes({ ingredientId: k, qty: q, unit: u }, batches[key], false, fed); });
    });
    due.forEach(([key, , , batch]) => {
      const n = batches[key];
      as('production.add', { date: d, prepId: ing[key], batches: n, producedQty: round(n * batch * (0.88 + r() * 0.12), 2),
        producedBy: runs++ % 2 ? 'manager' : 'staff',
        byproducts: key === 'stock' ? [{ ingredientId: ing.fat, qty: round(n * (0.25 + r() * 0.15), 2), unit: 'kg' }] : [] });
    });
  };

  const allKeys = INGREDIENTS.map((x) => x[0]);
  as('purchases.add', { date: start, lines: Object.values(restockLines(allKeys, 12)).flat(), invoiceRef: tx('Opening stock', 'สต็อกยกมา') });
  const wasteReasons = ['stock.reasonSpoiled', 'stock.reasonExpired', 'stock.reasonDropped', 'stock.reasonOverprep'].map((k) => t(k));

  // SOPs for the dishes and preps the kitchen makes most, each with its food-safety step.
  const SOPS = [
    ['kraprao', { portionNote: tx('Rice in a mound, chicken beside it, fried egg on top', 'ข้าวตักเป็นโดม วางกะเพราข้าง ๆ ไข่ดาววางด้านบน'), holdingNote: tx('Serve within 3 minutes', 'เสิร์ฟภายใน 3 นาที'), equipment: tx('Wok, ladle', 'กระทะเหล็ก ตะหลิว'), prepMinutes: 3 }, [
      [tx('Pound garlic and chili together', 'โขลกกระเทียมกับพริกให้แหลก'), 1],
      [tx('Stir-fry the paste in hot oil for 20 seconds', 'ผัดพริกกระเทียมในน้ำมันร้อน 20 วินาที'), 1],
      [tx('Add chicken; cook until 75 °C in the thickest piece', 'ใส่ไก่ ผัดจนชิ้นที่หนาที่สุดถึง 75 °C'), 3, true],
      [tx('Season with oyster sauce and fish sauce, fold in the basil off the heat', 'ปรุงด้วยซอสหอยนางรมและน้ำปลา ปิดไฟแล้วใส่ใบกะเพรา'), 1],
      [tx('Fry the egg separately until the edges are crisp', 'ทอดไข่ดาวแยกจนขอบกรอบ'), 2]]],
    ['padthai', { portionNote: tx('Lime wedge and bean sprouts on the side', 'วางมะนาวและถั่วงอกข้างจาน'), equipment: tx('Wok', 'กระทะเหล็ก'), prepMinutes: 20 }, [
      [tx('Soak the noodles in room-temperature water for 20 minutes', 'แช่เส้นในน้ำอุณหภูมิห้อง 20 นาที'), 20],
      [tx('Cook the shrimp until opaque all the way through (63 °C)', 'ผัดกุ้งจนสุกทั่วทั้งตัว (63 °C)'), 2, true],
      [tx('Add noodles, sugar, fish sauce and chilli oil; toss until glossy', 'ใส่เส้น น้ำตาล น้ำปลา และน้ำมันพริก ผัดจนเงา'), 3],
      [tx('Push to one side, scramble the egg, then fold together', 'ดันเส้นไว้ด้านหนึ่ง ตอกไข่ยีให้สุกแล้วคลุกรวม'), 1]]],
    ['curry', { holdingNote: tx('Keep the curry above 63 °C on the line', 'เก็บแกงไว้ร้อนกว่า 63 °C ตลอดเวลาที่ไลน์'), equipment: tx('Pot, ladle', 'หม้อ กระบวย') }, [
      [tx('Fry the curry paste in a little coconut milk until fragrant', 'ผัดพริกแกงกับหัวกะทิจนหอม'), 3],
      [tx('Add chicken and the rest of the coconut milk; simmer until 75 °C inside', 'ใส่ไก่และกะทิที่เหลือ เคี่ยวจนไก่ด้านในถึง 75 °C'), 8, true],
      [tx('Season with fish sauce and palm sugar; finish with basil', 'ปรุงด้วยน้ำปลาและน้ำตาลปี๊บ ใส่ใบโหระพาก่อนปิดไฟ'), 1]]],
    ['mango', { portionNote: tx('Half a mango, sliced, next to the rice; cream spooned over the rice', 'มะม่วงครึ่งลูกหั่นชิ้นวางข้างข้าวเหนียว ราดกะทิบนข้าว') }, [
      [tx('Steam the soaked sticky rice for 25 minutes', 'นึ่งข้าวเหนียวที่แช่ไว้ 25 นาที'), 25],
      [tx('Mix the hot rice with half the sweet coconut cream; rest 10 minutes', 'คลุกข้าวร้อนกับหัวกะทิหวานครึ่งหนึ่ง พักไว้ 10 นาที'), 10],
      [tx('Peel and slice the mango just before serving', 'ปอกและหั่นมะม่วงก่อนเสิร์ฟ'), 2]]],
    ['stock', { holdingNote: tx('Label with the date; use within 4 days', 'ติดป้ายวันที่ ใช้ภายใน 4 วัน'), equipment: tx('Stock pot, ice bath', 'หม้อซุป อ่างน้ำแข็ง') }, [
      [tx('Cover the bones with cold water and bring to a simmer', 'ใส่กระดูกในน้ำเย็นให้ท่วม แล้วตั้งไฟจนเดือดเบา ๆ'), 20],
      [tx('Skim, add garlic, simmer gently for 2 hours', 'ช้อนฟองออก ใส่กระเทียม เคี่ยวไฟอ่อน 2 ชั่วโมง'), 120],
      [tx('Strain; keep the fat that sets on top as chicken fat', 'กรองน้ำซุป เก็บไขมันที่ลอยด้านบนไว้เป็นน้ำมันไก่'), 5],
      [tx('Cool in an ice bath to below 5 °C within 2 hours, then refrigerate', 'ทำให้เย็นในอ่างน้ำแข็งจนต่ำกว่า 5 °C ภายใน 2 ชั่วโมง แล้วเข้าตู้เย็น'), 30, true]]],
    ['chillioil', { holdingNote: tx('Store in a sealed jar, away from heat', 'เก็บในขวดปิดสนิท ห่างจากความร้อน'), equipment: tx('Pot, thermometer', 'หม้อ เทอร์โมมิเตอร์') }, [
      [tx('Heat the oil to 160 °C', 'ตั้งน้ำมันให้ร้อน 160 °C'), 5, true],
      [tx('Add chili and garlic; fry until garlic is golden, about 4 minutes', 'ใส่พริกและกระเทียม ทอดจนกระเทียมเหลือง ประมาณ 4 นาที'), 4],
      [tx('Stir in sugar off the heat and cool before jarring', 'ปิดไฟ ใส่น้ำตาลคนให้ละลาย พักให้เย็นก่อนบรรจุขวด'), 15]]],
  ];
  const sopOwners = { ...dish, stock: ing.stock, chillioil: ing.chillioil };
  const boot0 = as('bootstrap', {});
  SOPS.forEach(([key, notes, steps]) => {
    const id = sopOwners[key];
    const row = boot0.menu.find((m) => m.id === id) || boot0.ingredients.find((i) => i.id === id);
    if (!row) return;
    as('sop.save', { ownerId: id, version: row.version, notes,
      steps: steps.map(([text, minutes, critical]) => ({ text, minutes, critical: !!critical })) });
  });

  // Three promotions with a story: one that paid off, one that lost money, one running now.
  const promo = {};
  promo.mango = as('promotions.save', { item: { name: tx('Weekday mango 15% off', 'ข้าวเหนียวมะม่วงวันธรรมดาลด 15%'), type: 'percentOff', value: 15,
    channelIds: [chan.dine], startDate: D(today, -40), endDate: D(today, -26), weekdays: [1, 2, 3, 4], platformFundedPct: 0 },
    items: [{ menuItemId: dish.mango }] });
  promo.grab = as('promotions.save', { item: { name: tx('Grab Pad Thai 40% off', 'ผัดไทยบน Grab ลด 40%'), type: 'percentOff', value: 40,
    channelIds: [chan.grab], startDate: D(today, -24), endDate: D(today, -15), weekdays: [], platformFundedPct: 0, campaignCommissionPct: 35,
    note: tx('Grab campaign: we paid the whole discount', 'แคมเปญ Grab ร้านออกส่วนลดเอง') }, items: [{ menuItemId: dish.padthai }] });
  promo.set = as('promotions.save', { item: { name: tx('Curry + Thai tea set', 'ชุดแกงเขียวหวาน + ชาไทย'), type: 'bundle', value: 179,
    channelIds: [chan.lineman], startDate: D(today, -6), endDate: '', weekdays: [], platformFundedPct: 0 },
    items: [{ menuItemId: dish.curry, qty: 1 }, { menuItemId: dish.tea, qty: 1 }] });
  const inRange = (d, p) => d >= p.startDate && (!p.endDate || d <= p.endDate) && (!p.weekdays.length || p.weekdays.includes(new Date(d + 'T00:00:00Z').getUTCDay()));
  // Swap a channel's normal line for a promo line (with the extra orders the promotion brought in).
  const toPromo = (lines, dishId, promoId, lift) => {
    const i = lines.findIndex((l) => l.menuItemId === dishId);
    const q = i >= 0 ? lines[i].qty : 1;
    if (i >= 0) lines.splice(i, 1);
    lines.push({ menuItemId: dishId, promoId, qty: Math.max(1, Math.round(q * lift)) });
  };

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
    produce(d, dow, d === start);

    // Sales across four channels: about 50 % dine-in, 10 % takeaway, 25 % Grab, 15 % LINE MAN.
    const SPLIT = [['dine', 0.5], ['take', 0.1], ['grab', 0.25], ['lineman', 0.15]];
    const byCh = { dine: [], take: [], grab: [], lineman: [] };
    MENU.forEach(([key, , , , , base]) => {
      const n = Math.max(0, Math.round(base * dayFactor * (0.8 + r() * 0.4)));
      let left = n;
      SPLIT.forEach(([c, share], i) => {
        // The last channel takes whatever is left, so the day's total stays n.
        const q = i === SPLIT.length - 1 ? left : Math.min(left, Math.round(n * share * (0.85 + r() * 0.3)));
        left -= q;
        if (q) byCh[c].push({ menuItemId: dish[key], qty: q });
      });
    });
    if (inRange(d, promo.mango)) toPromo(byCh.dine, dish.mango, promo.mango.id, 1.4 + r() * 0.2);
    if (inRange(d, promo.grab)) toPromo(byCh.grab, dish.padthai, promo.grab.id, 1.9 + r() * 0.3);
    if (inRange(d, promo.set)) byCh.lineman.push({ promoId: promo.set.id, qty: Math.max(1, Math.round((2 + r() * 3) * (isToday ? 0.45 : 1))) });
    SPLIT.forEach(([c]) => { if (byCh[c].length) as('sales.add', { date: d, channelId: chan[c], lines: byCh[c] }); });

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
  // Every past trading day was closed, except yesterday — so Home asks someone to close it.
  for (let d = start; d < D(today, -1); d = D(d, 1)) as('day.close', { date: d, today });
  // Today's purchasing state: a delivery due today, and a draft order waiting to be sent.
  buy(today, ['shrimp', 'pork'], { receive: false });
  const draft = restockLines(['oil', 'sugar', 'fishsauce', 'cup']);
  if (draft.dry) {
    as('po.save', { item: { supplierId: sup.dry, orderDate: today }, lines: draft.dry.map((l) => ({ ingredientId: l.ingredientId, qtyOrdered: Math.max(l.qty, 2), unitPrice: l.unitCost })) });
  }
}
