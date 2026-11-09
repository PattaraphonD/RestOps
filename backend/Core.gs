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

  var VERSION = '1.2.0';

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
      'createdAt', 'updatedAt', 'updatedBy', 'version', 'parLevel'],
    Purchases: ['id', 'date', 'supplierId', 'ingredientId', 'qty', 'unitCost', 'total', 'invoiceRef',
      'note', 'voided', 'createdAt', 'createdBy', 'poId', 'poLineId'],
    StockMovements: ['id', 'date', 'ingredientId', 'type', 'qty', 'unitCost', 'value', 'reason', 'refId',
      'voided', 'createdAt', 'createdBy'],
    Menu: ['id', 'name', 'category', 'price', 'active', 'createdAt', 'updatedAt', 'updatedBy', 'version'],
    Recipes: ['id', 'menuItemId', 'ingredientId', 'qty', 'note'],
    Sales: ['id', 'date', 'menuItemId', 'itemName', 'qty', 'unitPrice', 'total', 'unitCost', 'costTotal',
      'channel', 'note', 'voided', 'createdAt', 'createdBy'],
    Expenses: ['id', 'date', 'category', 'description', 'amount', 'paymentMethod', 'note', 'voided',
      'createdAt', 'createdBy'],
    // Purchasing: orders to suppliers, and the suppliers' invoices matched against them.
    PurchaseOrders: ['id', 'poNumber', 'supplierId', 'status', 'orderDate', 'expectedDate', 'note', 'total',
      'sentAt', 'sentBy', 'closedAt', 'closedBy', 'closeReason', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    PurchaseOrderLines: ['id', 'poId', 'ingredientId', 'qtyOrdered', 'unitPrice', 'note'],
    SupplierInvoices: ['id', 'invoiceNo', 'supplierId', 'poId', 'invoiceDate', 'dueDate', 'subtotal', 'vat', 'total',
      'status', 'exceptionCount', 'varianceAmount', 'reviewNote', 'reviewedAt', 'reviewedBy',
      'paidAt', 'paidBy', 'paymentMethod', 'paymentRef', 'note', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    SupplierInvoiceLines: ['id', 'invoiceId', 'ingredientId', 'qty', 'unitPrice', 'total']
  };

  // Columns that must be stored as plain text in the sheet (so "2026-11-07" stays a string).
  var TEXT_COLUMNS = ['id', 'key', 'value', 'date', 'username', 'phone', 'invoiceRef', 'menuItemId',
    'ingredientId', 'supplierId', 'refId', 'passwordHash', 'salt', 'createdAt', 'updatedAt',
    'poId', 'poLineId', 'poNumber', 'invoiceNo', 'invoiceId', 'orderDate', 'expectedDate', 'invoiceDate', 'dueDate',
    'sentAt', 'closedAt', 'reviewedAt', 'paidAt', 'paymentRef'];

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
    units: 'kg, g, L, ml, pcs, pack, bottle, can'
  };

  // Used instead of the English lists when setup runs in Thai (initialize({ lang: 'th' })).
  var DEFAULT_SETTINGS_TH = {
    salesChannels: 'ทานที่ร้าน, กลับบ้าน, เดลิเวอรี่',
    expenseCategories: 'ค่าเช่า, ค่าจ้างพนักงาน, ค่าน้ำค่าไฟ, ค่าแก๊ส, บรรจุภัณฑ์, อุปกรณ์ทำความสะอาด, การตลาด, ค่าซ่อมแซม, ค่าธรรมเนียมเดลิเวอรี่, อื่น ๆ',
    ingredientCategories: 'เนื้อสัตว์และอาหารทะเล, ผักและผลไม้, นมและไข่, ของแห้ง, ซอสและเครื่องปรุง, เครื่องดื่ม, บรรจุภัณฑ์',
    menuCategories: 'อาหารจานหลัก, ข้าวและเส้น, ของทานเล่น, ของหวาน, เครื่องดื่ม',
    units: 'กก., กรัม, ลิตร, มล., ชิ้น, แพ็ค, ขวด, กระป๋อง'
  };

  var ROLES = { staff: 1, manager: 2, owner: 3 };
  var MOVEMENT_TYPES = ['usage', 'waste', 'count', 'adjustment', 'sale'];
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
    'cancelled': 'ถูกยกเลิก', 'closed': 'ปิดแล้ว', 'received': 'รับครบแล้ว', 'draft': 'เป็นฉบับร่าง',
    'sent': 'ส่งแล้ว', 'partial': 'รับบางส่วนแล้ว', 'paid': 'จ่ายแล้ว', 'disputed': 'โต้แย้งอยู่'
  };
  function thLabel(l) {
    var m;
    if (TH_LABELS[l]) return TH_LABELS[l];
    if ((m = /^Line (\d+) quantity$/.exec(l))) return 'จำนวนในรายการที่ ' + m[1];
    if ((m = /^Line (\d+) unit cost$/.exec(l))) return 'ราคาต่อหน่วยในรายการที่ ' + m[1];
    if ((m = /^Recipe line (\d+) quantity$/.exec(l))) return 'ปริมาณในสูตรบรรทัดที่ ' + m[1];
    if ((m = /^(Ingredient|Supplier|Dish|User) "([\s\S]*)"$/.exec(l))) return TH_LABELS[m[1]] + ' "' + m[2] + '"';
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
    [/^Unknown action: ([\s\S]*)$/, 'ไม่รู้จักคำสั่ง: $1'],
    [/^Your role \((\w+)\) cannot do this\. Ask a (\w+)\.$/, function (m) {
      return 'บทบาทของคุณ (' + thLabel(m[1]) + ') ทำรายการนี้ไม่ได้ กรุณาให้' + thLabel(m[2]) + 'ดำเนินการ'; }],
    [/^The system is busy/, 'ระบบกำลังบันทึกข้อมูลของผู้ใช้อื่นอยู่ กรุณาลองอีกครั้ง'],
    [/^Something went wrong on the server: ([\s\S]*)$/, 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์: $1'],
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
    [/^A cancelled order can't be invoiced\.$/, 'ใบสั่งซื้อที่ถูกยกเลิกแล้วออกใบแจ้งหนี้ไม่ได้']
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

    function stockLevels() {
      var onHand = onHandMap();
      var onOrder = onOrderMap();
      var suppliers = byId(db.read('Suppliers'));
      return db.read('Ingredients').map(function (i) {
        var qty = round(onHand[i.id] || 0, 3);
        var min = num(i.minLevel);
        var status = qty <= 0 ? 'out' : qty <= min ? 'low' : 'ok';
        return {
          id: i.id, name: i.name, category: i.category, unit: i.unit,
          costPerUnit: round(num(i.costPerUnit), 4), minLevel: min, parLevel: num(i.parLevel),
          onOrder: round(onOrder[i.id] || 0, 3),
          supplierId: i.supplierId || '', supplierName: suppliers[i.supplierId] ? suppliers[i.supplierId].name : '',
          active: bool(i.active), version: num(i.version),
          onHand: qty, value: round(qty * num(i.costPerUnit)), status: status
        };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    function recipeCost(lines, ingredients) {
      return sum(lines, function (l) {
        var ing = ingredients[l.ingredientId];
        return ing ? num(l.qty) * num(ing.costPerUnit) : 0;
      });
    }

    function menuWithCost() {
      var ingredients = byId(db.read('Ingredients'));
      var recipes = {};
      db.read('Recipes').forEach(function (r) { (recipes[r.menuItemId] = recipes[r.menuItemId] || []).push(r); });
      return db.read('Menu').map(function (m) {
        var lines = (recipes[m.id] || []).map(function (r) {
          var ing = ingredients[r.ingredientId] || {};
          return {
            ingredientId: r.ingredientId, name: ing.name || '(removed ingredient)', unit: ing.unit || '',
            qty: num(r.qty), cost: round(num(r.qty) * num(ing.costPerUnit), 4)
          };
        });
        var cost = round(recipeCost(lines, ingredients), 2);
        var price = num(m.price);
        return {
          id: m.id, name: m.name, category: m.category, price: price, active: bool(m.active),
          version: num(m.version), recipe: lines, foodCost: cost,
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
        users: isOwner ? db.read('Users').map(publicUser) : [],
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
        var qty = reqNum(l.qty, 'Line ' + (i + 1) + ' quantity', { positive: true });
        var unitCost = reqNum(l.unitCost, 'Line ' + (i + 1) + ' unit cost', { min: 0 });
        return { id: newId('PUR'), date: date, supplierId: supplierId || ing.supplierId || '', ingredientId: ing.id,
          qty: round(qty, 3), unitCost: round(unitCost, 4), total: round(qty * unitCost),
          invoiceRef: optStr(header.invoiceRef, 60), note: optStr(header.note), voided: false, createdAt: ts, createdBy: user.username,
          poId: trim(header.poId), poLineId: trim(l.poLineId) };
      });
      db.append('Purchases', rows);
      // Update ingredient cost so recipe costing follows real prices.
      rows.forEach(function (r) {
        var ing = ingredients[r.ingredientId];
        var have = Math.max(0, onHand[ing.id] || 0);
        var oldCost = num(ing.costPerUnit);
        var newCost = method === 'last' || have <= 0 || oldCost <= 0
          ? r.unitCost
          : (have * oldCost + r.qty * r.unitCost) / (have + r.qty);
        onHand[ing.id] = have + r.qty;
        ing.costPerUnit = round(newCost, 4);
        db.updateWhere('Ingredients', function (x) { return x.id === ing.id; },
          { costPerUnit: ing.costPerUnit, updatedAt: ts, updatedBy: user.username, version: num(ing.version) + 1 });
        ing.version = num(ing.version) + 1;
      });
      return { count: rows.length, total: round(sum(rows, function (r) { return r.total; })) };
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
      if (SCHEMA[table].indexOf('note') >= 0) patch.note = (note ? note + ' · ' : '') + 'Voided by ' + user.username + ' ' + nowIso().slice(0, 10);
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
      voidRow('StockMovements', p.id, user, 'Stock entry'); return true;
    } };

    /* Master data */
    A['ingredients.save'] = { role: 'manager', write: true, fn: function (p, user) {
      var d = p.item || {};
      var data = { id: trim(d.id), version: d.version, name: reqStr(d.name, 'Name', 80), category: optStr(d.category, 60),
        unit: reqStr(d.unit, 'Unit', 20), costPerUnit: round(reqNum(d.costPerUnit, 'Cost per unit', { min: 0 }), 4),
        minLevel: round(reqNum(d.minLevel, 'Minimum level', { min: 0 }), 3), supplierId: trim(d.supplierId),
        parLevel: d.parLevel === '' || d.parLevel === undefined || d.parLevel === null ? '' : round(reqNum(d.parLevel, 'Par level', { min: 0 }), 3),
        active: d.active === undefined ? true : bool(d.active) };
      if (data.supplierId) findOrFail('Suppliers', data.supplierId, 'Supplier');
      if (data.active) assertUnique('Ingredients', 'name', data.name, data.id, 'Ingredient');
      if (!data.id) delete data.id;
      return saveRow('Ingredients', 'ING', data, user, 'Ingredient "' + data.name + '"');
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
        return { ingredientId: l.ingredientId, qty: round(reqNum(l.qty, 'Recipe line ' + (i + 1) + ' quantity', { positive: true }), 4),
          note: optStr(l.note, 120) };
      });
      if (!data.id) delete data.id;
      var saved = saveRow('Menu', 'MENU', data, user, 'Dish "' + data.name + '"');
      db.removeWhere('Recipes', function (r) { return r.menuItemId === saved.id; });
      if (recipe.length) {
        db.append('Recipes', recipe.map(function (l) {
          return { id: newId('REC'), menuItemId: saved.id, ingredientId: l.ingredientId, qty: l.qty, note: l.note };
        }));
      }
      return menuWithCost().filter(function (m) { return m.id === saved.id; })[0];
    } };

    /* Sales */
    A['sales.add'] = { role: 'staff', write: true, fn: function (p, user) {
      var date = reqDate(p.date);
      var channel = optStr(p.channel, 40);
      var lines = (p.lines || []).filter(function (l) { return num(l.qty) !== 0; });
      if (!lines.length) fail('VALIDATION', 'Enter a quantity for at least one dish.');
      var menu = byId(menuWithCost());
      var ingredients = byId(db.read('Ingredients'));
      var ts = nowIso();
      var sales = [], moves = [], noRecipe = [];
      lines.forEach(function (l, i) {
        var item = menu[l.menuItemId];
        if (!item) fail('VALIDATION', 'Line ' + (i + 1) + ': dish not found.');
        var qty = reqNum(l.qty, item.name + ' quantity', { positive: true });
        if (Math.round(qty) !== qty) fail('VALIDATION', item.name + ': quantity must be a whole number.');
        var price = l.unitPrice === undefined || l.unitPrice === '' ? item.price : reqNum(l.unitPrice, item.name + ' price', { min: 0 });
        var sale = { id: newId('SAL'), date: date, menuItemId: item.id, itemName: item.name, qty: qty, unitPrice: round(price),
          total: round(qty * price), unitCost: item.foodCost, costTotal: round(qty * item.foodCost), channel: channel,
          note: optStr(l.note, 200), voided: false, createdAt: ts, createdBy: user.username };
        sales.push(sale);
        if (!item.recipe.length) noRecipe.push(item.name);
        // Each dish sold deducts its recipe ingredients from stock.
        item.recipe.forEach(function (r) {
          var ing = ingredients[r.ingredientId];
          if (!ing) return;
          var q = round(-r.qty * qty, 4);
          moves.push({ id: newId('MOV'), date: date, ingredientId: r.ingredientId, type: 'sale', qty: q,
            unitCost: round(num(ing.costPerUnit), 4), value: round(q * num(ing.costPerUnit)),
            reason: qty + ' × ' + item.name, refId: sale.id, voided: false, createdAt: ts, createdBy: user.username });
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
            note: r.note, voided: bool(r.voided), createdAt: r.createdAt, createdBy: r.createdBy };
        }),
        total: round(sum(liveRows, function (r) { return num(r.total); })),
        cost: round(sum(liveRows, function (r) { return num(r.costTotal); })),
        dishes: sum(liveRows, function (r) { return num(r.qty); })
      };
    } };

    A['sales.void'] = { role: 'manager', write: true, fn: function (p, user) {
      voidRow('Sales', p.id, user, 'Sale');
      db.updateWhere('StockMovements', function (r) { return r.refId === p.id && r.type === 'sale'; }, { voided: true });
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
      var gross = revenue - cogs;
      return {
        revenue: round(revenue), cogs: round(cogs), wasteAndVariance: round(loss), expenses: round(exp),
        purchases: round(pur), grossProfit: round(gross), netProfit: round(gross - loss - exp),
        foodCostPct: revenue > 0 ? round((cogs + loss) / revenue * 100, 1) : null,
        theoreticalFoodCostPct: revenue > 0 ? round(cogs / revenue * 100, 1) : null,
        orders: sum(s, function (r) { return num(r.qty); })
      };
    }

    A['reports.summary'] = { role: 'manager', write: false, fn: function (p) {
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
        cashFlow: days, expenseCategories: expenseCategories, trend: trend,
        stockValue: round(sum(stock, function (s) { return Math.max(0, s.value); })),
        lowStock: stock.filter(function (s) { return s.status !== 'ok'; }).length,
        payables: payablesSummary(today),
        purchasing: purchasingCounts(today)
      };
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
      stockLevels().filter(function (i) { return i.active && i.minLevel > 0; }).forEach(function (i) {
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
      return r;
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
        if (k === 'priceTolerancePct') v = String(reqNum(v, 'Price tolerance %', { min: 0 }));
        if (k === 'costMethod' && ['average', 'last'].indexOf(v) < 0) fail('VALIDATION', 'Unknown cost method.');
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
      return def.write ? db.lock(run) : run();
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
      initialize: initialize
    };
  }

  return {
    VERSION: VERSION,
    SCHEMA: SCHEMA,
    TEXT_COLUMNS: TEXT_COLUMNS,
    translate: translate,
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
