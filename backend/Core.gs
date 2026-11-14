// GENERATED from app/js/core.js by tools/build_backend.py. Do not edit here;
// edit app/js/core.js and run the script again.

/*
 * Restaurant Ops — shared business logic.
 *
 * This one file runs in two places:
 *   1. Google Apps Script (copied to backend/Core.gs by tools/build_backend.py), where
 *      the database is the Google Spreadsheet.
 *   2. The browser, in demo mode, where the database is localStorage.
 *
 * It must stay plain ES5-compatible JavaScript with no DOM and no Google APIs.
 * Everything environment-specific (storage, locking, sessions, ids, clock) is
 * injected through the `env` object passed to createApi().
 */
var RestoCore = (function () {
  'use strict';

  var VERSION = '2.0.0';

  /* ------------------------------------------------------------------ schema */

  // One spreadsheet tab per table. Column order here = column order in the sheet.
  var SCHEMA = {
    Settings: ['key', 'value', 'updatedAt', 'updatedBy'],
    Users: ['id', 'username', 'displayName', 'role', 'passwordHash', 'salt', 'active',
      'createdAt', 'updatedAt', 'updatedBy', 'version'],
    // New columns are always APPENDED so existing sheets upgrade in place (Server.gs adds them).
    Suppliers: ['id', 'name', 'contactName', 'phone', 'email', 'notes', 'active',
      'createdAt', 'updatedAt', 'updatedBy', 'version', 'leadTimeDays', 'paymentTermsDays'],
    Ingredients: ['id', 'name', 'category', 'unit', 'costPerUnit', 'minLevel', 'supplierId', 'active',
      'createdAt', 'updatedAt', 'updatedBy', 'version', 'parLevel',
      'yieldPct', 'kind', 'batchQty', 'trackStock', 'shelfLifeDays',
      // SOP fields; allergens = csv of codes (only set on ingredients, derived for dishes and preps)
      'portionNote', 'holdingNote', 'equipment', 'prepMinutes', 'allergens', 'photoUrl',
      // optional stock code (SKU), unique among active items
      'code'],
    Purchases: ['id', 'date', 'supplierId', 'ingredientId', 'qty', 'unitCost', 'total', 'invoiceRef',
      'note', 'voided', 'createdAt', 'createdBy', 'poId', 'poLineId'],
    StockMovements: ['id', 'date', 'ingredientId', 'type', 'qty', 'unitCost', 'value', 'reason', 'refId',
      'voided', 'createdAt', 'createdBy'],
    Menu: ['id', 'name', 'category', 'price', 'active', 'createdAt', 'updatedAt', 'updatedBy', 'version',
      'portionNote', 'holdingNote', 'equipment', 'prepMinutes', 'photoUrl'],
    Recipes: ['id', 'menuItemId', 'ingredientId', 'qty', 'note', 'unit', 'yieldPct'],
    Sales: ['id', 'date', 'menuItemId', 'itemName', 'qty', 'unitPrice', 'total', 'unitCost', 'costTotal',
      'channel', 'note', 'voided', 'createdAt', 'createdBy',
      // unitPrice/total = what the restaurant is credited before commission; commission is a snapshot.
      'channelId', 'commission', 'promoId', 'listPrice', 'discount', 'platformDiscount'],
    Expenses: ['id', 'date', 'category', 'description', 'amount', 'paymentMethod', 'note', 'voided',
      'createdAt', 'createdBy'],
    // Purchasing: orders to suppliers, and the suppliers' invoices matched against them.
    PurchaseOrders: ['id', 'poNumber', 'supplierId', 'status', 'orderDate', 'expectedDate', 'note', 'total',
      'sentAt', 'sentBy', 'closedAt', 'closedBy', 'closeReason', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    PurchaseOrderLines: ['id', 'poId', 'ingredientId', 'qtyOrdered', 'unitPrice', 'note'],
    SupplierInvoices: ['id', 'invoiceNo', 'supplierId', 'poId', 'invoiceDate', 'dueDate', 'subtotal', 'vat', 'total',
      'status', 'exceptionCount', 'varianceAmount', 'reviewNote', 'reviewedAt', 'reviewedBy',
      'paidAt', 'paidBy', 'paymentMethod', 'paymentRef', 'note', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    SupplierInvoiceLines: ['id', 'invoiceId', 'ingredientId', 'qty', 'unitPrice', 'total'],
    // Costing: unit conversions, prep (sub-recipe) lines and the cost change log.
    IngredientUnits: ['id', 'ingredientId', 'unit', 'factor'],
    PrepRecipes: ['id', 'prepId', 'ingredientId', 'qty', 'unit', 'yieldPct', 'note'],
    CostChanges: ['id', 'date', 'ingredientId', 'oldCost', 'newCost', 'source', 'refId', 'createdAt', 'createdBy'],
    ProductionRuns: ['id', 'runNo', 'date', 'prepId', 'batches', 'expectedQty', 'producedQty', 'unit', 'inputCost',
      'byproductValue', 'totalCost', 'unitCost', 'yieldPct', 'producedBy', 'note', 'voided', 'createdAt', 'createdBy'],
    // Sales channels (dine-in, takeaway, delivery apps) with their commission and packaging cost per dish.
    Channels: ['id', 'name', 'type', 'commissionPct', 'packagingCost', 'commissionOnDiscounted', 'active', 'sortOrder',
      'createdAt', 'updatedAt', 'updatedBy', 'version'],
    // A dish's price on one channel (no row = the dish's own price).
    MenuPrices: ['id', 'menuItemId', 'channelId', 'price'],
    // Promotions: status stores draft / scheduled / cancelled; scheduled shows as scheduled / active / ended by date.
    Promotions: ['id', 'name', 'type', 'value', 'channelIds', 'startDate', 'endDate', 'weekdays', 'platformFundedPct',
      'campaignCommissionPct', 'status', 'note', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    PromotionItems: ['id', 'promoId', 'menuItemId', 'qty'],
    // Standard operating procedure steps for a dish or a prep (ownerId).
    SopSteps: ['id', 'ownerId', 'stepNo', 'text', 'minutes', 'imageUrl', 'critical'],
    // One row per closed trading day (the end-of-day routine).
    DayCloses: ['id', 'date', 'closedBy', 'closedAt', 'salesTotal', 'wasteValue', 'countLines', 'note']
  };

  // Columns that must be stored as plain text in the sheet (so "2026-11-07" stays a string).
  var TEXT_COLUMNS = ['id', 'key', 'value', 'date', 'username', 'phone', 'invoiceRef', 'menuItemId',
    'ingredientId', 'supplierId', 'refId', 'passwordHash', 'salt', 'createdAt', 'updatedAt',
    'poId', 'poLineId', 'poNumber', 'invoiceNo', 'invoiceId', 'orderDate', 'expectedDate', 'invoiceDate', 'dueDate',
    'sentAt', 'closedAt', 'reviewedAt', 'paidAt', 'paymentRef', 'prepId', 'runNo', 'unit', 'channelId', 'promoId', 'channelIds', 'weekdays', 'startDate', 'endDate', 'ownerId', 'allergens', 'code'];

  var PO_STATUSES = ['draft', 'sent', 'partial', 'received', 'closed', 'cancelled'];
  var INVOICE_STATUSES = ['matched', 'exception', 'noPo', 'approved', 'disputed', 'paid'];

  var DEFAULT_SETTINGS = {
    restaurantName: 'My Restaurant',
    currency: 'THB',
    locale: 'en-US',
    costMethod: 'average',            // 'average' (moving weighted average) or 'last' (last purchase price)
    targetFoodCostPct: '30',          // dishes above this are flagged
    vatRate: '7',                     // % added to supplier invoices by default (Thailand: 7)
    priceTolerancePct: '2',           // invoice price may differ from the PO price by this much before it's an exception
    salesChannels: 'Dine-in, Takeaway, Delivery',
    expenseCategories: 'Rent, Staff wages, Utilities, Gas, Packaging, Cleaning, Marketing, Repairs, Delivery fees, Other',
    ingredientCategories: 'Meat & Seafood, Produce, Dairy & Eggs, Dry goods, Sauces & Condiments, Beverages, Packaging',
    menuCategories: 'Mains, Noodles & Rice, Starters, Desserts, Drinks',
    units: 'kg, g, L, ml, pcs, pack, bottle, can',
    priceRounding: '',                // '' = by currency (THB -> 5); else none | 1 | 5 | 10 | 0.99 | 9-ending
    foodBudget: ''                    // monthly ingredient budget; '' = expected revenue × target food cost %
  };
  var CHANNEL_TYPES = ['dineIn', 'takeaway', 'delivery', 'other'];

  // Used instead of the English lists when setup runs in Thai (initialize({ lang: 'th' })).
  var DEFAULT_SETTINGS_TH = {
    salesChannels: 'ทานที่ร้าน, กลับบ้าน, เดลิเวอรี่',
    expenseCategories: 'ค่าเช่า, ค่าจ้างพนักงาน, ค่าน้ำค่าไฟ, ค่าแก๊ส, บรรจุภัณฑ์, อุปกรณ์ทำความสะอาด, การตลาด, ค่าซ่อมแซม, ค่าธรรมเนียมเดลิเวอรี่, อื่น ๆ',
    ingredientCategories: 'เนื้อสัตว์และอาหารทะเล, ผักและผลไม้, นมและไข่, ของแห้ง, ซอสและเครื่องปรุง, เครื่องดื่ม, บรรจุภัณฑ์',
    menuCategories: 'อาหารจานหลัก, ข้าวและเส้น, ของทานเล่น, ของหวาน, เครื่องดื่ม',
    units: 'กก., กรัม, ลิตร, มล., ชิ้น, แพ็ค, ขวด, กระป๋อง'
  };

  var ROLES = { staff: 1, manager: 2, owner: 3 };
  var MOVEMENT_TYPES = ['usage', 'waste', 'count', 'adjustment', 'sale', 'production', 'produce', 'byproduct'];
  var SESSION_TTL_SECONDS = 6 * 60 * 60;   // sliding: every request extends it
  var MAX_FAILED_LOGINS = 5;
  var LOCKOUT_SECONDS = 10 * 60;

  /* ----------------------------------------------------------------- helpers */

  function ApiError(code, message, details) {
    var e = new Error(message);
    e.code = code;
    e.details = details;
    return e;
  }
  function fail(code, message, details) { throw ApiError(code, message, details); }

  function round(n, dp) {
    var f = Math.pow(10, dp === undefined ? 2 : dp);
    return Math.round((Number(n) || 0) * f + (n >= 0 ? 1e-9 : -1e-9)) / f;
  }
  function bool(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function trim(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function byId(rows) { var m = {}; for (var i = 0; i < rows.length; i++) m[rows[i].id] = rows[i]; return m; }
  function sum(rows, fn) { var t = 0; for (var i = 0; i < rows.length; i++) t += fn(rows[i]); return t; }
  function list(csv) { return trim(csv).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }

  function reqStr(v, label, max) {
    var s = trim(v);
    if (!s) fail('VALIDATION', label + ' is required.');
    if (s.length > (max || 120)) fail('VALIDATION', label + ' is too long (max ' + (max || 120) + ' characters).');
    return s;
  }
  function optStr(v, max) {
    var s = trim(v);
    if (s.length > (max || 500)) fail('VALIDATION', 'Text is too long (max ' + (max || 500) + ' characters).');
    return s;
  }
  function reqNum(v, label, opts) {
    opts = opts || {};
    if (v === '' || v === null || v === undefined) fail('VALIDATION', label + ' is required.');
    var n = Number(v);
    if (!isFinite(n)) fail('VALIDATION', label + ' must be a number.');
    if (opts.min !== undefined && n < opts.min) fail('VALIDATION', label + ' must be at least ' + opts.min + '.');
    if (opts.positive && n <= 0) fail('VALIDATION', label + ' must be greater than 0.');
    return n;
  }
  function reqDate(v, label) {
    var s = trim(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail('VALIDATION', (label || 'Date') + ' must be in YYYY-MM-DD format.');
    return s;
  }
  function optInt(v, label) {
    if (v === '' || v === null || v === undefined) return '';
    var n = reqNum(v, label, { min: 0 });
    if (Math.round(n) !== n) fail('VALIDATION', label + ' must be a whole number.');
    return n;
  }
  function reqMonth(v) {
    var s = trim(v);
    if (!/^\d{4}-\d{2}$/.test(s)) fail('VALIDATION', 'Month must be in YYYY-MM format.');
    return s;
  }
  function addDays(dateStr, n) {
    var p = dateStr.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
  }
  function monthEnd(month) {
    var p = month.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1], 0));
    return d.toISOString().slice(0, 10);
  }
  function shiftMonth(month, n) {
    var p = month.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  }
  function inRange(date, from, to) { return (!from || date >= from) && (!to || date <= to); }
  function newestFirst(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  }

  /* ------------------------------------------------- SHA-256 (sync, pure JS) */

  var SHA_K = [], SHA_H0 = [];
  (function () {
    var primes = 0, cand = 2;
    var isPrime = function (n) { for (var f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
    while (primes < 64) {
      if (isPrime(cand)) {
        if (primes < 8) SHA_H0[primes] = (Math.pow(cand, 1 / 2) * 4294967296) | 0;
        SHA_K[primes] = (Math.pow(cand, 1 / 3) * 4294967296) | 0;
        primes++;
      }
      cand++;
    }
  })();

  function sha256(ascii) {
    function rrot(v, n) { return (v >>> n) | (v << (32 - n)); }
    var bytes = [];
    var str = unescape(encodeURIComponent(ascii)); // UTF-8
    for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i));
    var K = SHA_K, H = SHA_H0.slice();
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    var w = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
          (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      }
      for (i = 16; i < 64; i++) {
        var s0 = rrot(w[i - 15], 7) ^ rrot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rrot(w[i - 2], 17) ^ rrot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rrot(e, 6) ^ rrot(e, 11) ^ rrot(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rrot(a, 2) ^ rrot(a, 13) ^ rrot(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var hex = '';
    for (i = 0; i < 8; i++) hex += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    return hex;
  }

  function hashPassword(password, salt) {
    // Iterated to slow down brute force on a leaked sheet.
    var h = salt + ':' + password;
    for (var i = 0; i < 500; i++) h = sha256(h + salt);
    return h;
  }

  /* ------------------------------------------------- Thai server messages */

  // Messages are written in English in the code below and translated on the way out
  // when the app asks for Thai (request field `lang: 'th'`).
  var TH_LABELS = {
    'Name': 'ชื่อ', 'Unit': 'หน่วย', 'Cost per unit': 'ราคาต่อหน่วย', 'Minimum level': 'ระดับขั้นต่ำ',
    'Supplier name': 'ชื่อซัพพลายเออร์', 'Dish name': 'ชื่อเมนู', 'Selling price': 'ราคาขาย', 'Category': 'หมวดหมู่',
    'Amount': 'จำนวนเงิน', 'Username': 'ชื่อผู้ใช้', 'Target food cost %': 'เป้าหมายต้นทุนอาหาร %', 'Date': 'วันที่',
    'Today': 'วันนี้', 'Ingredient': 'วัตถุดิบ', 'Supplier': 'ซัพพลายเออร์', 'Dish': 'เมนู', 'User': 'ผู้ใช้',
    'Purchase line': 'รายการซื้อ', 'Stock entry': 'รายการสต็อก', 'Sale': 'รายการขาย', 'Expense': 'ค่าใช้จ่าย',
    'Item': 'รายการ', 'This item': 'รายการนี้', 'Text': 'ข้อความ',
    'owner': 'เจ้าของร้าน', 'manager': 'ผู้จัดการ', 'staff': 'พนักงาน', 'someone else': 'ผู้ใช้อื่น',
    'Par level': 'ระดับสต็อกเป้าหมาย', 'Lead time (days)': 'ระยะเวลาส่งของ (วัน)', 'Payment terms (days)': 'เครดิต (วัน)',
    'VAT rate': 'อัตราภาษีมูลค่าเพิ่ม', 'Price tolerance %': 'ส่วนต่างราคาที่ยอมรับได้ %', 'Order date': 'วันที่สั่ง',
    'Expected date': 'วันที่คาดว่าจะได้รับ', 'Invoice number': 'เลขที่ใบแจ้งหนี้', 'Invoice date': 'วันที่ใบแจ้งหนี้',
    'Due date': 'วันครบกำหนด', 'VAT': 'ภาษีมูลค่าเพิ่ม', 'Invoice total': 'ยอดรวมใบแจ้งหนี้', 'Payment date': 'วันที่จ่าย',
    'Purchase order': 'ใบสั่งซื้อ', 'Invoice': 'ใบแจ้งหนี้', 'Order line': 'รายการสั่งซื้อ',
    'Batches': 'จำนวนรอบผลิต', 'Batch quantity': 'ปริมาณต่อรอบผลิต', 'Conversion factor': 'ตัวคูณการแปลงหน่วย',
    'Conversion unit': 'หน่วยที่แปลง', 'Shelf life (days)': 'อายุการเก็บ (วัน)', 'Ingredient code': 'รหัสวัตถุดิบ', 'Monthly ingredient budget': 'งบวัตถุดิบต่อเดือน', 'Quantity made': 'จำนวนที่ผลิตได้', 'Production run': 'การผลิต',
    'Packaging cost': 'ค่าบรรจุภัณฑ์', 'Promotion': 'โปรโมชัน', 'Promotion name': 'ชื่อโปรโมชัน', 'Promotion price': 'ราคาโปรโมชัน',
    'Start date': 'วันเริ่ม', 'End date': 'วันสิ้นสุด', 'Prep': 'ของเตรียม', 'Prep time (minutes)': 'เวลาเตรียม (นาที)', 'From': 'ตั้งแต่วันที่', 'To': 'ถึงวันที่', 'Sales channel': 'ช่องทางการขาย', 'Commission %': 'ค่าคอมมิชชัน %',
    'cancelled': 'ถูกยกเลิก', 'closed': 'ปิดแล้ว', 'received': 'รับครบแล้ว', 'draft': 'เป็นฉบับร่าง',
    'sent': 'ส่งแล้ว', 'partial': 'รับบางส่วนแล้ว', 'paid': 'จ่ายแล้ว', 'disputed': 'โต้แย้งอยู่'
  };
  function formatRunNo(n) { return 'PR-' + (n < 10000 ? ('0000' + n).slice(-4) : String(n)); }
  function thLabel(l) {
    var m;
    if (TH_LABELS[l]) return TH_LABELS[l];
    if ((m = /^Line (\d+) quantity$/.exec(l))) return 'จำนวนในรายการที่ ' + m[1];
    if ((m = /^Step (\d+) minutes$/.exec(l))) return 'เวลาของขั้นตอนที่ ' + m[1] + ' (นาที)';
    if ((m = /^Line (\d+) unit cost$/.exec(l))) return 'ราคาต่อหน่วยในรายการที่ ' + m[1];
    if ((m = /^Input (\d+) quantity$/.exec(l))) return 'จำนวนวัตถุดิบที่ใช้รายการที่ ' + m[1];
    if ((m = /^By-product (\d+) quantity$/.exec(l))) return 'จำนวนผลพลอยได้รายการที่ ' + m[1];
    if ((m = /^Recipe line (\d+) quantity$/.exec(l))) return 'ปริมาณในสูตรบรรทัดที่ ' + m[1];
    if ((m = /^(Ingredient|Supplier|Dish|User|Sales channel|Promotion) "([\s\S]*)"$/.exec(l))) return TH_LABELS[m[1]] + ' "' + m[2] + '"';
    if ((m = /^([\s\S]+) quantity$/.exec(l))) return 'จำนวน ' + m[1];
    if ((m = /^([\s\S]+) price$/.exec(l))) return 'ราคา ' + m[1];
    return l;
  }
  var TH_RULES = [
    [/^Text is too long \(max (\d+) characters\)\.$/, 'ข้อความยาวเกินไป (ไม่เกิน $1 ตัวอักษร)'],
    [/^([\s\S]+) is too long \(max (\d+) characters\)\.$/, function (m) { return thLabel(m[1]) + ' ยาวเกินไป (ไม่เกิน ' + m[2] + ' ตัวอักษร)'; }],
    [/^([\s\S]+) is required\.$/, function (m) { return 'กรุณากรอก' + thLabel(m[1]); }],
    [/^([\s\S]+) must be a number\.$/, function (m) { return thLabel(m[1]) + ' ต้องเป็นตัวเลข'; }],
    [/^([\s\S]+) must be at least ([-\d.]+)\.$/, function (m) { return thLabel(m[1]) + ' ต้องไม่น้อยกว่า ' + m[2]; }],
    [/^([\s\S]+) must be greater than 0\.$/, function (m) { return thLabel(m[1]) + ' ต้องมากกว่า 0'; }],
    [/^([\s\S]+) must be in YYYY-MM-DD format\.$/, function (m) { return thLabel(m[1]) + ' ต้องอยู่ในรูปแบบ YYYY-MM-DD'; }],
    [/^Month must be in YYYY-MM format\.$/, 'เดือนต้องอยู่ในรูปแบบ YYYY-MM'],
    [/^([\s\S]+) not found\. It may have been removed — reload and try again\.$/, function (m) {
      return 'ไม่พบ' + thLabel(m[1]) + ' อาจถูกลบไปแล้ว — โหลดใหม่แล้วลองอีกครั้ง'; }],
    [/^([\s\S]+) was changed by ([\s\S]+) while you were editing\. Your changes were not saved — reload to see the latest version\.$/, function (m) {
      return thLabel(m[1]) + ' ถูกแก้ไขโดย ' + thLabel(m[2]) + ' ระหว่างที่คุณกำลังแก้ไข การแก้ไขของคุณยังไม่ถูกบันทึก — โหลดใหม่เพื่อดูข้อมูลล่าสุด'; }],
    [/^([\s\S]+) "([\s\S]*)" already exists\.$/, function (m) { return thLabel(m[1]) + ' "' + m[2] + '" มีอยู่แล้ว'; }],
    [/^([\s\S]+) is already voided\.$/, function (m) { return thLabel(m[1]) + ' ถูกยกเลิกไปแล้ว'; }],
    [/^Enter your username and password\.$/, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'],
    [/^Too many failed attempts\./, 'ใส่รหัสผ่านผิดหลายครั้งเกินไป ลองใหม่ใน 10 นาที หรือให้เจ้าของร้านรีเซ็ตรหัสผ่าน'],
    [/^Wrong username or password\.$/, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'],
    [/^Please sign in\.$/, 'กรุณาเข้าสู่ระบบ'],
    [/^Your session has expired\./, 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง'],
    [/^Your account is no longer active\.$/, 'บัญชีของคุณถูกปิดใช้งานแล้ว'],
    [/^Current password is incorrect\.$/, 'รหัสผ่านปัจจุบันไม่ถูกต้อง'],
    [/^Password must be at least 8 characters\.$/, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'],
    [/^Add at least one item to the purchase\.$/, 'กรุณาเพิ่มอย่างน้อย 1 รายการในการซื้อ'],
    [/^Too many lines in one purchase \(max 60\)\.$/, 'รายการในการซื้อครั้งเดียวมากเกินไป (สูงสุด 60 รายการ)'],
    [/^Line (\d+): choose an ingredient\.$/, 'รายการที่ $1: กรุณาเลือกวัตถุดิบ'],
    [/^Recipe line (\d+): choose an ingredient\.$/, 'สูตรบรรทัดที่ $1: กรุณาเลือกวัตถุดิบ'],
    [/^Unknown stock movement type\.$/, 'ไม่รู้จักประเภทรายการสต็อก'],
    [/^Only a manager can make stock adjustments\.$/, 'เฉพาะผู้จัดการเท่านั้นที่ปรับยอดสต็อกได้'],
    [/^Add at least one item\.$/, 'กรุณาเพิ่มอย่างน้อย 1 รายการ'],
    [/^Say why it was wasted/, 'กรุณาระบุสาเหตุของเสีย (เช่น หมดอายุ เน่าเสีย ทำหล่น)'],
    [/^Sale deductions are removed by voiding the sale itself\.$/, 'การตัดสต็อกจากการขาย ต้องยกเลิกที่รายการขายนั้น'],
    [/^Email address looks wrong\.$/, 'อีเมลไม่ถูกต้อง'],
    [/^([\s\S]+) is in the recipe twice\.$/, '$1 อยู่ในสูตรซ้ำกัน'],
    [/^Enter a quantity for at least one dish\.$/, 'กรุณาใส่จำนวนอย่างน้อย 1 เมนู'],
    [/^Line (\d+): dish not found\.$/, 'รายการที่ $1: ไม่พบเมนู'],
    [/^([\s\S]+): quantity must be a whole number\.$/, '$1: จำนวนต้องเป็นจำนวนเต็ม'],
    [/^Choose a role\.$/, 'กรุณาเลือกบทบาท'],
    [/^Username: 3–40/, 'ชื่อผู้ใช้: ใช้ตัวอักษรภาษาอังกฤษ ตัวเลข จุด ขีด หรือขีดล่าง 3–40 ตัว'],
    [/^There must always be at least one active owner\.$/, 'ต้องมีเจ้าของร้านที่ใช้งานอยู่อย่างน้อย 1 คนเสมอ'],
    [/^Set a starting password for the new user\.$/, 'กรุณาตั้งรหัสผ่านเริ่มต้นให้ผู้ใช้ใหม่'],
    [/^Unknown cost method\.$/, 'ไม่รู้จักวิธีคิดต้นทุน'],
    [/^Unknown period\.$/,'ไม่รู้จักช่วงเวลานี้'],
    [/^Unknown action: ([\s\S]*)$/, 'ไม่รู้จักคำสั่ง: $1'],
    [/^Your role \((\w+)\) cannot do this\. Ask a (\w+)\.$/, function (m) {
      return 'บทบาทของคุณ (' + thLabel(m[1]) + ') ทำรายการนี้ไม่ได้ กรุณาให้' + thLabel(m[2]) + 'ดำเนินการ'; }],
    [/^The system is busy/, 'ระบบกำลังบันทึกข้อมูลของผู้ใช้อื่นอยู่ กรุณาลองอีกครั้ง'],
    [/^Something went wrong on the server: ([\s\S]*)$/, 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์: $1'],
    [/^The server couldn't finish this\. Please try again\.$/, 'เซิร์ฟเวอร์ทำรายการนี้ไม่สำเร็จ กรุณาลองอีกครั้ง'],
    [/^([\s\S]+) must be a whole number\.$/, function (m) { return thLabel(m[1]) + ' ต้องเป็นจำนวนเต็ม'; }],
    [/^Only draft orders can be edited\.$/, 'แก้ไขได้เฉพาะใบสั่งซื้อที่เป็นฉบับร่าง'],
    [/^Choose a supplier\.$/, 'กรุณาเลือกซัพพลายเออร์'],
    [/^Add at least one item to the order\.$/, 'กรุณาเพิ่มอย่างน้อย 1 รายการในใบสั่งซื้อ'],
    [/^Add at least one item to the invoice\.$/, 'กรุณาเพิ่มอย่างน้อย 1 รายการในใบแจ้งหนี้'],
    [/^([\s\S]+) is on the order twice\.$/, '$1 อยู่ในใบสั่งซื้อซ้ำกัน'],
    [/^([\s\S]+) is on the invoice twice\.$/, '$1 อยู่ในใบแจ้งหนี้ซ้ำกัน'],
    [/^This order is already (\w+) and can't be changed\.$/, function (m) { return 'ใบสั่งซื้อนี้' + thLabel(m[1]) + ' จึงเปลี่ยนแปลงไม่ได้'; }],
    [/^This order already has deliveries/, 'ใบสั่งซื้อนี้มีการรับของแล้ว — ให้ปิดใบสั่งซื้อแทนการยกเลิก'],
    [/^Only orders waiting for delivery can be closed\.$/, 'ปิดได้เฉพาะใบสั่งซื้อที่รอรับของ'],
    [/^Enter a received quantity for at least one item\.$/, 'กรุณาใส่จำนวนที่รับอย่างน้อย 1 รายการ'],
    [/^Line (\d+): not on this order\.$/, 'รายการที่ $1: ไม่อยู่ในใบสั่งซื้อนี้'],
    [/^Invoice "([\s\S]*)" from this supplier is already recorded\.$/, 'ใบแจ้งหนี้ "$1" ของซัพพลายเออร์นี้ถูกบันทึกไว้แล้ว'],
    [/^This order belongs to another supplier\.$/, 'ใบสั่งซื้อนี้เป็นของซัพพลายเออร์รายอื่น'],
    [/^Paid invoices can't be changed\.$/, 'ใบแจ้งหนี้ที่จ่ายแล้วแก้ไขไม่ได้'],
    [/^Add a note explaining the decision\.$/, 'กรุณาใส่หมายเหตุอธิบายเหตุผล'],
    [/^Only matched or approved invoices can be paid\.$/, 'จ่ายได้เฉพาะใบแจ้งหนี้ที่ตรงกันหรืออนุมัติแล้ว'],
    [/^This invoice is already (\w+)\.$/, function (m) { return 'ใบแจ้งหนี้นี้' + thLabel(m[1]); }],
    [/^A cancelled order can't be invoiced\.$/, 'ใบสั่งซื้อที่ถูกยกเลิกแล้วออกใบแจ้งหนี้ไม่ได้'],
    [/^Yield must be between 1 and 1000 %\.$/, 'ผลผลิตต้องอยู่ระหว่าง 1 ถึง 1000 %'],
    [/^A prep needs at least one recipe line\.$/, 'งานเตรียมต้องมีวัตถุดิบอย่างน้อยหนึ่งรายการ'],
    [/^Recipe line (\d+): choose an ingredient\.$/, 'สูตรบรรทัดที่ $1: เลือกวัตถุดิบ'],
    [/^Can't convert ([\s\S]+) to ([\s\S]+) for ([\s\S]+?)\. Add a conversion on the ingredient\.(?: Used in ([\s\S]+)\.)?$/, function (m) {
      return 'แปลงหน่วย ' + m[1] + ' เป็น ' + m[2] + ' ของ ' + m[3] + ' ไม่ได้ กรุณาเพิ่มการแปลงหน่วยที่วัตถุดิบ' + (m[4] ? ' (ใช้ใน ' + m[4] + ')' : ''); }],
    [/^([\s\S]+) is made to order and isn't kept in stock\.$/, function (m) { return m[1] + ' ทำตามออเดอร์ ไม่เก็บสต็อก'; }],
    [/^([\s\S]+) can't contain itself \(via ([\s\S]+)\)\.$/, function (m) { return m[1] + ' ใส่ตัวเองเป็นส่วนผสมไม่ได้ (ผ่าน ' + m[2] + ')'; }],
    [/^Preps can be nested at most 4 levels deep\.$/, 'งานเตรียมซ้อนกันได้ไม่เกิน 4 ชั้น'],
    [/^([\s\S]+) is in the recipe twice\.$/, function (m) { return m[1] + ' อยู่ในสูตรซ้ำสองครั้ง'; }],
    [/^A conversion can't use the stock unit itself\.$/, 'การแปลงหน่วยใช้หน่วยสต็อกเดียวกันไม่ได้'],
    [/^Choose a prep item to produce\.$/, 'กรุณาเลือกงานเตรียมที่ผลิต'],
    [/^Input (\d+): choose an ingredient\.$/, 'วัตถุดิบที่ใช้รายการที่ $1: กรุณาเลือกวัตถุดิบ'],
    [/^By-product (\d+): choose an ingredient\.$/, 'ผลพลอยได้รายการที่ $1: กรุณาเลือกวัตถุดิบ'],
    [/^Choose who made it\.$/, 'กรุณาเลือกผู้ผลิต'],
    [/^Commission must be between 0 and 99\.9 %\.$/, 'ค่าคอมมิชชันต้องอยู่ระหว่าง 0 ถึง 99.9 %'],
    [/^Unknown channel type\.$/, 'ไม่รู้จักประเภทช่องทางการขาย'],
    [/^Keep at least one active sales channel\.$/, 'ต้องเปิดใช้งานช่องทางการขายอย่างน้อยหนึ่งช่องทาง'],
    [/^Unknown price rounding\.$/, 'ไม่รู้จักรูปแบบการปัดราคา'],
    [/^Unknown promotion type\.$/, 'ไม่รู้จักประเภทโปรโมชัน'],
    [/^Discount must be between 0 and 100 %\.$/, 'ส่วนลดต้องมากกว่า 0 และไม่เกิน 100 %'],
    [/^Amount must be greater than 0\.$/, 'จำนวนเงินต้องมากกว่า 0'],
    [/^Buy-X-get-Y must look like 2\+1\.$/, 'ซื้อแถมต้องเขียนแบบ 2+1 (ซื้อ 2 แถม 1)'],
    [/^Choose at least one dish\.$/, 'กรุณาเลือกอย่างน้อยหนึ่งเมนู'],
    [/^A bundle needs at least two dishes\.$/, 'ชุดเมนูต้องมีอย่างน้อยสองจาน'],
    [/^End date can't be before the start date\.$/, 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'],
    [/^Platform share must be between 0 and 100 %\.$/, 'ส่วนที่แอปช่วยออกต้องอยู่ระหว่าง 0 ถึง 100 %'],
    [/^Unknown weekday\.$/, 'ไม่รู้จักวันในสัปดาห์'],
    [/^([\s\S]+) is in the promotion twice\.$/, function (m) { return m[1] + ' อยู่ในโปรโมชันซ้ำสองครั้ง'; }],
    [/^This promotion is already cancelled\.$/, 'โปรโมชันนี้ถูกยกเลิกไปแล้ว'],
    [/^Promotion "([\s\S]*)" isn't running on this date and channel\.$/, function (m) { return 'โปรโมชัน "' + m[1] + '" ไม่ได้ใช้ในวันและช่องทางนี้'; }],
    [/^Dish isn't in this promotion\.$/, 'เมนูนี้ไม่อยู่ในโปรโมชัน'],
    [/^Unknown allergen\.$/, 'ไม่รู้จักสารก่อภูมิแพ้นี้'],
    [/^You can't close a day that hasn't happened yet\.$/, 'ปิดยอดวันที่ยังมาไม่ถึงไม่ได้'],
    [/^Step (\d+): write what to do\.$/, 'ขั้นตอนที่ $1: กรุณาเขียนวิธีทำ'],
    [/^Too many steps \(max (\d+)\)\.$/, 'ขั้นตอนมากเกินไป (ไม่เกิน $1)'],
    [/^Image link must start with http:\/\/ or https:\/\/\.$/, 'ลิงก์รูปต้องขึ้นต้นด้วย http:// หรือ https://'],
    [/^Only dishes and preps have an SOP\.$/, 'มีขั้นตอนมาตรฐานได้เฉพาะเมนูและของเตรียม'],
    [/^Line (\d+): quantity must be a whole number\.$/, 'บรรทัดที่ $1: จำนวนต้องเป็นจำนวนเต็ม'],
    [/^This sales channel is turned off\.$/, 'ช่องทางการขายนี้ปิดใช้งานอยู่'],
    [/^Choose a sales channel\.$/, 'กรุณาเลือกช่องทางการขาย'],
    [/^Too many dishes in one update \(max (\d+)\)\.$/, 'อัปเดตได้ครั้งละไม่เกิน $1 เมนู'],
    [/^A by-product can't be the item being produced\.$/, 'ผลพลอยได้ต้องไม่ใช่รายการที่กำลังผลิต'],
    [/^Production entries are removed by voiding the production run\.$/, 'รายการผลิตต้องยกเลิกที่การผลิตนั้น'],
    [/^Line (\d+): ([\s\S]+) is made in the kitchen\. Record a production run instead\.$/, function (m) {
      return 'บรรทัดที่ ' + m[1] + ': ' + m[2] + ' ผลิตในครัว กรุณาบันทึกการผลิตแทน'; }]
  ];
  function translate(message, lang) {
    if (lang !== 'th' || !message) return message;
    for (var i = 0; i < TH_RULES.length; i++) {
      var m = TH_RULES[i][0].exec(message);
      if (!m) continue;
      var out = TH_RULES[i][1];
      return typeof out === 'function' ? out(m) : out.replace(/\$(\d)/g, function (_, n) { return m[n] || ''; });
    }
    return message;
  }

  /* ===================================================================== API */

  /**
   * env = {
   *   db: { read(table), append(table, rows), updateWhere(table, pred, patch), removeWhere(table, pred), lock(fn) },
   *   sessions: { get(key), put(key, value, ttlSeconds), remove(key) },
   *   uuid(): string,
   *   now(): Date
   * }
   */
  function createApi(env) {
    var db = env.db;

    function nowIso() { return env.now().toISOString(); }
    function newId(prefix) { return prefix + '-' + env.uuid().replace(/-/g, '').slice(0, 10).toUpperCase(); }

    /* ---------- reads ---------- */

    var writeDepth = 0;   // > 0 while a write action runs inside db.lock
    function settings() {
      var out = {};
      for (var k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
      db.read('Settings').forEach(function (r) { if (r.key) out[r.key] = trim(r.value); });
      return out;
    }
    function active(rows) { return rows.filter(function (r) { return bool(r.active); }); }
    function live(rows) { return rows.filter(function (r) { return !bool(r.voided); }); }

    function findOrFail(table, id, label) {
      var rows = db.read(table);
      for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
      fail('NOT_FOUND', (label || 'Item') + ' not found. It may have been removed — reload and try again.');
    }

    function onHandMap() {
      var m = {};
      live(db.read('Purchases')).forEach(function (p) { m[p.ingredientId] = (m[p.ingredientId] || 0) + num(p.qty); });
      live(db.read('StockMovements')).forEach(function (s) { m[s.ingredientId] = (m[s.ingredientId] || 0) + num(s.qty); });
      return m;
    }

    /* ---------- purchasing helpers ---------- */

    var OPEN_PO = ['draft', 'sent', 'partial'];

    /** Quantity received per PO line = stock-in rows linked to that line (single source of truth). */
    function receivedByLine(purchases) {
      var m = {};
      live(purchases || db.read('Purchases')).forEach(function (r) {
        if (r.poLineId) m[r.poLineId] = (m[r.poLineId] || 0) + num(r.qty);
      });
      return m;
    }

    /** Ordered but not yet received, per ingredient, across open orders. */
    function onOrderMap() {
      var open = {};
      db.read('PurchaseOrders').forEach(function (po) { if (OPEN_PO.indexOf(po.status) >= 0) open[po.id] = true; });
      var rec = receivedByLine();
      var m = {};
      db.read('PurchaseOrderLines').forEach(function (l) {
        if (!open[l.poId]) return;
        var left = num(l.qtyOrdered) - (rec[l.id] || 0);
        if (left > 0) m[l.ingredientId] = (m[l.ingredientId] || 0) + left;
      });
      return m;
    }

    // Joins Ingredients + IngredientUnits + PrepRecipes into the shape RestoCosting.buildBook expects.
    // `override` (optional) is a full ingredient object that replaces/adds the item being saved.
    function ingredientCostRows(override) {
      var convs = {}, lines = {};
      db.read('IngredientUnits').forEach(function (r) {
        (convs[r.ingredientId] = convs[r.ingredientId] || []).push({ unit: r.unit, factor: num(r.factor) });
      });
      db.read('PrepRecipes').forEach(function (r) {
        (lines[r.prepId] = lines[r.prepId] || []).push({ ingredientId: r.ingredientId, qty: num(r.qty), unit: r.unit,
          yieldPct: r.yieldPct, note: r.note || '' });
      });
      var out = db.read('Ingredients').filter(function (i) { return !override || i.id !== override.id; }).map(function (i) {
        var kind = trim(i.kind) === 'prep' ? 'prep' : 'raw';
        return { id: i.id, name: i.name, unit: i.unit, costPerUnit: num(i.costPerUnit),
          yieldPct: trim(i.yieldPct) === '' ? 100 : num(i.yieldPct), kind: kind,
          batchQty: num(i.batchQty), trackStock: trim(i.trackStock) === '' ? true : bool(i.trackStock),
          shelfLifeDays: trim(i.shelfLifeDays) === '' ? '' : num(i.shelfLifeDays),
          conversions: convs[i.id] || [], prepLines: kind === 'prep' ? (lines[i.id] || []) : [],
          allergens: trim(i.allergens) ? trim(i.allergens).split(',').map(trim).filter(Boolean) : [] };
      });
      if (override) out.push(override);
      return out;
    }
    function loadBook(override) { return RestoCosting.buildBook(ingredientCostRows(override)); }

    // prepCosts, with its thrown cycle/depth markers turned into validation errors.
    function prepCostsOrFail(book) {
      try { return RestoCosting.prepCosts(book); } catch (e) {
        if (e && e.code === 'CYCLE') fail('VALIDATION', e.prep + " can't contain itself (via " + e.via + ').');
        if (e && e.code === 'DEPTH') fail('VALIDATION', 'Preps can be nested at most 4 levels deep.');
        throw e;
      }
    }

    function recordCostChange(ingredientId, oldCost, newCost, source, refId, user) {
      var o = round(num(oldCost), 4), n = round(num(newCost), 4);
      if (o === n) return;
      db.append('CostChanges', [{ id: newId('CST'), date: nowIso().slice(0, 10), ingredientId: ingredientId,
        oldCost: o, newCost: n, source: source, refId: refId || '', createdAt: nowIso(), createdBy: user.username }]);
    }

    // Recomputes every prep's cost from its recipe and stores the ones that moved.
    function syncPrepCosts(user, source, refId) {
      var costs = prepCostsOrFail(loadBook());
      var changed = [];
      var ts = nowIso();
      db.read('Ingredients').forEach(function (i) {
        if (trim(i.kind) !== 'prep' || costs[i.id] === undefined) return;
        var next = round(costs[i.id], 4);
        var old = num(i.costPerUnit);
        if (Math.abs(next - old) <= 0.0001) return;
        db.updateWhere('Ingredients', function (x) { return x.id === i.id; },
          { costPerUnit: next, updatedAt: ts, updatedBy: user.username, version: num(i.version) + 1 });
        recordCostChange(i.id, old, next, source, refId, user);
        changed.push({ id: i.id, name: i.name, oldCost: old, newCost: next });
      });
      return changed;
    }

    /** Mean unitCost of each prep's last 5 non-voided production runs. */
    function actualUnitCosts() {
      var runs = live(db.read('ProductionRuns')).sort(newestFirst);
      var seen = {}, tot = {}, out = {};
      runs.forEach(function (r) {
        var n = seen[r.prepId] || 0;
        if (n >= 5) return;
        seen[r.prepId] = n + 1;
        tot[r.prepId] = (tot[r.prepId] || 0) + num(r.unitCost);
      });
      Object.keys(seen).forEach(function (k) { out[k] = round(tot[k] / seen[k], 4); });
      return out;
    }

    function stockLevels() {
      var onHand = onHandMap();
      var onOrder = onOrderMap();
      var suppliers = byId(db.read('Suppliers'));
      var costRowList = ingredientCostRows();
      var costRows = byId(costRowList);
      var allergenBook = RestoCosting.buildBook(costRowList);
      var actual = actualUnitCosts();
      return db.read('Ingredients').map(function (i) {
        var cr = costRows[i.id];
        var qty = round(onHand[i.id] || 0, 3);
        var min = num(i.minLevel);
        // A prep made fresh to order (not kept in stock) never runs low.
        var untracked = cr.kind === 'prep' && cr.trackStock === false;
        var status = untracked ? 'ok' : qty <= 0 ? 'out' : qty <= min ? 'low' : 'ok';
        return {
          id: i.id, name: i.name, code: trim(i.code), category: i.category, unit: i.unit,
          costPerUnit: round(num(i.costPerUnit), 4), minLevel: min, parLevel: num(i.parLevel),
          onOrder: round(onOrder[i.id] || 0, 3),
          supplierId: i.supplierId || '', supplierName: suppliers[i.supplierId] ? suppliers[i.supplierId].name : '',
          active: bool(i.active), version: num(i.version),
          onHand: qty, value: round(qty * num(i.costPerUnit)), status: status,
          yieldPct: cr.yieldPct, kind: cr.kind, batchQty: cr.batchQty, trackStock: cr.trackStock,
          shelfLifeDays: cr.shelfLifeDays, conversions: cr.conversions, prepLines: cr.prepLines,
          allergens: cr.allergens,
          allergensAll: RestoCosting.allergensFor([{ ingredientId: i.id }], allergenBook),
          portionNote: i.portionNote || '', holdingNote: i.holdingNote || '', equipment: i.equipment || '',
          prepMinutes: trim(i.prepMinutes) === '' ? '' : num(i.prepMinutes), photoUrl: i.photoUrl || '',
          actualUnitCost: actual[i.id] === undefined ? null : actual[i.id],
          costVariancePct: actual[i.id] === undefined || !(num(i.costPerUnit) > 0) ? null
            : round((actual[i.id] - num(i.costPerUnit)) / num(i.costPerUnit) * 100, 1)
        };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    function menuWithCost() {
      var ingredients = byId(db.read('Ingredients'));
      var book = loadBook();
      var costs = {};
      try { costs = RestoCosting.prepCosts(book); } catch (e) { costs = {}; }
      var recipes = {};
      db.read('Recipes').forEach(function (r) { (recipes[r.menuItemId] = recipes[r.menuItemId] || []).push(r); });
      var prices = {};
      db.read('MenuPrices').forEach(function (r) {
        if (trim(r.price) === '') return;
        (prices[r.menuItemId] = prices[r.menuItemId] || {})[r.channelId] = num(r.price);
      });
      return db.read('Menu').map(function (m) {
        var total = 0;
        var lines = (recipes[m.id] || []).map(function (r) {
          var ing = ingredients[r.ingredientId];
          var unit = trim(r.unit) || (ing ? ing.unit : '');
          var yl = trim(r.yieldPct) === '' ? '' : num(r.yieldPct);
          var res = RestoCosting.lineCost({ ingredientId: r.ingredientId, qty: num(r.qty), unit: unit, yieldPct: yl }, book, costs);
          total += res.cost;
          var bi = book.byId[r.ingredientId];
          return {
            ingredientId: r.ingredientId, name: ing ? ing.name : '(วัตถุดิบที่ถูกลบ)', kind: bi ? bi.kind : 'raw',
            unit: unit, stockUnit: ing ? ing.unit : '', qty: num(r.qty),
            yieldPct: yl === '' ? (bi ? bi.yieldPct : 100) : yl,
            grossQty: round(res.grossQty, 4), cost: round(res.cost, 4), rawCost: res.cost, share: 0, error: res.error || ''
          };
        });
        lines.forEach(function (l) { l.share = total > 0 ? round(l.rawCost / total * 100, 1) : 0; delete l.rawCost; });
        var cost = round(total, 2);
        var price = num(m.price);
        return {
          id: m.id, name: m.name, category: m.category, price: price, active: bool(m.active),
          version: num(m.version), recipe: lines, foodCost: cost, prices: prices[m.id] || {},
          allergens: RestoCosting.allergensFor(recipes[m.id] || [], book),
          portionNote: m.portionNote || '', holdingNote: m.holdingNote || '', equipment: m.equipment || '',
          prepMinutes: trim(m.prepMinutes) === '' ? '' : num(m.prepMinutes), photoUrl: m.photoUrl || '',
          foodCostPct: price > 0 ? round(cost / price * 100, 1) : null,
          margin: round(price - cost, 2)
        };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    function publicUser(u) {
      return { id: u.id, username: u.username, displayName: u.displayName || u.username, role: u.role,
        active: bool(u.active), version: num(u.version) };
    }

    /* ---------- generic master-data save with optimistic concurrency ---------- */

    // Creates the row when there is no id; otherwise updates it only if the version the
    // client edited is still the current one. This is what stops two people from silently
    // overwriting each other's edits.
    function saveRow(table, prefix, data, user, label) {
      var ts = nowIso();
      if (!data.id) {
        var row = {};
        SCHEMA[table].forEach(function (c) { row[c] = data[c] !== undefined ? data[c] : ''; });
        row.id = newId(prefix);
        row.active = data.active === undefined ? true : bool(data.active);
        row.createdAt = ts; row.updatedAt = ts; row.updatedBy = user.username; row.version = 1;
        if (SCHEMA[table].indexOf('createdBy') >= 0) row.createdBy = user.username;
        db.append(table, [row]);
        return row;
      }
      var current = findOrFail(table, data.id, label);
      if (num(data.version) !== num(current.version)) {
        fail('CONFLICT', (label || 'This item') + ' was changed by ' + (current.updatedBy || 'someone else') +
          ' while you were editing. Your changes were not saved — reload to see the latest version.');
      }
      var patch = {};
      SCHEMA[table].forEach(function (c) {
        if (data[c] !== undefined && ['id', 'createdAt', 'version'].indexOf(c) < 0) patch[c] = data[c];
      });
      if (patch.active !== undefined) patch.active = bool(patch.active);
      patch.updatedAt = ts; patch.updatedBy = user.username; patch.version = num(current.version) + 1;
      db.updateWhere(table, function (r) { return r.id === data.id; }, patch);
      var merged = {};
      for (var k in current) merged[k] = current[k];
      for (k in patch) merged[k] = patch[k];
      return merged;
    }

    function assertUnique(table, field, value, exceptId, label) {
      var v = trim(value).toLowerCase();
      var clash = db.read(table).some(function (r) {
        return r.id !== exceptId && trim(r[field]).toLowerCase() === v && (r.active === undefined || bool(r.active));
      });
      if (clash) fail('VALIDATION', label + ' "' + value + '" already exists.');
    }

    /* ---------- auth ---------- */

    function login(p) {
      var username = trim(p.username).toLowerCase();
      if (!username || !p.password) fail('VALIDATION', 'Enter your username and password.');
      var failKey = 'fail:' + username;
      var fails = num(env.sessions.get(failKey));
      if (fails >= MAX_FAILED_LOGINS) {
        fail('LOCKED', 'Too many failed attempts. Try again in 10 minutes or ask the owner to reset your password.');
      }
      var user = db.read('Users').filter(function (u) { return trim(u.username).toLowerCase() === username; })[0];
      if (!user || !bool(user.active) || hashPassword(String(p.password), user.salt) !== user.passwordHash) {
        env.sessions.put(failKey, String(fails + 1), LOCKOUT_SECONDS);
        fail('AUTH', 'Wrong username or password.');
      }
      env.sessions.remove(failKey);
      var token = env.uuid().replace(/-/g, '') + env.uuid().replace(/-/g, '');
      env.sessions.put('s:' + token, user.id, SESSION_TTL_SECONDS);
      return { token: token, user: publicUser(user) };
    }

    function userFromToken(token) {
      if (!token) fail('AUTH', 'Please sign in.');
      var userId = env.sessions.get('s:' + token);
      if (!userId) fail('AUTH', 'Your session has expired. Please sign in again.');
      var user = db.read('Users').filter(function (u) { return u.id === userId; })[0];
      if (!user || !bool(user.active)) {
        env.sessions.remove('s:' + token);
        fail('AUTH', 'Your account is no longer active.');
      }
      env.sessions.put('s:' + token, userId, SESSION_TTL_SECONDS); // slide expiry
      return user;
    }

    /* ---------- actions ---------- */

    var A = {};

    A['auth.logout'] = { role: 'staff', write: false, fn: function (p, user, req) {
      env.sessions.remove('s:' + req.token);
      return true;
    } };

    A['auth.changePassword'] = { role: 'staff', write: true, fn: function (p, user) {
      if (hashPassword(String(p.current || ''), user.salt) !== user.passwordHash) fail('VALIDATION', 'Current password is incorrect.');
      setPassword(user.id, p.next);
      return true;
    } };

    function setPassword(userId, password) {
      password = String(password || '');
      if (password.length < 8) fail('VALIDATION', 'Password must be at least 8 characters.');
      var salt = env.uuid().replace(/-/g, '');
      db.updateWhere('Users', function (r) { return r.id === userId; },
        { salt: salt, passwordHash: hashPassword(password, salt), updatedAt: nowIso() });
    }

    A['bootstrap'] = { role: 'staff', write: false, fn: function (p, user) {
      var isOwner = user.role === 'owner';
      return {
        version: VERSION,
        user: publicUser(user),
        settings: settings(),
        ingredients: stockLevels(),
        suppliers: db.read('Suppliers').map(function (s) {
          return { id: s.id, name: s.name, contactName: s.contactName, phone: s.phone, email: s.email,
            notes: s.notes, active: bool(s.active), version: num(s.version),
            // null = not set (orders then default to next-day delivery); 0 = same day.
            leadTimeDays: trim(s.leadTimeDays) === '' ? null : num(s.leadTimeDays), paymentTermsDays: num(s.paymentTermsDays) };
        }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
        menu: menuWithCost(),
        channels: ensureChannels(user),
        promotions: promoRows(p.today ? reqDate(p.today, 'Today') : todayStr()).filter(function (x) {
          // Also yesterday's last day: daily totals are often entered the next morning.
          return x.status === 'active' || x.status === 'scheduled' ||
            (x.status === 'ended' && x.endDate >= addDays(p.today ? reqDate(p.today, 'Today') : todayStr(), -1));
        }),
        users: isOwner ? db.read('Users').map(publicUser) : [],
        // Active people only (for "made by" pickers); every role gets it, with no account details.
        team: active(db.read('Users')).map(function (u) {
          return { username: u.username, displayName: u.displayName || u.username };
        }).sort(function (a, b) { return String(a.displayName).localeCompare(String(b.displayName)); }),
        purchasing: purchasingCounts(p.today)
      };
    } };

    A['stock.levels'] = { role: 'staff', write: false, fn: function () { return stockLevels(); } };

    /* Stock in */
    /**
     * Writes stock-in rows and updates ingredient costs. Used by ad-hoc "stock in" and by
     * receiving against a purchase order (lines then carry poLineId, header carries poId).
     */
    function addPurchases(header, lines, user) {
      var date = reqDate(header.date);
      if (!lines.length) fail('VALIDATION', 'Add at least one item to the purchase.');
      if (lines.length > 60) fail('VALIDATION', 'Too many lines in one purchase (max 60).');
      var supplierId = trim(header.supplierId);
      if (supplierId) findOrFail('Suppliers', supplierId, 'Supplier');
      var ingredients = byId(db.read('Ingredients'));
      var onHand = onHandMap();
      var method = settings().costMethod;
      var ts = nowIso();
      var rows = lines.map(function (l, i) {
        var ing = ingredients[l.ingredientId];
        if (!ing) fail('VALIDATION', 'Line ' + (i + 1) + ': choose an ingredient.');
        if (trim(ing.kind) === 'prep') fail('VALIDATION', 'Line ' + (i + 1) + ': ' + ing.name + ' is made in the kitchen. Record a production run instead.');
        var qty = reqNum(l.qty, 'Line ' + (i + 1) + ' quantity', { positive: true });
        var unitCost = reqNum(l.unitCost, 'Line ' + (i + 1) + ' unit cost', { min: 0 });
        return { id: newId('PUR'), date: date, supplierId: supplierId || ing.supplierId || '', ingredientId: ing.id,
          qty: round(qty, 3), unitCost: round(unitCost, 4), total: round(qty * unitCost),
          invoiceRef: optStr(header.invoiceRef, 60), note: optStr(header.note), voided: false, createdAt: ts, createdBy: user.username,
          poId: trim(header.poId), poLineId: trim(l.poLineId) };
      });
      var dishesBefore = menuWithCost();
      var oldCosts = {};
      db.append('Purchases', rows);
      // Update ingredient cost so recipe costing follows real prices.
      rows.forEach(function (r) {
        var ing = ingredients[r.ingredientId];
        var have = Math.max(0, onHand[ing.id] || 0);
        var oldCost = num(ing.costPerUnit);
        if (oldCosts[ing.id] === undefined) oldCosts[ing.id] = oldCost;
        var newCost = method === 'last' || have <= 0 || oldCost <= 0
          ? r.unitCost
          : (have * oldCost + r.qty * r.unitCost) / (have + r.qty);
        onHand[ing.id] = have + r.qty;
        ing.costPerUnit = round(newCost, 4);
        db.updateWhere('Ingredients', function (x) { return x.id === ing.id; },
          { costPerUnit: ing.costPerUnit, updatedAt: ts, updatedBy: user.username, version: num(ing.version) + 1 });
        ing.version = num(ing.version) + 1;
        recordCostChange(ing.id, oldCost, ing.costPerUnit, 'purchase', r.id, user);
      });
      var prepChanges = syncPrepCosts(user, 'prep', rows[0].id);
      return { count: rows.length, total: round(sum(rows, function (r) { return r.total; })),
        impact: buildImpact(dishesBefore, oldCosts, prepChanges) };
    }

    /** Which ingredients moved by 1% or more, and which active dishes now cost more or less. */
    function buildImpact(dishesBefore, oldCosts, prepChanges) {
      var ings = byId(db.read('Ingredients'));
      var moved = [];
      var seen = {};
      function consider(id, oldCost, newCost) {
        if (seen[id] || !ings[id] || !(oldCost > 0)) return;
        var pct = round((newCost - oldCost) / oldCost * 100, 1);
        if (Math.abs(pct) < 1) return;
        seen[id] = true;
        moved.push({ id: id, name: ings[id].name, oldCost: oldCost, newCost: newCost, changePct: pct });
      }
      Object.keys(oldCosts).forEach(function (id) { consider(id, oldCosts[id], num(ings[id] && ings[id].costPerUnit)); });
      prepChanges.forEach(function (c) { consider(c.id, c.oldCost, c.newCost); });
      var out = { ingredients: moved, dishes: [] };
      if (!moved.length) return out;
      var target = num(settings().targetFoodCostPct);
      var before = byId(dishesBefore);
      menuWithCost().forEach(function (d) {
        if (!d.active || !before[d.id]) return;
        var uses = d.recipe.some(function (l) { return seen[l.ingredientId]; });
        if (!uses) return;
        out.dishes.push({ id: d.id, name: d.name, oldCost: round(before[d.id].foodCost, 2), newCost: round(d.foodCost, 2),
          foodCostPct: d.foodCostPct, overTarget: d.foodCostPct !== null && d.foodCostPct > target });
      });
      out.dishes.sort(function (a, b) { return (b.newCost - b.oldCost) - (a.newCost - a.oldCost); });
      return out;
    }

    A['purchases.add'] = { role: 'staff', write: true, fn: function (p, user) {
      return addPurchases({ date: p.date, supplierId: p.supplierId, invoiceRef: p.invoiceRef, note: p.note },
        (p.lines || []).map(function (l) { return { ingredientId: l.ingredientId, qty: l.qty, unitCost: l.unitCost }; }), user);
    } };

    A['purchases.list'] = { role: 'staff', write: false, fn: function (p) {
      var ings = byId(db.read('Ingredients')), sups = byId(db.read('Suppliers'));
      return db.read('Purchases').filter(function (r) {
        return inRange(r.date, p.from, p.to) && (!p.ingredientId || r.ingredientId === p.ingredientId);
      })
        .sort(newestFirst).slice(0, num(p.limit) || 300).map(function (r) {
          return { id: r.id, date: r.date, ingredientId: r.ingredientId,
            ingredientName: (ings[r.ingredientId] || {}).name || '?', unit: (ings[r.ingredientId] || {}).unit || '',
            supplierName: (sups[r.supplierId] || {}).name || '', qty: num(r.qty), unitCost: num(r.unitCost),
            total: num(r.total), invoiceRef: r.invoiceRef, note: r.note, voided: bool(r.voided),
            createdAt: r.createdAt, createdBy: r.createdBy, poId: r.poId || '' };
        });
    } };

    /* Stock out & corrections */
    A['movements.add'] = { role: 'staff', write: true, fn: function (p, user) {
      var date = reqDate(p.date);
      var type = trim(p.type);
      if (['usage', 'waste', 'count', 'adjustment'].indexOf(type) < 0) fail('VALIDATION', 'Unknown stock movement type.');
      if (type === 'adjustment' && user.role === 'staff') fail('FORBIDDEN', 'Only a manager can make stock adjustments.');
      var lines = p.lines || [];
      if (!lines.length) fail('VALIDATION', 'Add at least one item.');
      var ingredients = byId(db.read('Ingredients'));
      var onHand = onHandMap();
      var reason = optStr(p.reason, 200);
      if (type === 'waste' && !reason) fail('VALIDATION', 'Say why it was wasted (e.g. expired, spoiled, dropped).');
      var ts = nowIso();
      var rows = [];
      lines.forEach(function (l, i) {
        var ing = ingredients[l.ingredientId];
        if (!ing) fail('VALIDATION', 'Line ' + (i + 1) + ': choose an ingredient.');
        var entered = reqNum(l.qty, 'Line ' + (i + 1) + ' quantity', type === 'count' ? { min: 0 } : type === 'adjustment' ? {} : { positive: true });
        var qty;
        if (type === 'count') qty = entered - (onHand[ing.id] || 0);   // counted amount → difference
        else if (type === 'adjustment') qty = entered;                  // signed
        else qty = -entered;                                            // usage / waste reduce stock
        qty = round(qty, 3);
        if (type === 'count' && qty === 0) return;                      // count matched, nothing to record
        var cost = num(ing.costPerUnit);
        rows.push({ id: newId('MOV'), date: date, ingredientId: ing.id, type: type, qty: qty, unitCost: round(cost, 4),
          value: round(qty * cost), reason: reason, refId: '',
          voided: false, createdAt: ts, createdBy: user.username });
      });
      if (rows.length) db.append('StockMovements', rows);
      return { count: rows.length, value: round(sum(rows, function (r) { return r.value; })) };
    } };

    A['movements.list'] = { role: 'staff', write: false, fn: function (p) {
      var ings = byId(db.read('Ingredients'));
      return db.read('StockMovements').filter(function (r) {
        return inRange(r.date, p.from, p.to) && (!p.type || r.type === p.type) &&
          (!p.ingredientId || r.ingredientId === p.ingredientId) && (p.includeSales || r.type !== 'sale');
      }).sort(newestFirst).slice(0, num(p.limit) || 300).map(function (r) {
        return { id: r.id, date: r.date, ingredientId: r.ingredientId, ingredientName: (ings[r.ingredientId] || {}).name || '?',
          unit: (ings[r.ingredientId] || {}).unit || '', type: r.type, qty: num(r.qty), value: num(r.value),
          reason: r.reason, refId: r.refId, voided: bool(r.voided), createdAt: r.createdAt, createdBy: r.createdBy };
      });
    } };

    function voidRow(table, id, user, label) {
      var row = findOrFail(table, id, label);
      if (bool(row.voided)) fail('VALIDATION', label + ' is already voided.');
      var note = trim(row.note);
      var patch = { voided: true };
      if (SCHEMA[table].indexOf('note') >= 0) patch.note = (note ? note + ' · ' : '') + 'ยกเลิกโดย ' + user.username + ' ' + nowIso().slice(0, 10);
      db.updateWhere(table, function (r) { return r.id === id; }, patch);
      return row;
    }

    A['purchases.void'] = { role: 'manager', write: true, fn: function (p, user) {
      var row = voidRow('Purchases', p.id, user, 'Purchase line');
      if (row.poId) refreshPoStatus(row.poId, user);
      return true;
    } };
    A['movements.void'] = { role: 'manager', write: true, fn: function (p, user) {
      var row = findOrFail('StockMovements', p.id, 'Stock entry');
      if (row.type === 'sale') fail('VALIDATION', 'Sale deductions are removed by voiding the sale itself.');
      if (row.type === 'production' || row.type === 'produce' || row.type === 'byproduct') fail('VALIDATION', 'Production entries are removed by voiding the production run.');
      voidRow('StockMovements', p.id, user, 'Stock entry'); return true;
    } };

    /* Master data */
    function checkYield(v) {
      var n = Number(v);
      if (!isFinite(n) || n < 1 || n > 1000) fail('VALIDATION', 'Yield must be between 1 and 1000 %.');
      return n;
    }
    A['ingredients.save'] = { role: 'manager', write: true, fn: function (p, user) {
      var d = p.item || {};
      var kind = trim(d.kind) === 'prep' ? 'prep' : 'raw';
      var yieldPct = trim(d.yieldPct) === '' ? '' : checkYield(d.yieldPct);
      var data = { id: trim(d.id), version: d.version, name: reqStr(d.name, 'Name', 80), category: optStr(d.category, 60),
        unit: reqStr(d.unit, 'Unit', 20), costPerUnit: kind === 'prep' ? 0 : round(reqNum(d.costPerUnit, 'Cost per unit', { min: 0 }), 4),
        minLevel: round(reqNum(d.minLevel, 'Minimum level', { min: 0 }), 3), supplierId: trim(d.supplierId),
        parLevel: d.parLevel === '' || d.parLevel === undefined || d.parLevel === null ? '' : round(reqNum(d.parLevel, 'Par level', { min: 0 }), 3),
        active: d.active === undefined ? true : bool(d.active),
        yieldPct: yieldPct, kind: kind, batchQty: '',
        trackStock: d.trackStock === undefined || trim(d.trackStock) === '' ? true : bool(d.trackStock),
        shelfLifeDays: optInt(d.shelfLifeDays, 'Shelf life (days)') };
      if (d.code !== undefined) data.code = optStr(d.code, 30);
      if (d.allergens !== undefined) {
        var codes = (d.allergens || []).map(trim).filter(Boolean);
        codes.forEach(function (a) { if (RestoCosting.ALLERGENS.indexOf(a) < 0) fail('VALIDATION', 'Unknown allergen.'); });
        data.allergens = RestoCosting.ALLERGENS.filter(function (a) { return codes.indexOf(a) >= 0; }).join(',');
      }
      if (kind === 'prep') data.batchQty = round(reqNum(d.batchQty, 'Batch quantity', { positive: true }), 4);
      else data.trackStock = true;
      if (data.supplierId) findOrFail('Suppliers', data.supplierId, 'Supplier');
      if (data.active) assertUnique('Ingredients', 'name', data.name, data.id, 'Ingredient');
      if (data.active && data.code) assertUnique('Ingredients', 'code', data.code, data.id, 'Ingredient code');

      var units = (p.units || []).map(function (u) {
        var unit = reqStr(u.unit, 'Conversion unit', 20);
        var factor = Number(u.factor);
        if (u.factor === '' || u.factor === null || u.factor === undefined || !isFinite(factor) || factor <= 0) {
          fail('VALIDATION', 'Conversion factor must be greater than 0.');
        }
        if (RestoCosting.sameUnit(unit, data.unit)) fail('VALIDATION', "A conversion can't use the stock unit itself.");
        return { unit: RestoCosting.unitCode(unit) || unit, factor: factor };
      });

      var current = data.id ? findOrFail('Ingredients', data.id, 'Ingredient "' + data.name + '"') : null;
      var tempId = data.id || '__new__';
      var allIngs = byId(db.read('Ingredients'));
      var lines = [];
      if (kind === 'prep') {
        var seen = {};
        lines = (p.prepRecipe || []).map(function (l, i) {
          var ing = allIngs[l.ingredientId];
          if (!ing && data.id && l.ingredientId === data.id) ing = data;
          if (!ing) fail('VALIDATION', 'Recipe line ' + (i + 1) + ': choose an ingredient.');
          if (seen[l.ingredientId]) fail('VALIDATION', ing.name + ' is in the recipe twice.');
          seen[l.ingredientId] = true;
          var ly = trim(l.yieldPct) === '' ? '' : checkYield(l.yieldPct);
          var unit = trim(l.unit) || ing.unit;
          return { ingredientId: l.ingredientId, qty: round(reqNum(l.qty, 'Recipe line ' + (i + 1) + ' quantity', { positive: true }), 4),
            unit: RestoCosting.unitCode(unit) || unit, yieldPct: ly, note: optStr(l.note, 120) };
        });
        if (!lines.length) fail('VALIDATION', 'A prep needs at least one recipe line.');
      }

      // Validate against a book that already contains this item with its new lines/conversions.
      var override = { id: tempId, name: data.name, unit: data.unit, costPerUnit: num(current && current.costPerUnit),
        yieldPct: data.yieldPct === '' ? 100 : data.yieldPct, kind: kind, batchQty: num(data.batchQty),
        trackStock: data.trackStock, conversions: units, prepLines: lines };
      var book = loadBook(override);
      // Every stored prep line and dish recipe line (not just this item's) must still convert after this edit.
      function cantConvert(l, usedIn) {
        var bi = book.byId[l.ingredientId];
        var u = trim(l.unit) || bi.unit;
        fail('VALIDATION', "Can't convert " + u + ' to ' + bi.unit + ' for ' + bi.name + '. Add a conversion on the ingredient. Used in ' + usedIn + '.');
      }
      Object.keys(book.byId).forEach(function (pid) {
        (book.byId[pid].prepLines || []).forEach(function (l) {
          if (RestoCosting.lineCost(l, book, {}).error === 'unit') cantConvert(l, book.byId[pid].name);
        });
      });
      var menuNames = {};
      db.read('Menu').forEach(function (m) { menuNames[m.id] = m.name; });
      db.read('Recipes').forEach(function (r) {
        if (!book.byId[r.ingredientId] || menuNames[r.menuItemId] === undefined) return;
        var l = { ingredientId: r.ingredientId, qty: r.qty, unit: trim(r.unit) || book.byId[r.ingredientId].unit, yieldPct: r.yieldPct };
        if (RestoCosting.lineCost(l, book, {}).error === 'unit') cantConvert(l, menuNames[r.menuItemId]);
      });
      var costs = prepCostsOrFail(book);
      // An existing prep keeps its stored cost here; syncPrepCosts below moves it and logs the change.
      if (kind === 'prep') {
        data.costPerUnit = current && trim(current.kind) === 'prep' ? num(current.costPerUnit) : round(costs[tempId] || 0, 4);
      }

      if (!data.id) delete data.id;
      var saved = saveRow('Ingredients', 'ING', data, user, 'Ingredient "' + data.name + '"');
      if (current) recordCostChange(saved.id, current.costPerUnit, saved.costPerUnit, 'manual', saved.id, user);
      db.removeWhere('IngredientUnits', function (r) { return r.ingredientId === saved.id; });
      if (units.length) {
        db.append('IngredientUnits', units.map(function (u) {
          return { id: newId('IUN'), ingredientId: saved.id, unit: u.unit, factor: u.factor };
        }));
      }
      db.removeWhere('PrepRecipes', function (r) { return r.prepId === saved.id; });
      if (lines.length) {
        db.append('PrepRecipes', lines.map(function (l) {
          return { id: newId('PRL'), prepId: saved.id, ingredientId: l.ingredientId, qty: l.qty, unit: l.unit,
            yieldPct: l.yieldPct, note: l.note };
        }));
      }
      syncPrepCosts(user, 'prep', saved.id);
      return db.read('Ingredients').filter(function (r) { return r.id === saved.id; })[0];
    } };

    A['ingredients.costHistory'] = { role: 'manager', write: false, fn: function (p) {
      var id = trim(p.id);
      var rows = db.read('CostChanges').map(function (r, i) { r._i = i; return r; })
        .filter(function (r) { return r.ingredientId === id; });
      rows.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        return b._i - a._i;
      });
      return rows.slice(0, num(p.limit) || 50).map(function (r) {
        var o = num(r.oldCost), n = num(r.newCost);
        return { date: r.date, oldCost: o, newCost: n, changePct: o === 0 ? null : round((n - o) / o * 100, 1),
          source: r.source, refId: r.refId || '' };
      });
    } };

    /* Sales channels */
    function guessChannelType(name) {
      var n = trim(name).toLowerCase();
      if (/dine|ทาน|ร้าน/.test(n)) return 'dineIn';
      if (/take|กลับ|to go/.test(n)) return 'takeaway';
      if (/deliver|เดลิ|grab|line ?man|panda|shopee|robinhood|uber|doordash|deliveroo|just ?eat/.test(n)) return 'delivery';
      return 'other';
    }
    function channelRows() {
      return db.read('Channels').map(function (c) {
        return { id: c.id, name: trim(c.name), type: CHANNEL_TYPES.indexOf(c.type) >= 0 ? c.type : 'other',
          commissionPct: num(c.commissionPct), packagingCost: num(c.packagingCost),
          commissionOnDiscounted: trim(c.commissionOnDiscounted) === '' ? true : bool(c.commissionOnDiscounted),
          active: bool(c.active), sortOrder: num(c.sortOrder), version: num(c.version) };
      }).sort(function (a, b) { return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name); });
    }
    /** Channels as records; the first call turns the old comma-separated list into rows. */
    function ensureChannels(user) {
      if (db.read('Channels').length) return channelRows();
      // Inside a write we already hold the lock; taking it again would deadlock or release it early.
      (writeDepth ? function (fn) { return fn(); } : db.lock)(function () {
        if (db.read('Channels').length) return;
        var ts = nowIso();
        db.append('Channels', list(settings().salesChannels).map(function (name, i) {
          return { id: newId('CHN'), name: name, type: guessChannelType(name), commissionPct: 0, packagingCost: 0,
            commissionOnDiscounted: true, active: true, sortOrder: i, createdAt: ts, updatedAt: ts,
            updatedBy: (user && user.username) || 'system', version: 1 };
        }));
      });
      return channelRows();
    }
    /** The channel a sale belongs to: by id, else by name (older rows store only the name), else null. */
    function resolveChannel(sale, channels) {
      var id = trim(sale.channelId), i;
      if (id) for (i = 0; i < channels.length; i++) if (channels[i].id === id) return channels[i];
      var name = trim(sale.channel).toLowerCase();
      if (name) for (i = 0; i < channels.length; i++) if (channels[i].name.toLowerCase() === name) return channels[i];
      return null;
    }

    A['channels.save'] = { role: 'manager', write: true, fn: function (p, user) {
      ensureChannels(user);
      var d = p.item || {};
      var type = trim(d.type);
      if (CHANNEL_TYPES.indexOf(type) < 0) fail('VALIDATION', 'Unknown channel type.');
      var c = reqNum(d.commissionPct === '' || d.commissionPct === undefined ? 0 : d.commissionPct, 'Commission %');
      if (c < 0 || c > 99.9) fail('VALIDATION', 'Commission must be between 0 and 99.9 %.');
      var data = { id: trim(d.id), version: d.version, name: reqStr(d.name, 'Name', 40), type: type, commissionPct: round(c, 2),
        packagingCost: round(reqNum(d.packagingCost === '' || d.packagingCost === undefined ? 0 : d.packagingCost, 'Packaging cost', { min: 0 }), 2),
        commissionOnDiscounted: d.commissionOnDiscounted === undefined ? true : bool(d.commissionOnDiscounted),
        active: d.active === undefined ? true : bool(d.active) };
      if (d.sortOrder !== undefined && d.sortOrder !== '') data.sortOrder = num(d.sortOrder);
      if (data.active) assertUnique('Channels', 'name', data.name, data.id, 'Sales channel');
      if (!data.active) {
        var others = channelRows().filter(function (x) { return x.active && x.id !== data.id; });
        if (!others.length) fail('VALIDATION', 'Keep at least one active sales channel.');
      }
      if (!data.id) {
        delete data.id;
        if (data.sortOrder === undefined) data.sortOrder = channelRows().length;
      }
      var saved = saveRow('Channels', 'CHN', data, user, 'Sales channel "' + data.name + '"');
      return channelRows().filter(function (x) { return x.id === saved.id; })[0];
    } };

    A['suppliers.save'] = { role: 'manager', write: true, fn: function (p, user) {
      var d = p.item || {};
      var data = { id: trim(d.id), version: d.version, name: reqStr(d.name, 'Supplier name', 80),
        contactName: optStr(d.contactName, 80), phone: optStr(d.phone, 40), email: optStr(d.email, 120),
        notes: optStr(d.notes), active: d.active === undefined ? true : bool(d.active),
        leadTimeDays: optInt(d.leadTimeDays, 'Lead time (days)'), paymentTermsDays: optInt(d.paymentTermsDays, 'Payment terms (days)') };
      if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) fail('VALIDATION', 'Email address looks wrong.');
      if (data.active) assertUnique('Suppliers', 'name', data.name, data.id, 'Supplier');
      if (!data.id) delete data.id;
      return saveRow('Suppliers', 'SUP', data, user, 'Supplier "' + data.name + '"');
    } };

    A['menu.save'] = { role: 'manager', write: true, fn: function (p, user) {
      var d = p.item || {};
      var data = { id: trim(d.id), version: d.version, name: reqStr(d.name, 'Dish name', 80), category: optStr(d.category, 60),
        price: round(reqNum(d.price, 'Selling price', { min: 0 }), 2), active: d.active === undefined ? true : bool(d.active) };
      if (data.active) assertUnique('Menu', 'name', data.name, data.id, 'Dish');
      var ingredients = byId(db.read('Ingredients'));
      var seen = {};
      var recipe = (p.recipe || []).map(function (l, i) {
        if (!ingredients[l.ingredientId]) fail('VALIDATION', 'Recipe line ' + (i + 1) + ': choose an ingredient.');
        if (seen[l.ingredientId]) fail('VALIDATION', ingredients[l.ingredientId].name + ' is in the recipe twice.');
        seen[l.ingredientId] = true;
        var ly = trim(l.yieldPct) === '' ? '' : checkYield(l.yieldPct);
        var unit = trim(l.unit);
        return { ingredientId: l.ingredientId, qty: round(reqNum(l.qty, 'Recipe line ' + (i + 1) + ' quantity', { positive: true }), 4),
          unit: unit ? (RestoCosting.unitCode(unit) || unit) : '', yieldPct: ly, note: optStr(l.note, 120) };
      });
      var cbook = loadBook();
      recipe.forEach(function (l) {
        var ing = cbook.byId[l.ingredientId];
        var r = RestoCosting.lineCost({ ingredientId: l.ingredientId, qty: l.qty, unit: l.unit || ing.unit, yieldPct: l.yieldPct }, cbook, {});
        if (r.error === 'unit') fail('VALIDATION', "Can't convert " + (l.unit || ing.unit) + ' to ' + ing.unit + ' for ' + ing.name + '. Add a conversion on the ingredient.');
      });
      var priceRows = null, sentChannels = {};
      if (p.prices !== undefined) {
        ensureChannels(user);
        priceRows = [];
        (p.prices || []).forEach(function (x) {
          findOrFail('Channels', trim(x.channelId), 'Sales channel');
          sentChannels[trim(x.channelId)] = true;
          if (trim(x.price) === '') return;
          priceRows.push({ channelId: trim(x.channelId), price: round(reqNum(x.price, data.name + ' price', { min: 0 }), 2) });
        });
      }
      if (!data.id) delete data.id;
      var saved = saveRow('Menu', 'MENU', data, user, 'Dish "' + data.name + '"');
      if (priceRows) {
        // Only the channels the editor sent are replaced; prices on channels it didn't show (turned off) stay.
        db.removeWhere('MenuPrices', function (r) { return r.menuItemId === saved.id && sentChannels[r.channelId]; });
        if (priceRows.length) db.append('MenuPrices', priceRows.map(function (x) {
          return { id: newId('MPR'), menuItemId: saved.id, channelId: x.channelId, price: x.price };
        }));
      }
      db.removeWhere('Recipes', function (r) { return r.menuItemId === saved.id; });
      if (recipe.length) {
        db.append('Recipes', recipe.map(function (l) {
          return { id: newId('REC'), menuItemId: saved.id, ingredientId: l.ingredientId, qty: l.qty, note: l.note, unit: l.unit, yieldPct: l.yieldPct };
        }));
      }
      return menuWithCost().filter(function (m) { return m.id === saved.id; })[0];
    } };

    A['menu.applyPrices'] = { role: 'manager', write: true, fn: function (p, user) {
      ensureChannels(user);
      var channel = findOrFail('Channels', trim(p.channelId), 'Sales channel');
      var items = p.items || [];
      if (items.length > 200) fail('VALIDATION', 'Too many dishes in one update (max 200).');
      var menu = byId(db.read('Menu'));
      var rows = items.map(function (x, i) {
        var dish = menu[x.menuItemId];
        if (!dish) fail('VALIDATION', 'Line ' + (i + 1) + ': dish not found.');
        return { menuItemId: dish.id, price: round(reqNum(x.price, dish.name + ' price', { positive: true }), 2) };
      });
      rows.forEach(function (r) {
        var n = db.updateWhere('MenuPrices', function (x) { return x.menuItemId === r.menuItemId && x.channelId === channel.id; }, { price: r.price });
        if (!n) db.append('MenuPrices', [{ id: newId('MPR'), menuItemId: r.menuItemId, channelId: channel.id, price: r.price }]);
      });
      return { count: rows.length };
    } };

    /* Sales */
    function listPriceFor(dish, channelId) {
      return dish.prices && dish.prices[channelId] !== undefined ? dish.prices[channelId] : dish.price;
    }

    A['sales.add'] = { role: 'staff', write: true, fn: function (p, user) {
      var date = reqDate(p.date);
      var channels = ensureChannels(user);
      var ch = trim(p.channelId) ? resolveChannel({ channelId: p.channelId }, channels)
        : trim(p.channel) ? resolveChannel({ channel: p.channel }, channels)
          : channels.filter(function (c) { return c.active; })[0];
      if (!ch) fail('VALIDATION', 'Choose a sales channel.');
      if (!ch.active) fail('VALIDATION', 'This sales channel is turned off.');
      var channel = ch.name;
      var lines = (p.lines || []).filter(function (l) { return num(l.qty) !== 0; });
      if (!lines.length) fail('VALIDATION', 'Enter a quantity for at least one dish.');
      var menu = byId(menuWithCost());
      var ingredients = byId(db.read('Ingredients'));
      var book = loadBook();
      var ts = nowIso();
      var sales = [], moves = [], noRecipe = [];
      var promos = null;
      // One unit of a dish at a promotion's price: what the restaurant is credited, discount split and commission.
      function promoUnit(promo, item, promoPriceEach) {
        return RestoPricing.promoEconomics({ type: 'fixedPrice', value: promoPriceEach, platformFundedPct: promo.platformFundedPct,
          campaignCommissionPct: promo.campaignCommissionPct, targetPct: 30, channel: ch,
          items: [{ id: item.id, name: item.name, listPrice: listPriceFor(item, ch.id), foodCost: item.foodCost, qty: 1 }] }).rows[0];
      }
      function findPromo(id) {
        promos = promos || byId(promoRows(date));
        var promo = promos[trim(id)];
        if (!promo) findOrFail('Promotions', trim(id), 'Promotion');
        if (!promoActiveFor(promo, date, ch.id)) fail('VALIDATION', 'Promotion "' + promo.name + '" isn\'t running on this date and channel.');
        return promo;
      }
      // Expand bundle lines into one line per component; price promo lines on the server (client prices are ignored).
      var expanded = [];
      lines.forEach(function (l, i) {
        if (trim(l.promoId)) {
          var promo = findPromo(l.promoId);
          var n = reqNum(l.qty, 'Line ' + (i + 1) + ' quantity', { positive: true });
          if (Math.round(n) !== n) fail('VALIDATION', 'Line ' + (i + 1) + ': quantity must be a whole number.');
          if (promo.type === 'bundle') {
            var comps = promo.items.filter(function (c) { return menu[c.menuItemId]; }).map(function (c) {
              var d = menu[c.menuItemId];
              return { id: d.id, item: d, listPrice: listPriceFor(d, ch.id), qty: c.qty };
            });
            var split = byId(RestoPricing.bundleSplit(comps, promo.value));
            comps.forEach(function (c) {
              expanded.push({ item: c.item, qty: n * c.qty, promo: promo, unit: promoUnit(promo, c.item, split[c.id].unitPrice), note: l.note });
            });
            return;
          }
          var dish = menu[l.menuItemId];
          if (!dish) fail('VALIDATION', 'Line ' + (i + 1) + ': dish not found.');
          if (!promo.items.some(function (x) { return x.menuItemId === dish.id; })) fail('VALIDATION', "Dish isn't in this promotion.");
          var each = RestoPricing.promoPrice(promo.type, promo.value, listPriceFor(dish, ch.id));
          expanded.push({ item: dish, qty: n, promo: promo, unit: promoUnit(promo, dish, each), note: l.note });
          return;
        }
        var item = menu[l.menuItemId];
        if (!item) fail('VALIDATION', 'Line ' + (i + 1) + ': dish not found.');
        expanded.push({ item: item, qty: l.qty, price: l.unitPrice, note: l.note });
      });
      expanded.forEach(function (x) {
        var item = x.item;
        var qty = reqNum(x.qty, item.name + ' quantity', { positive: true });
        if (Math.round(qty) !== qty) fail('VALIDATION', item.name + ': quantity must be a whole number.');
        var listPrice = listPriceFor(item, ch.id);
        var price, commission, discount = 0, platformDiscount = 0;
        if (x.unit) {
          price = x.unit.credited;
          discount = x.unit.discount;
          platformDiscount = x.unit.platformDiscount;
          commission = x.unit.commission * qty;
        } else {
          price = x.price === undefined || x.price === '' ? listPrice : reqNum(x.price, item.name + ' price', { min: 0 });
          commission = ch.commissionPct / 100 * (ch.commissionOnDiscounted ? price : listPrice) * qty;
        }
        var sale = { id: newId('SAL'), date: date, menuItemId: item.id, itemName: item.name, qty: qty, unitPrice: round(price),
          total: round(qty * price), unitCost: item.foodCost, costTotal: round(qty * item.foodCost), channel: channel,
          note: optStr(x.note, 200), voided: false, createdAt: ts, createdBy: user.username,
          channelId: ch.id, commission: round(commission), promoId: x.promo ? x.promo.id : '', listPrice: round(listPrice),
          discount: round(discount), platformDiscount: round(platformDiscount) };
        sales.push(sale);
        if (!item.recipe.length) noRecipe.push(item.name);
        // Each dish sold deducts its recipe ingredients from stock.
        item.recipe.forEach(function (r) {
          RestoCosting.explode({ ingredientId: r.ingredientId, qty: r.qty, unit: r.unit, yieldPct: r.yieldPct }, qty, book).forEach(function (x) {
            var ing = ingredients[x.ingredientId];
            if (!ing) return;
            var q = round(-x.qty, 4);
            moves.push({ id: newId('MOV'), date: date, ingredientId: x.ingredientId, type: 'sale', qty: q,
              unitCost: round(num(ing.costPerUnit), 4), value: round(q * num(ing.costPerUnit)),
              reason: qty + ' × ' + item.name, refId: sale.id, voided: false, createdAt: ts, createdBy: user.username });
          });
        });
      });
      db.append('Sales', sales);
      if (moves.length) db.append('StockMovements', moves);
      return { count: sales.length, total: round(sum(sales, function (s) { return s.total; })), noRecipe: noRecipe };
    } };

    A['sales.list'] = { role: 'staff', write: false, fn: function (p) {
      var rows = db.read('Sales').filter(function (r) { return inRange(r.date, p.from, p.to); }).sort(newestFirst);
      var liveRows = live(rows);
      return {
        rows: rows.slice(0, num(p.limit) || 500).map(function (r) {
          return { id: r.id, date: r.date, menuItemId: r.menuItemId, itemName: r.itemName, qty: num(r.qty),
            unitPrice: num(r.unitPrice), total: num(r.total), costTotal: num(r.costTotal), channel: r.channel,
            channelId: trim(r.channelId), commission: num(r.commission), listPrice: trim(r.listPrice) === '' ? num(r.unitPrice) : num(r.listPrice),
            promoId: trim(r.promoId), discount: num(r.discount), platformDiscount: num(r.platformDiscount),
            note: r.note, voided: bool(r.voided), createdAt: r.createdAt, createdBy: r.createdBy };
        }),
        total: round(sum(liveRows, function (r) { return num(r.total); })),
        cost: round(sum(liveRows, function (r) { return num(r.costTotal); })),
        commission: round(sum(liveRows, function (r) { return num(r.commission); })),
        dishes: sum(liveRows, function (r) { return num(r.qty); })
      };
    } };

    A['sales.void'] = { role: 'manager', write: true, fn: function (p, user) {
      voidRow('Sales', p.id, user, 'Sale');
      db.updateWhere('StockMovements', function (r) { return r.refId === p.id && r.type === 'sale'; }, { voided: true });
      return true;
    } };

    /* Production runs */
    function mergeQty(list) {
      var acc = {}, order = [];
      list.forEach(function (x) {
        if (!Object.prototype.hasOwnProperty.call(acc, x.ingredientId)) { acc[x.ingredientId] = 0; order.push(x.ingredientId); }
        acc[x.ingredientId] += x.qty;
      });
      return order.map(function (id) { return { ingredientId: id, qty: round(acc[id], 4) }; });
    }
    function convertLine(l, ingredients, book, label) {
      var ing = ingredients[l.ingredientId];
      if (!ing) fail('VALIDATION', label + ': choose an ingredient.');
      var q = reqNum(l.qty, label + ' quantity', { positive: true });
      var conv = RestoCosting.convertQty(q, trim(l.unit) || ing.unit, book.byId[ing.id]);
      if (conv === null) fail('VALIDATION', "Can't convert " + l.unit + ' to ' + ing.unit + ' for ' + ing.name + '. Add a conversion on the ingredient.');
      return { ingredientId: ing.id, qty: conv };
    }
    A['production.add'] = { role: 'staff', write: true, fn: function (p, user) {
      var date = reqDate(p.date);
      var ingredients = byId(db.read('Ingredients'));
      var book = loadBook();
      var prep = ingredients[trim(p.prepId)];
      if (!prep || trim(prep.kind) !== 'prep') fail('VALIDATION', 'Choose a prep item to produce.');
      if (prep.trackStock === false) fail('VALIDATION', prep.name + " is made to order and isn't kept in stock.");
      var batches = reqNum(p.batches, 'Batches', { positive: true });
      var produced = reqNum(p.producedQty, 'Quantity made', { positive: true });
      var by = trim(p.producedBy) || user.username;
      var maker = active(db.read('Users')).filter(function (u) { return u.username === by; })[0];
      if (!maker) fail('VALIDATION', 'Choose who made it.');
      var bp = book.byId[prep.id];
      var inputs;
      if (p.inputs && p.inputs.length) {
        var acc = [];
        p.inputs.forEach(function (l, i) {
          var c = convertLine(l, ingredients, book, 'Input ' + (i + 1));
          var bi = book.byId[c.ingredientId];
          if (bi && bi.kind === 'prep' && bi.trackStock === false) {
            RestoCosting.explode({ ingredientId: c.ingredientId, qty: c.qty, unit: bi.unit, yieldPct: 100 }, 1, book).forEach(function (x) { acc.push(x); });
          } else acc.push(c);
        });
        inputs = mergeQty(acc);
      } else {
        var dflt = [];
        (bp.prepLines || []).forEach(function (line) {
          RestoCosting.explode(line, batches, book).forEach(function (x) { dflt.push(x); });
        });
        inputs = mergeQty(dflt);
      }
      var byproducts = [];
      (p.byproducts || []).forEach(function (l, i) {
        if (trim(l.ingredientId) === prep.id) fail('VALIDATION', "A by-product can't be the item being produced.");
        var bpi = ingredients[trim(l.ingredientId)];
        if (bpi && trim(bpi.kind) === 'prep' && bpi.trackStock === false) fail('VALIDATION', bpi.name + " is made to order and isn't kept in stock.");
        byproducts.push(convertLine(l, ingredients, book, 'By-product ' + (i + 1)));
      });
      byproducts = mergeQty(byproducts);
      var costOf = function (id) { return ingredients[id] ? num(ingredients[id].costPerUnit) : 0; };
      var rc = RestoCosting.runCost({ inputs: inputs, byproducts: byproducts, producedQty: produced }, costOf);
      var onHand = onHandMap();
      var warnings = [];
      inputs.forEach(function (x) {
        var have = onHand[x.ingredientId] || 0;
        if (x.qty > have) warnings.push({ ingredientId: x.ingredientId, name: ingredients[x.ingredientId].name, onHand: round(have, 3), needed: x.qty });
      });
      var ts = nowIso();
      var expected = round(num(bp.batchQty) * batches, 4);
      var runNo = formatRunNo(db.read('ProductionRuns').length + 1);
      var run = { id: newId('RUN'), runNo: runNo, date: date, prepId: prep.id, batches: batches, expectedQty: expected,
        producedQty: produced, unit: prep.unit, inputCost: rc.inputCost, byproductValue: rc.byproductValue,
        totalCost: rc.totalCost, unitCost: rc.unitCost, yieldPct: expected > 0 ? round(produced / expected * 100, 1) : '',
        producedBy: maker.username, note: optStr(p.note, 200), voided: false, createdAt: ts, createdBy: user.username };
      var moves = [];
      function mv(id, type, qty, unitCost, value) {
        moves.push({ id: newId('MOV'), date: date, ingredientId: id, type: type, qty: qty, unitCost: unitCost, value: value,
          reason: runNo, refId: run.id, voided: false, createdAt: ts, createdBy: user.username });
      }
      inputs.forEach(function (x) { mv(x.ingredientId, 'production', -x.qty, round(costOf(x.ingredientId), 4), round(-x.qty * costOf(x.ingredientId))); });
      mv(prep.id, 'produce', produced, rc.unitCost, round(produced * rc.unitCost));
      byproducts.forEach(function (x) { mv(x.ingredientId, 'byproduct', x.qty, round(costOf(x.ingredientId), 4), round(x.qty * costOf(x.ingredientId))); });
      db.append('ProductionRuns', [run]);
      db.append('StockMovements', moves);
      return { run: run, warnings: warnings };
    } };

    A['production.list'] = { role: 'staff', write: false, fn: function (p) {
      var ings = byId(db.read('Ingredients'));
      var users = {};
      db.read('Users').forEach(function (u) { users[u.username] = u.displayName; });
      return db.read('ProductionRuns').filter(function (r) {
        return inRange(r.date, p.from, p.to) && (!p.prepId || r.prepId === p.prepId);
      }).sort(newestFirst).slice(0, num(p.limit) || 300).map(function (r) {
        var o = {};
        SCHEMA.ProductionRuns.forEach(function (c) { o[c] = r[c]; });
        ['batches', 'expectedQty', 'producedQty', 'inputCost', 'byproductValue', 'totalCost', 'unitCost'].forEach(function (c) { o[c] = num(r[c]); });
        o.yieldPct = r.yieldPct === '' ? '' : num(r.yieldPct);
        o.voided = bool(r.voided);
        o.prepName = (ings[r.prepId] || {}).name || '?';
        o.producedByName = users[r.producedBy] || r.producedBy;
        return o;
      });
    } };

    A['production.void'] = { role: 'manager', write: true, fn: function (p, user) {
      var row = voidRow('ProductionRuns', p.id, user, 'Production run');
      db.updateWhere('StockMovements', function (r) { return r.refId === row.id; }, { voided: true });
      return true;
    } };

    /* Expenses */
    A['expenses.add'] = { role: 'manager', write: true, fn: function (p, user) {
      var row = { id: newId('EXP'), date: reqDate(p.date), category: reqStr(p.category, 'Category', 60),
        description: optStr(p.description, 200), amount: round(reqNum(p.amount, 'Amount', { positive: true })),
        paymentMethod: optStr(p.paymentMethod, 40), note: optStr(p.note), voided: false,
        createdAt: nowIso(), createdBy: user.username };
      db.append('Expenses', [row]);
      return row;
    } };

    A['expenses.list'] = { role: 'manager', write: false, fn: function (p) {
      return db.read('Expenses').filter(function (r) { return inRange(r.date, p.from, p.to); })
        .sort(newestFirst).slice(0, num(p.limit) || 300).map(function (r) {
          return { id: r.id, date: r.date, category: r.category, description: r.description, amount: num(r.amount),
            paymentMethod: r.paymentMethod, note: r.note, voided: bool(r.voided), createdAt: r.createdAt, createdBy: r.createdBy };
        });
    } };

    A['expenses.void'] = { role: 'manager', write: true, fn: function (p, user) { voidRow('Expenses', p.id, user, 'Expense'); return true; } };

    /* Reports */
    function periodTotals(from, to, sales, purchases, expenses, moves) {
      var s = sales.filter(function (r) { return inRange(r.date, from, to); });
      var revenue = sum(s, function (r) { return num(r.total); });
      var cogs = sum(s, function (r) { return num(r.costTotal); });
      var exp = sum(expenses.filter(function (r) { return inRange(r.date, from, to); }), function (r) { return num(r.amount); });
      var pur = sum(purchases.filter(function (r) { return inRange(r.date, from, to); }), function (r) { return num(r.total); });
      // Waste and stock-count differences are real food cost that recipes don't capture.
      var loss = -sum(moves.filter(function (r) {
        return inRange(r.date, from, to) && (r.type === 'waste' || r.type === 'count' || r.type === 'adjustment');
      }), function (r) { return num(r.value); });
      // Delivery-app commission is a cost of selling: its own P&L line. Food cost % stays on the menu price.
      var commissions = sum(s, function (r) { return num(r.commission); });
      var gross = revenue - cogs - commissions;
      return {
        revenue: round(revenue), cogs: round(cogs), commissions: round(commissions), wasteAndVariance: round(loss), expenses: round(exp),
        purchases: round(pur), grossProfit: round(gross), netProfit: round(gross - loss - exp),
        foodCostPct: revenue > 0 ? round((cogs + loss) / revenue * 100, 1) : null,
        theoreticalFoodCostPct: revenue > 0 ? round(cogs / revenue * 100, 1) : null,
        orders: sum(s, function (r) { return num(r.qty); })
      };
    }

    function dayCount(from, to) {
      var a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
      var b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
      return Math.max(0, Math.round((b - a) / 86400000) + 1);
    }
    function priceRule() {
      var st = settings();
      return RestoPricing.effectiveRounding(st.priceRounding, st.currency);
    }
    /** Revenue, cost, commission and contribution margin per channel (older name-only rows resolved by name). */
    function salesByChannel(rows, channels) {
      var out = {};
      rows.forEach(function (r) {
        var ch = resolveChannel(r, channels);
        var key = ch ? ch.id : '';
        var b = out[key] = out[key] || { channelId: key, name: ch ? ch.name : 'Other', type: ch ? ch.type : 'other',
          revenue: 0, cogs: 0, commission: 0, cm: 0, qty: 0 };
        b.revenue += num(r.total); b.cogs += num(r.costTotal); b.commission += num(r.commission); b.qty += num(r.qty);
      });
      return Object.keys(out).map(function (k) {
        var b = out[k];
        return { channelId: b.channelId, name: b.name, type: b.type, revenue: round(b.revenue), cogs: round(b.cogs),
          commission: round(b.commission), cm: round(b.revenue - b.cogs - b.commission), qty: b.qty };
      }).sort(function (a, b) { return b.revenue - a.revenue; });
    }
    /** Dish × channel pairs sold in the last 28 days that miss the food-cost target after commission. */
    function needsAttention(sales, channels, today) {
      var st = settings();
      var target = num(st.targetFoodCostPct) || 30;
      var rule = priceRule();
      var from = addDays(today, -27);
      var qty = {};
      sales.forEach(function (r) {
        if (!inRange(r.date, from, today)) return;
        var ch = resolveChannel(r, channels);
        if (!ch) return;
        var k = r.menuItemId + '|' + ch.id;
        qty[k] = (qty[k] || 0) + num(r.qty);
      });
      var out = [];
      menuWithCost().filter(function (m) { return m.active; }).forEach(function (m) {
        channels.filter(function (c) { return c.active; }).forEach(function (c) {
          var q = qty[m.id + '|' + c.id];
          if (!q) return;
          var price = listPriceFor(m, c.id);
          var e = RestoPricing.channelEconomics({ price: price, foodCost: m.foodCost, packaging: c.packagingCost,
            commissionPct: c.commissionPct, targetPct: target, rounding: rule });
          if (e.meetsTarget || e.suggested === null || e.suggested <= price) return;
          out.push({ menuItemId: m.id, name: m.name, channelId: c.id, channelName: c.name, price: price, suggested: e.suggested,
            foodCostPctNet: e.foodCostPctNet, qty28: q, lostMargin: round((e.suggested - price) * q) });
        });
      });
      return out.sort(function (a, b) { return b.lostMargin - a.lostMargin; }).slice(0, 3);
    }

    A['menu.analysis'] = { role: 'manager', write: false, fn: function (p, user) {
      var from = reqDate(p.from, 'From'), to = reqDate(p.to, 'To');
      var channels = ensureChannels(user);
      var channelId = trim(p.channelId);
      var target = num(settings().targetFoodCostPct) || 30;
      var rows = live(db.read('Sales')).filter(function (r) {
        if (!inRange(r.date, from, to)) return false;
        if (!p.includePromo && trim(r.promoId)) return false;
        if (channelId) { var ch = resolveChannel(r, channels); if (!ch || ch.id !== channelId) return false; }
        return true;
      });
      var by = {};
      rows.forEach(function (r) {
        var b = by[r.menuItemId] = by[r.menuItemId] || { menuItemId: r.menuItemId, name: r.itemName, qty: 0, revenue: 0, cost: 0, commission: 0 };
        b.qty += num(r.qty); b.revenue += num(r.total); b.cost += num(r.costTotal); b.commission += num(r.commission);
      });
      var dishes = Object.keys(by).map(function (k) { var b = by[k]; b.cm = b.revenue - b.cost - b.commission; return b; });
      var me = RestoPricing.menuEngineering(dishes.map(function (b) { return { id: b.menuItemId, qty: b.qty, cm: b.cm }; }));
      var cls = byId(me.items);
      var order = { star: 0, plowhorse: 1, puzzle: 2, dog: 3 };
      var items = dishes.filter(function (b) { return cls[b.menuItemId]; }).map(function (b) {
        var c = cls[b.menuItemId];
        var fc = b.revenue > 0 ? round(b.cost / b.revenue * 100, 1) : null;
        return { menuItemId: b.menuItemId, name: b.name, qty: b.qty, revenue: round(b.revenue), cost: round(b.cost),
          commission: round(b.commission), cm: round(b.cm), cmPerDish: c.cmPerDish, mixPct: c.mixPct, popular: c.popular,
          highMargin: c.highMargin, cls: c.cls, foodCostPct: fc, overTarget: fc !== null && fc > target };
      }).sort(function (a, b) { return order[a.cls] - order[b.cls] || b.revenue - a.revenue; });
      var sold = sum(dishes, function (b) { return b.qty; });
      var days = dayCount(from, to);
      return { from: from, to: to, days: days, channelId: channelId, dishesSold: sold, threshold: me.threshold, avgCm: me.avgCm,
        indicative: sold < 5 || days < 14, items: items };
    } };

    /* Daily routine: what needs doing today, and closing the day */
    A['day.close'] = { role: 'staff', write: true, fn: function (p, user) {
      var today = p.today ? reqDate(p.today, 'Today') : todayStr();
      // The client's date can be a few hours ahead of the server's (UTC+7), not more.
      if (today > addDays(todayStr(), 1)) today = addDays(todayStr(), 1);
      var date = reqDate(p.date);
      if (date > today) fail('VALIDATION', "You can't close a day that hasn't happened yet.");
      var sales = live(db.read('Sales')).filter(function (r) { return r.date === date; });
      var moves = live(db.read('StockMovements')).filter(function (r) { return r.date === date; });
      var row = { date: date, closedBy: user.username, closedAt: nowIso(),
        salesTotal: round(sum(sales, function (r) { return num(r.total); })),
        wasteValue: round(Math.abs(sum(moves.filter(function (r) { return r.type === 'waste'; }), function (r) { return num(r.value); }))),
        countLines: moves.filter(function (r) { return r.type === 'count'; }).length,
        note: optStr(p.note, 300) };
      var existing = db.read('DayCloses').filter(function (r) { return r.date === date; })[0];
      if (existing) {
        db.updateWhere('DayCloses', function (r) { return r.id === existing.id; }, row);
        row.id = existing.id;
      } else {
        row.id = newId('DAY');
        db.append('DayCloses', [row]);
      }
      return row;
    } };

    // This month's ingredient budget: expected revenue × target food cost % (or the owner's figure),
    // against purchases so far. Expected revenue = month to date + 28-day daily average × days left.
    A['stock.budget'] = { role: 'manager', write: false, fn: function (p) {
      var today = p.today ? reqDate(p.today, 'Today') : todayStr();
      var month = today.slice(0, 7), first = month + '-01';
      var y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
      var daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      var dayOfMonth = Number(today.slice(8, 10));
      var sales = live(db.read('Sales')).filter(function (r) { return r.date <= today; });
      var mtd = sum(sales.filter(function (r) { return r.date >= first; }), function (r) { return num(r.total); });
      var from28 = addDays(today, -27);
      var firstSale = sales.reduce(function (a, r) { return !a || r.date < a ? r.date : a; }, '');
      var start = firstSale && firstSale > from28 ? firstSale : from28;
      var days = firstSale ? Math.round((Date.parse(today) - Date.parse(start)) / 864e5) + 1 : 0;
      var last = sum(sales.filter(function (r) { return r.date >= start; }), function (r) { return num(r.total); });
      var avgDaily = days > 0 ? round(last / days) : 0;
      var forecast = round(mtd + avgDaily * (daysInMonth - dayOfMonth));
      var s = settings();
      var targetPct = num(s.targetFoodCostPct) || 30;
      var set = num(s.foodBudget) > 0 ? num(s.foodBudget) : null;
      var budget = set !== null ? set : round(forecast * targetPct / 100);
      var spent = round(sum(live(db.read('Purchases')).filter(function (r) { return r.date >= first && r.date <= today; }),
        function (r) { return num(r.total); }));
      var usedPct = budget > 0 ? round(spent / budget * 100, 1) : null;
      var elapsedPct = round(dayOfMonth / daysInMonth * 100, 1);
      var pace = budget > 0 && spent > budget ? 'over' : usedPct !== null && usedPct > elapsedPct + 10 ? 'ahead' : 'ok';
      return { month: month, dayOfMonth: dayOfMonth, daysInMonth: daysInMonth, mtdRevenue: round(mtd), avgDaily: avgDaily,
        forecastRevenue: forecast, targetPct: targetPct, source: set !== null ? 'set' : 'auto', budget: budget,
        spent: spent, remaining: round(budget - spent), usedPct: usedPct, elapsedPct: elapsedPct, pace: pace };
    } };

    // Running costs per dish: the last 30 days of expenses ÷ dishes sold in the same days.
    A['costs.overhead'] = { role: 'manager', write: false, fn: function (p) {
      var to = p.today ? reqDate(p.today, 'Today') : todayStr();
      var from = addDays(to, -29);
      var inRange = function (r) { return r.date >= from && r.date <= to; };
      var expenses = round(sum(live(db.read('Expenses')).filter(inRange), function (r) { return num(r.amount); }));
      var dishes = sum(live(db.read('Sales')).filter(inRange), function (r) { return num(r.qty); });
      return { from: from, to: to, expenses: expenses, dishes: dishes, perDish: dishes > 0 ? round(expenses / dishes) : null };
    } };

    A['day.status'] = { role: 'staff', write: false, fn: function (p) {
      var date = reqDate(p.date);
      var r = db.read('DayCloses').filter(function (x) { return x.date === date; })[0];
      return r ? { date: date, closed: true, closedBy: r.closedBy, closedAt: r.closedAt, note: r.note || '',
        salesTotal: num(r.salesTotal), wasteValue: num(r.wasteValue), countLines: num(r.countLines) }
        : { date: date, closed: false };
    } };

    A['today.summary'] = { role: 'staff', write: false, fn: function (p, user) {
      var today = p.today ? reqDate(p.today, 'Today') : todayStr();
      var yesterday = addDays(today, -1);
      var manager = ROLES[user.role] >= ROLES.manager;
      var closes = byId(db.read('DayCloses').map(function (r) { return { id: r.date, row: r }; }));
      var tasks = [];
      var pos = db.read('PurchaseOrders').filter(function (x) {
        return (x.status === 'sent' || x.status === 'partial') && trim(x.expectedDate) && x.expectedDate <= today;
      });
      if (pos.length) tasks.push({ kind: 'deliveries', n: pos.length });
      if (manager) {
        var inv = db.read('SupplierInvoices').filter(function (i) { return i.status === 'exception' || i.status === 'noPo'; });
        if (inv.length) tasks.push({ kind: 'invoices', n: inv.length });
      }
      var stock = stockLevels().filter(function (i) { return i.active; });
      var preps = stock.filter(function (i) { return i.kind === 'prep' && i.trackStock && i.onHand <= i.minLevel && i.minLevel > 0; });
      if (preps.length) tasks.push({ kind: 'preps', n: preps.length, items: preps.slice(0, 6).map(function (i) {
        return { id: i.id, name: i.name, onHand: i.onHand, minLevel: i.minLevel, unit: i.unit }; }) });
      var low = stock.filter(function (i) { return i.kind !== 'prep' && i.status !== 'ok'; });
      if (low.length) tasks.push({ kind: 'lowStock', n: low.length });
      if (manager) {
        var soon = addDays(today, 3);
        var ending = promoRows(today).filter(function (x) { return x.status === 'active' && x.endDate && x.endDate <= soon; });
        if (ending.length) tasks.push({ kind: 'promotionsEnding', n: ending.length, items: ending.map(function (x) {
          return { id: x.id, name: x.name, endDate: x.endDate }; }) });
      }
      var hadSales = live(db.read('Sales')).some(function (r) { return r.date === yesterday; });
      var yClosed = !!closes[yesterday];
      if (hadSales && !yClosed) tasks.push({ kind: 'closeYesterday', n: 1, items: [{ date: yesterday }] });
      var setup = null;
      if (user.role === 'owner') {
        var st = settings();
        var ch = channelRows().filter(function (c) { return c.active; });
        var dishes = menuWithCost().filter(function (m) { return m.active && m.recipe.length; });
        var steps = [
          { key: 'restaurant', done: !!trim(st.restaurantName) && st.restaurantName !== DEFAULT_SETTINGS.restaurantName && !!trim(st.currency) },
          { key: 'channels', done: ch.length > 0 && ch.every(function (c) { return c.type !== 'delivery' || c.commissionPct > 0; }) },
          { key: 'suppliers', done: active(db.read('Suppliers')).length >= 1 },
          { key: 'ingredients', done: stock.filter(function (i) { return i.kind !== 'prep'; }).length >= 5 },
          { key: 'dishes', done: dishes.length >= 1 },
          { key: 'team', done: active(db.read('Users')).some(function (u) { return u.role !== 'owner'; }) }
        ];
        setup = { done: steps.filter(function (x) { return x.done; }).length, total: steps.length, steps: steps };
      }
      var todayClose = closes[today] ? closes[today].row : null;
      return { day: { date: today, closed: !!todayClose, closedBy: todayClose ? todayClose.closedBy : '', closedAt: todayClose ? todayClose.closedAt : '' },
        yesterdayClosed: yClosed, tasks: tasks, setup: setup };
    } };

    /* SOP manuals */
    function safeLink(v) {
      var s = optStr(v, 500);
      if (s && !/^https?:\/\//i.test(s)) fail('VALIDATION', 'Image link must start with http:// or https://.');
      return s;
    }
    A['sop.save'] = { role: 'manager', write: true, fn: function (p, user) {
      var id = trim(p.ownerId);
      var table = 'Menu', row = db.read('Menu').filter(function (r) { return r.id === id; })[0];
      if (!row) {
        table = 'Ingredients';
        row = findOrFail('Ingredients', id, 'Prep');
        if (trim(row.kind) !== 'prep') fail('VALIDATION', 'Only dishes and preps have an SOP.');
      }
      if (num(p.version) !== num(row.version)) {
        fail('CONFLICT', (table === 'Menu' ? 'Dish' : 'Ingredient') + ' "' + row.name + '" was changed by ' + (row.updatedBy || 'someone else') +
          ' while you were editing. Your changes were not saved — reload to see the latest version.');
      }
      var n = p.notes || {};
      var steps = p.steps || [];
      if (steps.length > 40) fail('VALIDATION', 'Too many steps (max 40).');
      var clean = steps.map(function (st, i) {
        var text = trim(st.text);
        if (!text) fail('VALIDATION', 'Step ' + (i + 1) + ': write what to do.');
        return { id: newId('SOP'), ownerId: id, stepNo: i + 1, text: optStr(text, 500),
          minutes: optInt(st.minutes, 'Step ' + (i + 1) + ' minutes'), imageUrl: safeLink(st.imageUrl), critical: bool(st.critical) };
      });
      var patch = { portionNote: optStr(n.portionNote, 300), holdingNote: optStr(n.holdingNote, 300), equipment: optStr(n.equipment, 300),
        prepMinutes: optInt(n.prepMinutes, 'Prep time (minutes)'), photoUrl: safeLink(n.photoUrl),
        updatedAt: nowIso(), updatedBy: user.username, version: num(row.version) + 1 };
      db.updateWhere(table, function (r) { return r.id === id; }, patch);
      db.removeWhere('SopSteps', function (r) { return r.ownerId === id; });
      if (clean.length) db.append('SopSteps', clean);
      return { version: patch.version, steps: clean.map(function (c) {
        return { stepNo: c.stepNo, text: c.text, minutes: c.minutes, imageUrl: c.imageUrl, critical: c.critical }; }) };
    } };

    A['sop.list'] = { role: 'staff', write: false, fn: function () {
      var out = {};
      db.read('SopSteps').forEach(function (r) {
        (out[r.ownerId] = out[r.ownerId] || []).push({ stepNo: num(r.stepNo), text: r.text, minutes: trim(r.minutes) === '' ? '' : num(r.minutes),
          imageUrl: r.imageUrl || '', critical: bool(r.critical) });
      });
      Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return a.stepNo - b.stepNo; }); });
      return out;
    } };

    /* Promotions */
    function todayStr() { return env.now().toISOString().slice(0, 10); }
    function csv(v) { return trim(v) ? trim(v).split(',').map(function (x) { return x.trim(); }).filter(Boolean) : []; }
    function optPct(v) { return v === '' || v === null || v === undefined ? null : num(v); }

    function promoStatus(row, today) {
      var st = trim(row.status);
      if (st === 'draft' || st === 'cancelled') return st;
      if (trim(row.startDate) > today) return 'scheduled';
      if (trim(row.endDate) && trim(row.endDate) < today) return 'ended';
      return 'active';
    }
    function weekdayOf(date) {
      return new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay();
    }
    /** Does this promotion apply to a sale on `date` through `channelId`? */
    function promoActiveFor(promo, date, channelId) {
      var st = trim(promo.status);
      if (st === 'draft' || st === 'cancelled') return false;
      if (date < promo.startDate || (promo.endDate && date > promo.endDate)) return false;
      if (promo.weekdays.length && promo.weekdays.indexOf(weekdayOf(date)) < 0) return false;
      return !promo.channelIds.length || promo.channelIds.indexOf(channelId) >= 0;
    }
    function promoRows(today) {
      var names = byId(db.read('Menu'));
      var items = {};
      db.read('PromotionItems').forEach(function (r) {
        (items[r.promoId] = items[r.promoId] || []).push({ menuItemId: r.menuItemId,
          name: names[r.menuItemId] ? names[r.menuItemId].name : '(เมนูที่ถูกลบ)', qty: num(r.qty) || 1 });
      });
      return db.read('Promotions').map(function (r) {
        var type = trim(r.type);
        return { id: r.id, name: r.name, type: type, value: type === 'buyXGetY' ? trim(r.value) : num(r.value),
          channelIds: csv(r.channelIds), startDate: trim(r.startDate), endDate: trim(r.endDate),
          weekdays: csv(r.weekdays).map(Number), platformFundedPct: num(r.platformFundedPct),
          campaignCommissionPct: optPct(r.campaignCommissionPct), storedStatus: trim(r.status), status: promoStatus(r, today),
          note: r.note || '', version: num(r.version), items: items[r.id] || [] };
      }).sort(function (a, b) { return b.startDate < a.startDate ? -1 : b.startDate > a.startDate ? 1 : a.name.localeCompare(b.name); });
    }
    /** The engine's view of a promotion on one channel, using each dish's channel price and current food cost. */
    function promoEconFor(promo, channel, menu) {
      var target = num(settings().targetFoodCostPct) || 30;
      return RestoPricing.promoEconomics({ type: promo.type, value: promo.value, platformFundedPct: promo.platformFundedPct,
        campaignCommissionPct: promo.campaignCommissionPct, targetPct: target, channel: channel,
        items: promo.items.filter(function (i) { return menu[i.menuItemId]; }).map(function (i) {
          var d = menu[i.menuItemId];
          return { id: d.id, name: d.name, listPrice: listPriceFor(d, channel.id), foodCost: d.foodCost, qty: i.qty };
        }) });
    }
    function promoChannels(promo, channels) {
      return promo.channelIds.length
        ? channels.filter(function (c) { return promo.channelIds.indexOf(c.id) >= 0; })
        : channels.filter(function (c) { return c.active; });
    }
    /** Validates a promotion payload; name and dates are optional when only checking an offer. */
    function parsePromo(p, user, forCheck) {
      var d = p.item || {};
      var type = trim(d.type);
      if (RestoPricing.PROMO_TYPES.indexOf(type) < 0) fail('VALIDATION', 'Unknown promotion type.');
      var value;
      if (type === 'buyXGetY') {
        if (!RestoPricing.parseBxgy(d.value)) fail('VALIDATION', 'Buy-X-get-Y must look like 2+1.');
        value = trim(d.value).replace(/\s+/g, '');
      } else if (type === 'percentOff') {
        value = num(d.value);
        if (!(value > 0 && value <= 100)) fail('VALIDATION', 'Discount must be between 0 and 100 %.');
      } else if (type === 'fixedPrice') {
        value = round(reqNum(d.value, 'Promotion price', { min: 0 }), 2);
      } else {
        value = num(d.value);
        if (!(value > 0)) fail('VALIDATION', 'Amount must be greater than 0.');
        value = round(value, 2);
      }
      var pf = d.platformFundedPct === '' || d.platformFundedPct === undefined ? 0 : num(d.platformFundedPct);
      if (pf < 0 || pf > 100) fail('VALIDATION', 'Platform share must be between 0 and 100 %.');
      var cc = optPct(d.campaignCommissionPct);
      if (cc !== null && (cc < 0 || cc > 99.9)) fail('VALIDATION', 'Commission must be between 0 and 99.9 %.');
      var menu = byId(db.read('Menu'));
      var seen = {};
      var items = (p.items || []).map(function (x) {
        var dish = menu[trim(x.menuItemId)];
        if (!dish) findOrFail('Menu', trim(x.menuItemId), 'Dish');
        if (seen[dish.id]) fail('VALIDATION', dish.name + ' is in the promotion twice.');
        seen[dish.id] = true;
        var q = type === 'bundle' ? Math.round(num(x.qty) || 1) : 1;
        return { menuItemId: dish.id, qty: Math.max(1, q) };
      });
      if (!items.length) fail('VALIDATION', 'Choose at least one dish.');
      if (type === 'bundle' && sum(items, function (i) { return i.qty; }) < 2) fail('VALIDATION', 'A bundle needs at least two dishes.');
      var data = { type: type, value: value, platformFundedPct: round(pf, 2), campaignCommissionPct: cc === null ? '' : round(cc, 2) };
      if (forCheck) return { data: data, items: items };
      ensureChannels(user);
      var channelIds = (d.channelIds || []).map(trim).filter(Boolean);
      channelIds.forEach(function (id) { findOrFail('Channels', id, 'Sales channel'); });
      var weekdays = (d.weekdays || []).map(function (w) {
        var n = Number(w);
        if (!(n >= 0 && n <= 6 && Math.round(n) === n)) fail('VALIDATION', 'Unknown weekday.');
        return n;
      });
      var start = reqDate(d.startDate, 'Start date');
      var end = trim(d.endDate) ? reqDate(d.endDate, 'End date') : '';
      if (end && end < start) fail('VALIDATION', "End date can't be before the start date.");
      data.id = trim(d.id); data.version = d.version;
      data.name = reqStr(d.name, 'Promotion name', 80);
      data.channelIds = channelIds.join(','); data.startDate = start; data.endDate = end;
      data.weekdays = weekdays.filter(function (w, i) { return weekdays.indexOf(w) === i; }).sort().join(',');
      data.status = bool(d.draft) ? 'draft' : 'scheduled';
      data.note = optStr(d.note, 300);
      var clash = db.read('Promotions').some(function (r) {
        return r.id !== data.id && trim(r.status) !== 'cancelled' && trim(r.name).toLowerCase() === data.name.toLowerCase();
      });
      if (clash) fail('VALIDATION', 'Promotion "' + data.name + '" already exists.');
      return { data: data, items: items };
    }

    A['promotions.save'] = { role: 'manager', write: true, fn: function (p, user) {
      var parsed = parsePromo(p, user, false);
      var data = parsed.data;
      if (!data.id) delete data.id;
      var saved = saveRow('Promotions', 'PRM', data, user, 'Promotion "' + data.name + '"');
      db.removeWhere('PromotionItems', function (r) { return r.promoId === saved.id; });
      db.append('PromotionItems', parsed.items.map(function (i) {
        return { id: newId('PRI'), promoId: saved.id, menuItemId: i.menuItemId, qty: i.qty };
      }));
      return promoRows(todayStr()).filter(function (x) { return x.id === saved.id; })[0];
    } };

    A['promotions.cancel'] = { role: 'manager', write: true, fn: function (p, user) {
      var row = findOrFail('Promotions', trim(p.id), 'Promotion');
      if (trim(row.status) === 'cancelled') fail('VALIDATION', 'This promotion is already cancelled.');
      db.updateWhere('Promotions', function (r) { return r.id === row.id; },
        { status: 'cancelled', updatedAt: nowIso(), updatedBy: user.username, version: num(row.version) + 1 });
      return true;
    } };

    A['promotions.list'] = { role: 'manager', write: false, fn: function (p, user) {
      var today = p.today ? reqDate(p.today, 'Today') : todayStr();
      var channels = ensureChannels(user);
      var menu = byId(menuWithCost());
      return promoRows(today).map(function (x) {
        x.economics = promoChannels(x, channels).map(function (c) {
          var e = promoEconFor(x, c, menu);
          var o = e.overall || {};
          return { channelId: c.id, channelName: c.name, verdict: o.verdict || 'thin', cmBefore: o.cmBefore, cmDuring: o.cmDuring, uplift: o.uplift };
        });
        return x;
      });
    } };

    A['promotions.get'] = { role: 'manager', write: false, fn: function (p, user) {
      var today = p.today ? reqDate(p.today, 'Today') : todayStr();
      var channels = ensureChannels(user);
      var x = promoRows(today).filter(function (r) { return r.id === trim(p.id); })[0];
      if (!x) findOrFail('Promotions', trim(p.id), 'Promotion');
      var menu = byId(menuWithCost());
      x.channels = promoChannels(x, channels).map(function (c) {
        var e = promoEconFor(x, c, menu);
        return { channelId: c.id, channelName: c.name, rows: e.rows, overall: e.overall, worst: e.worst };
      });
      return x;
    } };

    A['promotions.check'] = { role: 'manager', write: false, fn: function (p, user) {
      var channels = ensureChannels(user);
      var parsed = parsePromo(p, user, true);
      var channel = findOrFail('Channels', trim(p.channelId), 'Sales channel');
      channel = channels.filter(function (c) { return c.id === channel.id; })[0];
      var menu = byId(menuWithCost());
      var promo = { type: parsed.data.type, value: parsed.data.value, platformFundedPct: parsed.data.platformFundedPct,
        campaignCommissionPct: optPct(parsed.data.campaignCommissionPct), items: parsed.items };
      var e = promoEconFor(promo, channel, menu);
      var co = null;
      if (promo.type === 'percentOff') {
        co = RestoPricing.counterOffer({ platformFundedPct: promo.platformFundedPct, campaignCommissionPct: promo.campaignCommissionPct,
          targetPct: num(settings().targetFoodCostPct) || 30, channel: channel,
          items: promo.items.map(function (i) { var d = menu[i.menuItemId];
            return { id: d.id, name: d.name, listPrice: listPriceFor(d, channel.id), foodCost: d.foodCost, qty: 1 }; }) });
      }
      return { economics: e, counterOffer: co };
    } };

    /**
     * Promotion results: per-day averages during the promotion against the 28 days before it,
     * for the promoted dishes and for the whole restaurant on the promotion's channels.
     */
    A['promotions.results'] = { role: 'manager', write: false, fn: function (p, user) {
      var today = p.today ? reqDate(p.today, 'Today') : todayStr();
      var channels = ensureChannels(user);
      var promo = promoRows(today).filter(function (r) { return r.id === trim(p.id); })[0];
      if (!promo) findOrFail('Promotions', trim(p.id), 'Promotion');
      var start = promo.startDate;
      var bFrom = addDays(start, -28), bTo = addDays(start, -1);
      // Complete days only: today isn't over, so it would make any promotion look worse than it is.
      var yesterday = addDays(today, -1);
      var pTo = promo.endDate && promo.endDate < yesterday ? promo.endDate : yesterday;
      var started = start <= yesterday;
      var pDays = started ? dayCount(start, pTo) : 0;
      var onChannel = {};
      promoChannels(promo, channels).forEach(function (c) { onChannel[c.id] = true; });
      if (!promo.channelIds.length) channels.forEach(function (c) { onChannel[c.id] = true; });
      var promoted = {};
      promo.items.forEach(function (i) { promoted[i.menuItemId] = true; });
      var rows = live(db.read('Sales')).filter(function (r) {
        if (!inRange(r.date, bFrom, pTo)) return false;
        var ch = resolveChannel(r, channels);
        return ch && onChannel[ch.id];
      });
      function totals(from, to, onlyPromoted) {
        var t = { units: 0, revenue: 0, cm: 0 };
        rows.forEach(function (r) {
          if (!inRange(r.date, from, to) || (onlyPromoted && !promoted[r.menuItemId])) return;
          t.units += num(r.qty); t.revenue += num(r.total); t.cm += num(r.total) - num(r.costTotal) - num(r.commission);
        });
        return t;
      }
      function perDay(t, days) {
        return { units: days ? round(t.units / days, 2) : 0, revenue: days ? round(t.revenue / days) : 0, cm: days ? round(t.cm / days) : 0 };
      }
      function change(a, b) { return a > 0 ? round((b - a) / a * 100, 1) : null; }
      var pb = perDay(totals(bFrom, bTo, true), 28), pd = perDay(started ? totals(start, pTo, true) : { units: 0, revenue: 0, cm: 0 }, pDays);
      var rb = perDay(totals(bFrom, bTo, false), 28), rd = perDay(started ? totals(start, pTo, false) : { units: 0, revenue: 0, cm: 0 }, pDays);
      var seen = {};
      rows.forEach(function (r) { if (inRange(r.date, bFrom, bTo)) seen[r.date] = true; });
      var daily = [];
      for (var d = bFrom; d <= (started ? pTo : bTo); d = addDays(d, 1)) {
        var cm = 0;
        rows.forEach(function (r) { if (r.date === d && promoted[r.menuItemId]) cm += num(r.total) - num(r.costTotal) - num(r.commission); });
        daily.push({ date: d, cm: round(cm), inPromo: d >= start });
      }
      var cmChange = change(rb.cm, rd.cm), unitChange = change(pb.units, pd.units);
      // No sales in the 4 weeks before: nothing to compare against, so no verdict.
      var verdict = !started ? 'tooEarly' : rb.revenue === 0 && rb.cm === 0 ? 'noBaseline'
        : (cmChange || 0) >= 0 ? 'worked'
          : (unitChange || 0) > 0 ? 'soldMoreEarnedLess' : 'didNotWork';
      return {
        baseline: { from: bFrom, to: bTo, daysWithSales: Object.keys(seen).length },
        period: { from: start, to: started ? pTo : start, days: pDays },
        weak: Object.keys(seen).length < 14,
        promoted: { before: pb, during: pd, change: { units: unitChange, revenue: change(pb.revenue, pd.revenue), cm: change(pb.cm, pd.cm) } },
        restaurant: { before: { revenue: rb.revenue, cm: rb.cm }, during: { revenue: rd.revenue, cm: rd.cm },
          change: { revenue: change(rb.revenue, rd.revenue), cm: cmChange } },
        verdict: verdict, daily: daily
      };
    } };

    A['reports.summary'] = { role: 'manager', write: false, fn: function (p, user) {
      var channels = ensureChannels(user);
      var month = reqMonth(p.month);
      var from = month + '-01', to = monthEnd(month);
      var today = p.today ? reqDate(p.today, 'Today') : env.now().toISOString().slice(0, 10);
      var sales = live(db.read('Sales')), purchases = live(db.read('Purchases'));
      var expenses = live(db.read('Expenses')), moves = live(db.read('StockMovements'));

      var totals = periodTotals(from, to, sales, purchases, expenses, moves);
      // Compare like with like: month-to-date against the same days of last month.
      var prevMonth = shiftMonth(month, -1);
      var partial = month === today.slice(0, 7);
      var prevTo = monthEnd(prevMonth);
      if (partial && prevMonth + today.slice(7) < prevTo) prevTo = prevMonth + today.slice(7);
      var previous = periodTotals(prevMonth + '-01', prevTo, sales, purchases, expenses, moves);
      previous.to = prevTo;
      previous.partial = partial;

      // Top sellers
      var byItem = {};
      sales.filter(function (r) { return inRange(r.date, from, to); }).forEach(function (r) {
        var b = byItem[r.menuItemId] = byItem[r.menuItemId] || { menuItemId: r.menuItemId, name: r.itemName, qty: 0, revenue: 0, cost: 0 };
        b.qty += num(r.qty); b.revenue += num(r.total); b.cost += num(r.costTotal);
      });
      var items = Object.keys(byItem).map(function (k) {
        var b = byItem[k];
        return { menuItemId: b.menuItemId, name: b.name, qty: b.qty, revenue: round(b.revenue), cost: round(b.cost),
          profit: round(b.revenue - b.cost), foodCostPct: b.revenue > 0 ? round(b.cost / b.revenue * 100, 1) : null };
      });
      var topByQty = items.slice().sort(function (a, b) { return b.qty - a.qty || b.revenue - a.revenue; }).slice(0, 10);

      // Daily cash flow: money in (sales) vs money out (purchases + expenses)
      var days = [], running = 0;
      for (var d = from; d <= to; d = addDays(d, 1)) {
        if (d > today && month >= today.slice(0, 7)) break;
        var cashIn = sum(sales.filter(function (r) { return r.date === d; }), function (r) { return num(r.total); });
        var outP = sum(purchases.filter(function (r) { return r.date === d; }), function (r) { return num(r.total); });
        var outE = sum(expenses.filter(function (r) { return r.date === d; }), function (r) { return num(r.amount); });
        running += cashIn - outP - outE;
        days.push({ date: d, cashIn: round(cashIn), purchases: round(outP), expenses: round(outE),
          cashOut: round(outP + outE), net: round(cashIn - outP - outE), cumulative: round(running) });
      }

      // Expenses by category
      var expCat = {};
      expenses.filter(function (r) { return inRange(r.date, from, to); }).forEach(function (r) {
        expCat[r.category] = (expCat[r.category] || 0) + num(r.amount);
      });
      var expenseCategories = Object.keys(expCat).map(function (k) { return { category: k, amount: round(expCat[k]) }; })
        .sort(function (a, b) { return b.amount - a.amount; });

      // Six-month summary
      var trend = [];
      for (var i = 5; i >= 0; i--) {
        var m = shiftMonth(month, -i);
        var t = periodTotals(m + '-01', monthEnd(m), sales, purchases, expenses, moves);
        t.month = m;
        t.cashIn = t.revenue;
        t.cashOut = round(t.purchases + t.expenses);
        trend.push(t);
      }

      var todaySales = sales.filter(function (r) { return r.date === today; });
      var stock = stockLevels().filter(function (s) { return s.active; });
      return {
        month: month, from: from, to: to, today: today,
        totals: totals, previous: previous,
        todaySales: { total: round(sum(todaySales, function (r) { return num(r.total); })), dishes: sum(todaySales, function (r) { return num(r.qty); }) },
        topItems: topByQty, items: items,
        byChannel: salesByChannel(sales.filter(function (r) { return inRange(r.date, from, to); }), channels),
        attention: needsAttention(sales, channels, today),
        cashFlow: days, expenseCategories: expenseCategories, trend: trend,
        stockValue: round(sum(stock, function (s) { return Math.max(0, s.value); })),
        lowStock: stock.filter(function (s) { return s.status !== 'ok'; }).length,
        payables: payablesSummary(today),
        purchasing: purchasingCounts(today)
      };
    } };

    // Day or week summary for Home. A week runs Monday–Sunday; the current one counts up to today.
    // Compared like for like: a day with the same weekday last week, a week with the same days of last week.
    A['reports.period'] = { role: 'manager', write: false, fn: function (p, user) {
      var channels = ensureChannels(user);
      var today = p.today ? reqDate(p.today, 'Today') : todayStr();
      var period = trim(p.period);
      if (period !== 'day' && period !== 'week') fail('VALIDATION', 'Unknown period.');
      var date = p.date ? reqDate(p.date) : today;
      if (date > today) date = today;
      var from = date, to = date;
      if (period === 'week') {
        var dow = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay();
        from = addDays(date, -((dow + 6) % 7));
        to = addDays(from, 6);
      }
      var toCap = to > today ? today : to;
      var sales = live(db.read('Sales')), purchases = live(db.read('Purchases'));
      var expenses = live(db.read('Expenses')), moves = live(db.read('StockMovements'));
      var totals = periodTotals(from, toCap, sales, purchases, expenses, moves);
      var previous = periodTotals(addDays(from, -7), addDays(toCap, -7), sales, purchases, expenses, moves);
      previous.from = addDays(from, -7);
      previous.to = addDays(toCap, -7);
      var closes = {};
      db.read('DayCloses').forEach(function (r) { closes[r.date] = r; });

      var days = [];
      if (period === 'week') {
        for (var d = from; d <= to; d = addDays(d, 1)) {
          var dt = periodTotals(d, d, sales, purchases, expenses, moves);
          var pv = sum(sales.filter(function (r) { return r.date === addDays(d, -7); }), function (r) { return num(r.total); });
          days.push({ date: d, future: d > today, revenue: dt.revenue, dishes: dt.orders, foodCostPct: dt.foodCostPct,
            grossProfit: round(dt.revenue - dt.cogs - dt.commissions - dt.wasteAndVariance), prevRevenue: round(pv), closed: !!closes[d] });
        }
      }
      var best = days.filter(function (x) { return !x.future && x.revenue > 0; })
        .reduce(function (a, x) { return !a || x.revenue > a.revenue ? x : a; }, null);

      var inPeriod = sales.filter(function (r) { return inRange(r.date, from, toCap); });
      var byItem = {};
      inPeriod.forEach(function (r) {
        var b = byItem[r.menuItemId] = byItem[r.menuItemId] || { menuItemId: r.menuItemId, name: r.itemName, qty: 0, revenue: 0, cost: 0 };
        b.qty += num(r.qty); b.revenue += num(r.total); b.cost += num(r.costTotal);
      });
      var topItems = Object.keys(byItem).map(function (k) {
        var b = byItem[k];
        return { menuItemId: b.menuItemId, name: b.name, qty: b.qty, revenue: round(b.revenue),
          foodCostPct: b.revenue > 0 ? round(b.cost / b.revenue * 100, 1) : null };
      }).sort(function (a, b) { return b.qty - a.qty || b.revenue - a.revenue; }).slice(0, 8);

      var expCat = {};
      expenses.filter(function (r) { return inRange(r.date, from, toCap); }).forEach(function (r) {
        expCat[r.category] = (expCat[r.category] || 0) + num(r.amount);
      });
      var expenseCategories = Object.keys(expCat).map(function (k) { return { category: k, amount: round(expCat[k]) }; })
        .sort(function (a, b) { return b.amount - a.amount; });

      var waste = [], close = null;
      if (period === 'day') {
        var ings = byId(db.read('Ingredients')), w = {};
        moves.filter(function (r) { return r.date === date && r.type === 'waste'; }).forEach(function (r) {
          var x = w[r.ingredientId] = w[r.ingredientId] || { ingredientId: r.ingredientId,
            name: ings[r.ingredientId] ? ings[r.ingredientId].name : '?', unit: ings[r.ingredientId] ? ings[r.ingredientId].unit : '', qty: 0, value: 0 };
          x.qty += -num(r.qty); x.value += -num(r.value);
        });
        waste = Object.keys(w).map(function (k) { var x = w[k]; x.qty = round(x.qty, 3); x.value = round(x.value); return x; })
          .sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
        var c = closes[date];
        close = c ? { closedBy: c.closedBy, closedAt: c.closedAt, note: c.note || '', salesTotal: num(c.salesTotal),
          wasteValue: num(c.wasteValue), countLines: num(c.countLines) } : null;
      }
      return { period: period, date: date, from: from, to: to, toCap: toCap, today: today, partial: toCap < to,
        totals: totals, previous: previous, days: days, best: best ? { date: best.date, revenue: best.revenue } : null,
        topItems: topItems, byChannel: salesByChannel(inPeriod, channels), expenseCategories: expenseCategories,
        waste: waste, close: close };
    } };

    /* ================================================================ Purchasing */

    function supplierName(suppliers, id) { return suppliers[id] ? suppliers[id].name : ''; }

    function nextPoNumber(orderDate) {
      var prefix = 'PO' + orderDate.slice(2, 4) + orderDate.slice(5, 7) + '-';
      var max = 0;
      db.read('PurchaseOrders').forEach(function (po) {
        if (String(po.poNumber).indexOf(prefix) === 0) max = Math.max(max, num(String(po.poNumber).slice(prefix.length)));
      });
      return prefix + ('000' + (max + 1)).slice(-4);
    }

    /** Full view of one order: lines with received quantities, receipts and linked invoices. */
    function poView(po, cache) {
      cache = cache || {};
      var ings = cache.ings || byId(db.read('Ingredients'));
      var sups = cache.sups || byId(db.read('Suppliers'));
      var purchases = cache.purchases || db.read('Purchases');
      var rec = cache.rec || receivedByLine(purchases);
      var lines = (cache.lines || db.read('PurchaseOrderLines')).filter(function (l) { return l.poId === po.id; }).map(function (l) {
        var ing = ings[l.ingredientId] || {};
        var received = round(rec[l.id] || 0, 3);
        return { id: l.id, ingredientId: l.ingredientId, name: ing.name || '?', unit: ing.unit || '',
          qtyOrdered: num(l.qtyOrdered), unitPrice: num(l.unitPrice), lineTotal: round(num(l.qtyOrdered) * num(l.unitPrice)),
          qtyReceived: received, remaining: round(Math.max(0, num(l.qtyOrdered) - received), 3), note: l.note || '' };
      });
      var view = {
        id: po.id, poNumber: po.poNumber, supplierId: po.supplierId, supplierName: supplierName(sups, po.supplierId),
        status: po.status, orderDate: po.orderDate, expectedDate: po.expectedDate, note: po.note || '',
        total: num(po.total), version: num(po.version), sentAt: po.sentAt || '', sentBy: po.sentBy || '',
        closedAt: po.closedAt || '', closedBy: po.closedBy || '', closeReason: po.closeReason || '',
        createdAt: po.createdAt, createdBy: po.createdBy,
        lines: lines,
        lineCount: lines.length,
        receivedValue: round(sum(live(purchases).filter(function (r) { return r.poId === po.id; }), function (r) { return num(r.total); })),
        progress: lines.length ? round(sum(lines, function (l) { return Math.min(1, l.qtyOrdered ? l.qtyReceived / l.qtyOrdered : 1); }) / lines.length * 100, 0) : 0
      };
      return view;
    }

    /** Recalculate an order's status from what has been received. */
    function refreshPoStatus(poId, user) {
      var po = findOrFail('PurchaseOrders', poId, 'Purchase order');
      if (['draft', 'sent', 'partial', 'received'].indexOf(po.status) < 0) return po.status;
      var rec = receivedByLine();
      var lines = db.read('PurchaseOrderLines').filter(function (l) { return l.poId === poId; });
      var any = lines.some(function (l) { return (rec[l.id] || 0) > 0; });
      var all = lines.length && lines.every(function (l) { return (rec[l.id] || 0) >= num(l.qtyOrdered) - 1e-9; });
      var status = all ? 'received' : any ? 'partial' : (po.status === 'draft' ? 'draft' : 'sent');
      if (status !== po.status) {
        db.updateWhere('PurchaseOrders', function (r) { return r.id === poId; },
          { status: status, updatedAt: nowIso(), updatedBy: user.username, version: num(po.version) + 1 });
      }
      return status;
    }

    function purchasingCounts(today) {
      today = today || env.now().toISOString().slice(0, 10);
      var pos = db.read('PurchaseOrders');
      var inv = db.read('SupplierInvoices');
      return {
        drafts: pos.filter(function (p) { return p.status === 'draft'; }).length,
        awaiting: pos.filter(function (p) { return p.status === 'sent' || p.status === 'partial'; }).length,
        expectedToday: pos.filter(function (p) { return (p.status === 'sent' || p.status === 'partial') && p.expectedDate <= today; }).length,
        toReview: inv.filter(function (i) { return i.status === 'exception' || i.status === 'noPo'; }).length,
        overdue: inv.filter(function (i) { return (i.status === 'matched' || i.status === 'approved') && i.dueDate && i.dueDate < today; }).length
      };
    }

    function payablesSummary(today) {
      today = today || env.now().toISOString().slice(0, 10);
      var soon = addDays(today, 7);
      var out = { unpaid: 0, unpaidCount: 0, overdue: 0, overdueCount: 0, dueSoon: 0, dueSoonCount: 0,
        toReview: 0, toReviewCount: 0, disputed: 0, disputedCount: 0 };
      db.read('SupplierInvoices').forEach(function (i) {
        var t = num(i.total);
        if (i.status === 'matched' || i.status === 'approved') {
          out.unpaid += t; out.unpaidCount++;
          if (i.dueDate && i.dueDate < today) { out.overdue += t; out.overdueCount++; }
          else if (i.dueDate && i.dueDate <= soon) { out.dueSoon += t; out.dueSoonCount++; }
        }
        if (i.status === 'exception' || i.status === 'noPo') { out.toReview += t; out.toReviewCount++; }
        if (i.status === 'disputed') { out.disputed += t; out.disputedCount++; }
      });
      ['unpaid', 'overdue', 'dueSoon', 'toReview', 'disputed'].forEach(function (k) { out[k] = round(out[k]); });
      return out;
    }

    /** Reorder suggestions: anything at or below its minimum (counting what is already on order), grouped by supplier. */
    A['po.suggestions'] = { role: 'manager', write: false, fn: function () {
      var groups = {};
      var sups = byId(db.read('Suppliers'));
      stockLevels().filter(function (i) { return i.active && i.minLevel > 0 && i.kind !== 'prep'; }).forEach(function (i) {
        if (i.onHand + i.onOrder > i.minLevel) return;
        var par = i.parLevel > i.minLevel ? i.parLevel : i.minLevel * 2;
        var qty = round(par - i.onHand - i.onOrder, 2);
        if (qty <= 0) return;
        var key = i.supplierId || '';
        var g = groups[key] = groups[key] || { supplierId: key, supplierName: supplierName(sups, key),
          leadTimeDays: sups[key] ? num(sups[key].leadTimeDays) : 0, items: [] };
        g.items.push({ ingredientId: i.id, name: i.name, unit: i.unit, onHand: i.onHand, minLevel: i.minLevel,
          parLevel: par, onOrder: i.onOrder, status: i.status, suggestedQty: qty, unitPrice: round(i.costPerUnit, 2) });
      });
      return Object.keys(groups).map(function (k) { return groups[k]; })
        .sort(function (a, b) { return (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1) || a.supplierName.localeCompare(b.supplierName); });
    } };

    A['po.list'] = { role: 'staff', write: false, fn: function (p) {
      var filter = trim(p.status) || 'open';
      var cache = { ings: byId(db.read('Ingredients')), sups: byId(db.read('Suppliers')), purchases: db.read('Purchases'),
        lines: db.read('PurchaseOrderLines') };
      cache.rec = receivedByLine(cache.purchases);
      return db.read('PurchaseOrders').filter(function (po) {
        if (p.supplierId && po.supplierId !== p.supplierId) return false;
        if (filter === 'all') return true;
        if (filter === 'open') return OPEN_PO.indexOf(po.status) >= 0;
        if (filter === 'awaiting') return po.status === 'sent' || po.status === 'partial';
        if (filter === 'done') return po.status === 'received' || po.status === 'closed' || po.status === 'cancelled';
        return po.status === filter;
      }).sort(function (a, b) {
        return a.orderDate !== b.orderDate ? (a.orderDate < b.orderDate ? 1 : -1) : (a.createdAt < b.createdAt ? 1 : -1);
      }).slice(0, num(p.limit) || 200).map(function (po) {
        var v = poView(po, cache);
        delete v.lines;
        return v;
      });
    } };

    A['po.get'] = { role: 'staff', write: false, fn: function (p) {
      var po = findOrFail('PurchaseOrders', p.id, 'Purchase order');
      var v = poView(po);
      var ings = byId(db.read('Ingredients'));
      v.receipts = db.read('Purchases').filter(function (r) { return r.poId === po.id; }).sort(newestFirst).map(function (r) {
        return { id: r.id, date: r.date, ingredientName: (ings[r.ingredientId] || {}).name || '?', unit: (ings[r.ingredientId] || {}).unit || '',
          qty: num(r.qty), unitCost: num(r.unitCost), total: num(r.total), invoiceRef: r.invoiceRef, voided: bool(r.voided),
          createdAt: r.createdAt, createdBy: r.createdBy };
      });
      v.invoices = db.read('SupplierInvoices').filter(function (i) { return i.poId === po.id; }).map(function (i) {
        return { id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, total: num(i.total), status: i.status };
      });
      return v;
    } };

    A['po.save'] = { role: 'manager', write: true, fn: function (p, user) {
      var d = p.item || {};
      var supplierId = trim(d.supplierId);
      if (!supplierId) fail('VALIDATION', 'Choose a supplier.');
      var sup = findOrFail('Suppliers', supplierId, 'Supplier');
      var orderDate = reqDate(d.orderDate, 'Order date');
      var expectedDate = trim(d.expectedDate) ? reqDate(d.expectedDate, 'Expected date') : addDays(orderDate, trim(sup.leadTimeDays) === '' ? 1 : num(sup.leadTimeDays));
      var ings = byId(db.read('Ingredients'));
      var seen = {};
      var lines = (p.lines || []).filter(function (l) { return l.ingredientId || l.qtyOrdered; }).map(function (l, i) {
        var ing = ings[l.ingredientId];
        if (!ing) fail('VALIDATION', 'Line ' + (i + 1) + ': choose an ingredient.');
        if (trim(ing.kind) === 'prep') fail('VALIDATION', 'Line ' + (i + 1) + ': ' + ing.name + ' is made in the kitchen. Record a production run instead.');
        if (seen[ing.id]) fail('VALIDATION', ing.name + ' is on the order twice.');
        seen[ing.id] = true;
        return { ingredientId: ing.id, qtyOrdered: round(reqNum(l.qtyOrdered, 'Line ' + (i + 1) + ' quantity', { positive: true }), 3),
          unitPrice: round(reqNum(l.unitPrice, 'Line ' + (i + 1) + ' unit cost', { min: 0 }), 4), note: optStr(l.note, 120) };
      });
      if (!lines.length) fail('VALIDATION', 'Add at least one item to the order.');
      if (lines.length > 60) fail('VALIDATION', 'Too many lines in one purchase (max 60).');
      var total = round(sum(lines, function (l) { return l.qtyOrdered * l.unitPrice; }));
      var data = { supplierId: supplierId, orderDate: orderDate, expectedDate: expectedDate, note: optStr(d.note, 500), total: total };
      var saved;
      if (trim(d.id)) {
        var current = findOrFail('PurchaseOrders', d.id, 'Purchase order');
        if (current.status !== 'draft') fail('VALIDATION', 'Only draft orders can be edited.');
        data.id = current.id; data.version = d.version;
        saved = saveRow('PurchaseOrders', 'PO', data, user, 'Purchase order ' + current.poNumber);
      } else {
        data.poNumber = nextPoNumber(orderDate);
        data.status = 'draft';
        saved = saveRow('PurchaseOrders', 'PO', data, user, 'Purchase order');
      }
      db.removeWhere('PurchaseOrderLines', function (l) { return l.poId === saved.id; });
      db.append('PurchaseOrderLines', lines.map(function (l) {
        return { id: newId('POL'), poId: saved.id, ingredientId: l.ingredientId, qtyOrdered: l.qtyOrdered, unitPrice: l.unitPrice, note: l.note };
      }));
      if (p.send) markSent(saved.id, user);
      return poView(findOrFail('PurchaseOrders', saved.id, 'Purchase order'));
    } };

    function markSent(id, user) {
      var po = findOrFail('PurchaseOrders', id, 'Purchase order');
      if (['closed', 'cancelled', 'received'].indexOf(po.status) >= 0) fail('VALIDATION', 'This order is already ' + po.status + " and can't be changed.");
      db.updateWhere('PurchaseOrders', function (r) { return r.id === id; }, {
        status: po.status === 'draft' ? 'sent' : po.status, sentAt: nowIso(), sentBy: user.username,
        updatedAt: nowIso(), updatedBy: user.username, version: num(po.version) + 1 });
    }

    A['po.send'] = { role: 'manager', write: true, fn: function (p, user) {
      markSent(p.id, user);
      return poView(findOrFail('PurchaseOrders', p.id, 'Purchase order'));
    } };

    A['po.cancel'] = { role: 'manager', write: true, fn: function (p, user) {
      var po = findOrFail('PurchaseOrders', p.id, 'Purchase order');
      if (['closed', 'cancelled', 'received'].indexOf(po.status) >= 0) fail('VALIDATION', 'This order is already ' + po.status + " and can't be changed.");
      var rec = receivedByLine();
      var hasReceipts = db.read('PurchaseOrderLines').some(function (l) { return l.poId === po.id && (rec[l.id] || 0) > 0; });
      if (hasReceipts) fail('VALIDATION', 'This order already has deliveries — close it instead of cancelling.');
      db.updateWhere('PurchaseOrders', function (r) { return r.id === po.id; }, {
        status: 'cancelled', closedAt: nowIso(), closedBy: user.username, closeReason: optStr(p.reason, 200),
        updatedAt: nowIso(), updatedBy: user.username, version: num(po.version) + 1 });
      return poView(findOrFail('PurchaseOrders', po.id, 'Purchase order'));
    } };

    /** Close an order that won't be delivered in full (short delivery accepted). */
    A['po.close'] = { role: 'manager', write: true, fn: function (p, user) {
      var po = findOrFail('PurchaseOrders', p.id, 'Purchase order');
      if (po.status !== 'sent' && po.status !== 'partial') fail('VALIDATION', 'Only orders waiting for delivery can be closed.');
      db.updateWhere('PurchaseOrders', function (r) { return r.id === po.id; }, {
        status: 'closed', closedAt: nowIso(), closedBy: user.username, closeReason: optStr(p.reason, 200),
        updatedAt: nowIso(), updatedBy: user.username, version: num(po.version) + 1 });
      return poView(findOrFail('PurchaseOrders', po.id, 'Purchase order'));
    } };

    /** Receive a delivery against an order: books stock in, then updates the order status. */
    A['po.receive'] = { role: 'staff', write: true, fn: function (p, user) {
      var po = findOrFail('PurchaseOrders', p.poId, 'Purchase order');
      if (['closed', 'cancelled', 'received'].indexOf(po.status) >= 0) fail('VALIDATION', 'This order is already ' + po.status + " and can't be changed.");
      var poLines = byId(db.read('PurchaseOrderLines').filter(function (l) { return l.poId === po.id; }));
      var lines = [];
      (p.lines || []).forEach(function (l, i) {
        if (l.qty === '' || l.qty === null || l.qty === undefined || num(l.qty) === 0) return;
        var pl = poLines[l.poLineId];
        if (!pl) fail('VALIDATION', 'Line ' + (i + 1) + ': not on this order.');
        lines.push({ ingredientId: pl.ingredientId, qty: l.qty,
          unitCost: l.unitPrice === '' || l.unitPrice === undefined ? pl.unitPrice : l.unitPrice, poLineId: pl.id });
      });
      if (!lines.length) fail('VALIDATION', 'Enter a received quantity for at least one item.');
      var r = addPurchases({ date: p.date, supplierId: po.supplierId, invoiceRef: p.deliveryRef, note: p.note, poId: po.id }, lines, user);
      if (po.status === 'draft') markSent(po.id, user);
      r.status = refreshPoStatus(po.id, user);
      return r; // r.impact (cost impact on dishes) passes through
    } };

    /* ---------- supplier invoices & 3-way matching ---------- */

    /**
     * Compares an invoice with its purchase order and what was actually received.
     * Exceptions (need a manager's decision): billed more than received, price above the
     * ordered price beyond tolerance, items not on the order, total that doesn't add up.
     */
    function matchInvoice(inv, invLines, cache) {
      cache = cache || {};
      var ings = cache.ings || byId(db.read('Ingredients'));
      var tol = num(settings().priceTolerancePct);
      var header = [];
      var variance = 0;
      var subtotal = round(sum(invLines, function (l) { return num(l.qty) * num(l.unitPrice); }));
      var computedTotal = round(subtotal + num(inv.vat));
      if (Math.abs(num(inv.total) - computedTotal) > 1) {
        header.push('totalMismatch');
        if (num(inv.total) > computedTotal) variance += num(inv.total) - computedTotal;
      }
      var out = { lines: [], header: header, exceptions: header.length, variance: 0,
        totals: { subtotal: subtotal, vat: num(inv.vat), total: num(inv.total), computedTotal: computedTotal } };
      if (!inv.poId) {
        out.lines = invLines.map(function (l) {
          var ing = ings[l.ingredientId] || {};
          return { ingredientId: l.ingredientId, name: ing.name || '?', unit: ing.unit || '', invoiced: num(l.qty),
            invoicePrice: num(l.unitPrice), flags: [] };
        });
        out.header.push('noPo');
        out.variance = round(variance);
        return out;
      }
      var poLines = db.read('PurchaseOrderLines').filter(function (l) { return l.poId === inv.poId; });
      var rec = receivedByLine();
      // Quantities already billed on OTHER invoices for this order (disputed ones don't count).
      var otherIds = {};
      db.read('SupplierInvoices').forEach(function (i) { if (i.poId === inv.poId && i.id !== inv.id && i.status !== 'disputed') otherIds[i.id] = true; });
      var billedBefore = {};
      db.read('SupplierInvoiceLines').forEach(function (l) { if (otherIds[l.invoiceId]) billedBefore[l.ingredientId] = (billedBefore[l.ingredientId] || 0) + num(l.qty); });
      var byIng = {};
      poLines.forEach(function (l) {
        var b = byIng[l.ingredientId] = byIng[l.ingredientId] || { ordered: 0, received: 0, value: 0 };
        b.ordered += num(l.qtyOrdered); b.received += rec[l.id] || 0; b.value += num(l.qtyOrdered) * num(l.unitPrice);
      });
      var invoicedIng = {};
      invLines.forEach(function (l) {
        var ing = ings[l.ingredientId] || {};
        var qty = num(l.qty), price = num(l.unitPrice);
        invoicedIng[l.ingredientId] = true;
        var row = { ingredientId: l.ingredientId, name: ing.name || '?', unit: ing.unit || '', invoiced: qty, invoicePrice: price, flags: [] };
        var po = byIng[l.ingredientId];
        if (!po) {
          row.flags.push('notOrdered');
          variance += qty * price;
        } else {
          var poPrice = po.ordered ? po.value / po.ordered : 0;
          var before = billedBefore[l.ingredientId] || 0;
          row.ordered = round(po.ordered, 3); row.received = round(po.received, 3); row.billedBefore = round(before, 3); row.poPrice = round(poPrice, 4);
          var over = round(qty + before - po.received, 3);
          if (over > 0.0005) {
            row.flags.push(po.received <= 0 ? 'notReceived' : 'overBilled');
            variance += Math.min(qty, over) * price;
          }
          if (poPrice > 0) {
            var diffPct = (price - poPrice) / poPrice * 100;
            row.priceDiffPct = round(diffPct, 1);
            if (diffPct > tol) { row.flags.push('priceUp'); variance += (price - poPrice) * qty; }
            else if (diffPct < -tol) row.flags.push('priceDown');
          }
        }
        out.lines.push(row);
      });
      // Received but not billed yet: information only (it may come on a later invoice).
      Object.keys(byIng).forEach(function (k) {
        if (invoicedIng[k]) return;
        var po = byIng[k], ing = ings[k] || {};
        var left = round(po.received - (billedBefore[k] || 0), 3);
        if (left > 0) out.lines.push({ ingredientId: k, name: ing.name || '?', unit: ing.unit || '', ordered: round(po.ordered, 3),
          received: round(po.received, 3), billedBefore: round(billedBefore[k] || 0, 3), invoiced: 0, poPrice: round(po.ordered ? po.value / po.ordered : 0, 4),
          flags: ['notBilled'] });
      });
      var EXC = ['notOrdered', 'notReceived', 'overBilled', 'priceUp'];
      out.exceptions = header.length + sum(out.lines, function (l) { return l.flags.filter(function (f) { return EXC.indexOf(f) >= 0; }).length ? 1 : 0; });
      out.variance = round(variance);
      return out;
    }

    function invoiceView(inv, withDetail) {
      var sups = byId(db.read('Suppliers'));
      var po = inv.poId ? db.read('PurchaseOrders').filter(function (x) { return x.id === inv.poId; })[0] : null;
      var today = env.now().toISOString().slice(0, 10);
      var v = { id: inv.id, invoiceNo: inv.invoiceNo, supplierId: inv.supplierId, supplierName: supplierName(sups, inv.supplierId),
        poId: inv.poId || '', poNumber: po ? po.poNumber : '', invoiceDate: inv.invoiceDate, dueDate: inv.dueDate,
        subtotal: num(inv.subtotal), vat: num(inv.vat), total: num(inv.total), status: inv.status,
        exceptionCount: num(inv.exceptionCount), varianceAmount: num(inv.varianceAmount),
        reviewNote: inv.reviewNote || '', reviewedAt: inv.reviewedAt || '', reviewedBy: inv.reviewedBy || '',
        paidAt: inv.paidAt || '', paidBy: inv.paidBy || '', paymentMethod: inv.paymentMethod || '', paymentRef: inv.paymentRef || '',
        note: inv.note || '', version: num(inv.version), createdAt: inv.createdAt, createdBy: inv.createdBy,
        overdue: (inv.status === 'matched' || inv.status === 'approved') && !!inv.dueDate && inv.dueDate < today };
      if (withDetail) {
        var ings = byId(db.read('Ingredients'));
        var lines = db.read('SupplierInvoiceLines').filter(function (l) { return l.invoiceId === inv.id; });
        v.lines = lines.map(function (l) {
          var ing = ings[l.ingredientId] || {};
          return { id: l.id, ingredientId: l.ingredientId, name: ing.name || '?', unit: ing.unit || '', qty: num(l.qty),
            unitPrice: num(l.unitPrice), total: num(l.total) };
        });
        v.match = matchInvoice(inv, lines, { ings: ings });
      }
      return v;
    }

    A['invoices.save'] = { role: 'manager', write: true, fn: function (p, user) {
      var d = p.item || {};
      var supplierId = trim(d.supplierId);
      if (!supplierId) fail('VALIDATION', 'Choose a supplier.');
      var sup = findOrFail('Suppliers', supplierId, 'Supplier');
      var invoiceNo = reqStr(d.invoiceNo, 'Invoice number', 60);
      var invoiceDate = reqDate(d.invoiceDate, 'Invoice date');
      var current = trim(d.id) ? findOrFail('SupplierInvoices', d.id, 'Invoice') : null;
      if (current && current.status === 'paid') fail('VALIDATION', "Paid invoices can't be changed.");
      var dup = db.read('SupplierInvoices').some(function (i) {
        return i.supplierId === supplierId && trim(i.invoiceNo).toLowerCase() === invoiceNo.toLowerCase() && (!current || i.id !== current.id);
      });
      if (dup) fail('VALIDATION', 'Invoice "' + invoiceNo + '" from this supplier is already recorded.');
      var poId = trim(d.poId);
      if (poId) {
        var po = findOrFail('PurchaseOrders', poId, 'Purchase order');
        if (po.supplierId !== supplierId) fail('VALIDATION', 'This order belongs to another supplier.');
        if (po.status === 'cancelled') fail('VALIDATION', "A cancelled order can't be invoiced.");
      }
      var ings = byId(db.read('Ingredients'));
      var seen = {};
      var lines = (p.lines || []).filter(function (l) { return l.ingredientId || l.qty; }).map(function (l, i) {
        var ing = ings[l.ingredientId];
        if (!ing) fail('VALIDATION', 'Line ' + (i + 1) + ': choose an ingredient.');
        if (seen[ing.id]) fail('VALIDATION', ing.name + ' is on the invoice twice.');
        seen[ing.id] = true;
        var qty = round(reqNum(l.qty, 'Line ' + (i + 1) + ' quantity', { positive: true }), 3);
        var price = round(reqNum(l.unitPrice, 'Line ' + (i + 1) + ' unit cost', { min: 0 }), 4);
        return { ingredientId: ing.id, qty: qty, unitPrice: price, total: round(qty * price) };
      });
      if (!lines.length) fail('VALIDATION', 'Add at least one item to the invoice.');
      var subtotal = round(sum(lines, function (l) { return l.total; }));
      var vat = d.vat === '' || d.vat === undefined || d.vat === null
        ? round(subtotal * num(settings().vatRate) / 100) : round(reqNum(d.vat, 'VAT', { min: 0 }));
      var total = d.total === '' || d.total === undefined || d.total === null
        ? round(subtotal + vat) : round(reqNum(d.total, 'Invoice total', { min: 0 }));
      var dueDate = trim(d.dueDate) ? reqDate(d.dueDate, 'Due date') : addDays(invoiceDate, num(sup.paymentTermsDays));
      var data = { supplierId: supplierId, poId: poId, invoiceNo: invoiceNo, invoiceDate: invoiceDate, dueDate: dueDate,
        subtotal: subtotal, vat: vat, total: total, note: optStr(d.note, 500) };
      var m = matchInvoice({ id: current ? current.id : '', poId: poId, vat: vat, total: total }, lines, { ings: ings });
      data.status = !poId ? 'noPo' : m.exceptions ? 'exception' : 'matched';
      data.exceptionCount = m.exceptions;
      data.varianceAmount = m.variance;
      // Changing an invoice clears any earlier approval or dispute: it must be reviewed again.
      data.reviewNote = ''; data.reviewedAt = ''; data.reviewedBy = '';
      var saved;
      if (current) { data.id = current.id; data.version = d.version; saved = saveRow('SupplierInvoices', 'INV', data, user, 'Invoice "' + invoiceNo + '"'); }
      else saved = saveRow('SupplierInvoices', 'INV', data, user, 'Invoice');
      db.removeWhere('SupplierInvoiceLines', function (l) { return l.invoiceId === saved.id; });
      db.append('SupplierInvoiceLines', lines.map(function (l) {
        return { id: newId('INL'), invoiceId: saved.id, ingredientId: l.ingredientId, qty: l.qty, unitPrice: l.unitPrice, total: l.total };
      }));
      return invoiceView(findOrFail('SupplierInvoices', saved.id, 'Invoice'), true);
    } };

    A['invoices.list'] = { role: 'manager', write: false, fn: function (p) {
      var filter = trim(p.status) || 'all';
      var groups = { review: ['exception', 'noPo'], unpaid: ['matched', 'approved'], disputed: ['disputed'], paid: ['paid'] };
      var rows = db.read('SupplierInvoices').filter(function (i) {
        if (p.supplierId && i.supplierId !== p.supplierId) return false;
        if (p.poId && i.poId !== p.poId) return false;
        return filter === 'all' || (groups[filter] || [filter]).indexOf(i.status) >= 0;
      }).sort(function (a, b) {
        if (filter === 'unpaid') return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
        return a.invoiceDate !== b.invoiceDate ? (a.invoiceDate < b.invoiceDate ? 1 : -1) : (a.createdAt < b.createdAt ? 1 : -1);
      }).slice(0, num(p.limit) || 300).map(function (i) { return invoiceView(i, false); });
      return { rows: rows, summary: payablesSummary(p.today) };
    } };

    A['invoices.get'] = { role: 'manager', write: false, fn: function (p) {
      return invoiceView(findOrFail('SupplierInvoices', p.id, 'Invoice'), true);
    } };

    function reviewInvoice(p, user, status, needNote) {
      var inv = findOrFail('SupplierInvoices', p.id, 'Invoice');
      if (inv.status === 'paid') fail('VALIDATION', 'This invoice is already paid.');
      var note = optStr(p.note, 500);
      if (needNote && !note) fail('VALIDATION', 'Add a note explaining the decision.');
      db.updateWhere('SupplierInvoices', function (r) { return r.id === inv.id; }, {
        status: status, reviewNote: note, reviewedAt: nowIso(), reviewedBy: user.username,
        updatedAt: nowIso(), updatedBy: user.username, version: num(inv.version) + 1 });
      return invoiceView(findOrFail('SupplierInvoices', inv.id, 'Invoice'), true);
    }

    /** Accept an invoice. A note is required when it has exceptions or was disputed. */
    A['invoices.approve'] = { role: 'manager', write: true, fn: function (p, user) {
      var inv = findOrFail('SupplierInvoices', p.id, 'Invoice');
      if (inv.status === 'approved' || inv.status === 'matched') return invoiceView(inv, true);
      return reviewInvoice(p, user, 'approved', inv.status === 'exception' || inv.status === 'disputed');
    } };

    A['invoices.dispute'] = { role: 'manager', write: true, fn: function (p, user) {
      return reviewInvoice(p, user, 'disputed', true);
    } };

    A['invoices.pay'] = { role: 'manager', write: true, fn: function (p, user) {
      var inv = findOrFail('SupplierInvoices', p.id, 'Invoice');
      if (inv.status === 'paid') fail('VALIDATION', 'This invoice is already paid.');
      if (inv.status !== 'matched' && inv.status !== 'approved') fail('VALIDATION', 'Only matched or approved invoices can be paid.');
      db.updateWhere('SupplierInvoices', function (r) { return r.id === inv.id; }, {
        status: 'paid', paidAt: reqDate(p.date, 'Payment date'), paidBy: user.username,
        paymentMethod: optStr(p.method, 40), paymentRef: optStr(p.reference, 80),
        updatedAt: nowIso(), updatedBy: user.username, version: num(inv.version) + 1 });
      return invoiceView(findOrFail('SupplierInvoices', inv.id, 'Invoice'), true);
    } };

    /* Team & settings */
    A['users.save'] = { role: 'owner', write: true, fn: function (p, user) {
      var d = p.item || {};
      var role = trim(d.role);
      if (!ROLES[role]) fail('VALIDATION', 'Choose a role.');
      var username = reqStr(d.username, 'Username', 40).toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail('VALIDATION', 'Username: 3–40 letters, numbers, dots, dashes or underscores.');
      var data = { id: trim(d.id), version: d.version, username: username, displayName: reqStr(d.displayName, 'Name', 80),
        role: role, active: d.active === undefined ? true : bool(d.active) };
      assertUnique('Users', 'username', username, data.id, 'Username');
      if (data.id) {
        var current = findOrFail('Users', data.id, 'User');
        var owners = active(db.read('Users')).filter(function (u) { return u.role === 'owner' && u.id !== data.id; });
        if (current.role === 'owner' && (role !== 'owner' || !data.active) && !owners.length) {
          fail('VALIDATION', 'There must always be at least one active owner.');
        }
        var saved = saveRow('Users', 'USR', data, user, 'User "' + username + '"');
        if (d.password) setPassword(saved.id, d.password);
        return publicUser(saved);
      }
      if (!d.password) fail('VALIDATION', 'Set a starting password for the new user.');
      delete data.id;
      var created = saveRow('Users', 'USR', data, user, 'User');
      setPassword(created.id, d.password);
      return publicUser(created);
    } };

    A['settings.save'] = { role: 'owner', write: true, fn: function (p, user) {
      var values = p.values || {};
      var existing = byId(db.read('Settings').map(function (r) { return { id: r.key }; }));
      var ts = nowIso();
      Object.keys(values).forEach(function (k) {
        if (!(k in DEFAULT_SETTINGS)) return;
        var v = optStr(values[k], 1000);
        if (k === 'targetFoodCostPct') v = String(reqNum(v, 'Target food cost %', { min: 1 }));
        if (k === 'vatRate') v = String(reqNum(v, 'VAT rate', { min: 0 }));
        if (k === 'foodBudget' && trim(v) !== '') v = String(round(reqNum(v, 'Monthly ingredient budget', { min: 0 })));
        if (k === 'priceTolerancePct') v = String(reqNum(v, 'Price tolerance %', { min: 0 }));
        if (k === 'costMethod' && ['average', 'last'].indexOf(v) < 0) fail('VALIDATION', 'Unknown cost method.');
        if (k === 'priceRounding' && v !== '' && RestoPricing.ROUNDING_RULES.indexOf(v) < 0) fail('VALIDATION', 'Unknown price rounding.');
        if (existing[k]) db.updateWhere('Settings', function (r) { return r.key === k; }, { value: v, updatedAt: ts, updatedBy: user.username });
        else db.append('Settings', [{ key: k, value: v, updatedAt: ts, updatedBy: user.username }]);
      });
      return settings();
    } };

    /* ---------- dispatcher ---------- */

    function execute(action, payload, user, req) {
      var def = A[action];
      if (!def) fail('BAD_REQUEST', 'Unknown action: ' + action);
      if (ROLES[user.role] < ROLES[def.role]) fail('FORBIDDEN', 'Your role (' + user.role + ') cannot do this. Ask a ' + def.role + '.');
      var rid = req && req.requestId ? 'rq:' + user.id + ':' + String(req.requestId).slice(0, 64) : '';
      var run = function () {
        // A retried save (same requestId) returns the first result instead of saving twice.
        if (rid) {
          var seen = env.sessions.get(rid);
          if (seen) { try { return JSON.parse(seen); } catch (e) { /* fall through */ } }
        }
        var result = def.fn(payload || {}, user, req || {});
        if (rid) { try { env.sessions.put(rid, JSON.stringify(result === undefined ? null : result), 3600); } catch (e) { /* too large to cache */ } }
        return result;
      };
      // All writes are serialized: no two requests can interleave read-modify-write.
      return def.write ? db.lock(function () {
        writeDepth++;
        try { return run(); } finally { writeDepth--; }
      }) : run();
    }

    function handle(req) {
      try {
        req = req || {};
        var data;
        if (req.action === 'auth.login') data = db.lock(function () { return login(req.payload || {}); });
        else data = execute(req.action, req.payload, userFromToken(req.token), req);
        return { ok: true, data: data };
      } catch (e) {
        var lang = req && req.lang;
        if (e && e.code) return { ok: false, error: { code: e.code, message: translate(e.message, lang), details: e.details } };
        return { ok: false, error: { code: 'SERVER', message: translate('Something went wrong on the server: ' + (e && e.message ? e.message : e), lang) } };
      }
    }

    /** Create Settings defaults and the first owner. Safe to run more than once. */
    function initialize(opts) {
      opts = opts || {};
      return db.lock(function () {
        var ts = nowIso();
        var have = byId(db.read('Settings').map(function (r) { return { id: r.key }; }));
        var rows = [];
        Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
          if (!have[k]) {
            var v = k === 'restaurantName' && opts.restaurantName ? opts.restaurantName
              : opts.lang === 'th' && DEFAULT_SETTINGS_TH[k] ? DEFAULT_SETTINGS_TH[k] : DEFAULT_SETTINGS[k];
            rows.push({ key: k, value: v, updatedAt: ts, updatedBy: 'setup' });
          }
        });
        if (rows.length) db.append('Settings', rows);
        var created = null;
        if (!active(db.read('Users')).some(function (u) { return u.role === 'owner'; })) {
          var system = { username: 'setup', role: 'owner' };
          var row = saveRow('Users', 'USR', { username: (opts.ownerUsername || 'owner').toLowerCase(),
            displayName: opts.ownerName || 'Owner', role: 'owner', active: true }, system, 'User');
          setPassword(row.id, opts.ownerPassword);
          created = row.username;
        }
        return { ownerCreated: created };
      });
    }

    return {
      handle: handle,
      /** Run an action as a given user without a session (setup and demo seeding only). */
      runAs: function (user, action, payload) { return execute(action, payload, user, {}); },
      initialize: initialize,
      /** Whether an action saves data, and the lowest role allowed (used by the Supabase server). */
      actionInfo: function (action) {
        if (action === 'auth.login') return { write: true, role: 'staff' };
        var def = A[action];
        return def ? { write: !!def.write, role: def.role } : null;
      }
    };
  }

  return {
    VERSION: VERSION,
    SCHEMA: SCHEMA,
    TEXT_COLUMNS: TEXT_COLUMNS,
    translate: translate,
    formatRunNo: formatRunNo,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    ROLES: ROLES,
    MOVEMENT_TYPES: MOVEMENT_TYPES,
    PO_STATUSES: PO_STATUSES,
    INVOICE_STATUSES: INVOICE_STATUSES,
    createApi: createApi,
    hashPassword: hashPassword,
    sha256: sha256,
    util: { round: round, addDays: addDays, shiftMonth: shiftMonth, monthEnd: monthEnd, list: list, bool: bool }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RestoCore;
