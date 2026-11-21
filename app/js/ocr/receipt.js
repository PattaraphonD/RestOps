// Reads a receipt from OCR boxes: supplier, date, receipt number, item lines (qty × price = amount), discounts, VAT and total;
// then matches each line to an ingredient. Plain functions, no DOM: the same file runs in the tests.

/* ------------------------------------------------------------ text helpers */

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const thaiDigits = (s) => String(s).replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
const lettersIn = (s) => (String(s).match(/[A-Za-zก-ฮ]/g) || []).length;

/** A token as numbers it could be: "1,305.50" → [1305.5]; "250,001" → [250001, 250.00 (+VAT flag 1), 250.001]; OCR o/O/S/l fixed when the rest is digits. */
function numberReadings(raw) {
  let t = thaiDigits(raw).trim().replace(/[฿)]$/, '').replace(/^[(฿]/, '');
  if (!/\d/.test(t)) return [];
  if ((t.match(/[0-9]/g) || []).length >= Math.max(2, t.replace(/[.,-]/g, '').length - 1)) {
    t = t.replace(/[oOD]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5');
  }
  t = t.replace(/,\./g, '.').replace(/\.,/g, '.');
  const neg = /^-/.test(t) || /-$/.test(t);
  t = t.replace(/^-|-$/g, '');
  if (!/^\d[\d,]*(\.\d+)?$/.test(t)) return [];
  const out = new Set();
  out.add(Number(t.replace(/,/g, '')));
  // "250,001": a comma read for the decimal point, then the VAT flag stuck on.
  const m = /^(\d+),(\d{2})(\d)$/.exec(t);
  if (m) { out.add(Number(`${m[1]}.${m[2]}`)); out.add(Number(`${m[1]}.${m[2]}${m[3]}`)); }
  const c = /^(\d+),(\d{2})$/.exec(t);
  if (c) out.add(Number(`${c[1]}.${c[2]}`));
  // "1750.002": the price, then the VAT code printed right after it (Makro A4 bills).
  const v = /^(\d{3,}|\d{1,3}(?:,\d{3})+)\.(\d{2})(\d)$/.exec(t);
  if (v) out.add(Number(`${v[1].replace(/,/g, '')}.${v[2]}`));
  return [...out].filter((v) => Number.isFinite(v)).map((v) => (neg ? -v : v));
}
/** Money looks like 12.50 / 1,305.50 (two decimals); one decimal is accepted for totals the OCR clipped ("2845.5"). */
const isMoneyToken = (raw) => /^-?[฿(]?\d{1,3}(,\d{3})*([.,]\d{1,2})[)]?-?$|^-?\d+[.,]\d{1,2}-?$|^\d+,\.\d{2}$|^\d+,\d{2}[0-2]$|^(\d{3,}|\d{1,3}(,\d{3})+)\.\d{3}$/
  .test(thaiDigits(raw).replace(/[oO]/g, '0').replace(/S/g, '5'));

const UNIT_WORDS = ['กิโลกรัม', 'กิโล', 'กก.', 'กก', 'กรัม', 'ก.', 'kg', 'g', 'gm', 'ลิตร', 'ล.', 'มล.', 'มล', 'ml', 'cc',
  'ชิ้น', 'ขวด', 'แพ็ค', 'แพค', 'แพ็ก', 'pack', 'ลัง', 'ถุง', 'กล่อง', 'ห่อ', 'โหล', 'อัน', 'ตัว', 'ฟอง', 'แผง', 'กระป๋อง', 'ถาด',
  'ea', 'pcs', 'pc', 'ใบ', 'หัว', 'กำ', 'มัด', 'แกลลอน', 'ถัง', 'ซอง', 'หลอด',
  // Short forms printed in wholesale unit columns (Makro "1 กล").
  'กล', 'ขว', 'ลง', 'ถง', 'กป', 'แพ', 'ชน', 'ผง'];
/** Short unit forms → the word people use. */
const UNIT_FULL = { 'กล': 'กล่อง', 'ขว': 'ขวด', 'ลง': 'ลัง', 'ถง': 'ถุง', 'กป': 'กระป๋อง', 'แพ': 'แพ็ค', 'ชน': 'ชิ้น', 'ผง': 'แผง' };
// Letters the reader mixes up in short unit words (ร/ล/ว, ด/ค/ต, บ/ป).
const UNIT_SWAPS = [['ร', 'ล'], ['ล', 'ร'], ['ว', 'ร'], ['ร', 'ว'], ['ด', 'ล'], ['ด', 'ค'], ['ค', 'ด'], ['ต', 'ด'], ['บ', 'ป'], ['ป', 'บ']];
const UNIT_ALT = UNIT_WORDS.map((u) => u.replace('.', '\\.')).join('|');
const UNIT_RE = new RegExp(`^(${UNIT_ALT})$`, 'i');
const SIZE_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(กิโลกรัม|กิโล|กก\\.?|kg|กรัม|ก\\.|gm|g|ลิตร|ล\\.|มล\\.?|ml|cc|ฟอง|ชิ้น)(?![a-z])`, 'i');
const canonUnit = (u) => {
  const s = String(u || '').toLowerCase().replace(/\s/g, '');
  if (/^(กก\.?|กิโล(กรัม)?|kg|kgs)$/.test(s)) return 'kg';
  if (/^(กรัม|ก\.|g|gm|gram)$/.test(s)) return 'g';
  if (/^(ลิตร|ล\.|l|ltr|litre|liter)$/.test(s)) return 'l';
  if (/^(มล\.?|ml|cc|มิลลิลิตร)$/.test(s)) return 'ml';
  return s.replace(/\.$/, '');
};
const SHOW_UNIT = { kg: 'กก', g: 'กรัม', l: 'ลิตร', ml: 'มล' };
/** A word from the unit column as the unit to show: kg → กก, กล → กล่อง, a one-letter misreading fixed ("กร" → กล่อง). */
function showUnit(word) {
  let w = String(word || '').replace(/,$/, '');
  if (!UNIT_RE.test(w)) w = w.replace(/\.$/, '');   // "ล." and "ก." are units as written; "ขวด." is "ขวด"
  if (!UNIT_RE.test(w)) {
    for (const [a, b] of UNIT_SWAPS) {
      for (let i = w.indexOf(a); i >= 0; i = w.indexOf(a, i + 1)) {
        const t = w.slice(0, i) + b + w.slice(i + 1);
        if (UNIT_RE.test(t)) { w = t; break; }
      }
      if (UNIT_RE.test(w)) break;
    }
  }
  return SHOW_UNIT[canonUnit(w)] || UNIT_FULL[w] || w.replace(/\.$/, '');
}

/** How many of `to` are in one `from` (kg → g = 1000), or null when they can't be converted. */
export function unitFactor(from, to) {
  const a = canonUnit(from), b = canonUnit(to);
  if (!a || !b) return null;
  if (a === b) return 1;
  const table = { 'kg>g': 1000, 'g>kg': 0.001, 'l>ml': 1000, 'ml>l': 0.001 };
  return table[`${a}>${b}`] || null;
}

// English words with word edges (CASHEW is not CASH, NET WT is not a total); Thai words at the start of a word.
const en = (words) => `(?<![a-z])(${words})(?![a-z])`;
const KEY = {
  total: new RegExp(`${en('total|sub\\s*total|tot|grand total|amount due|balance due')}|(^|\\s)(รวมเงิน|รวมทั้งสิ้น|ยอดรวม|ยอดสุทธิ|ยอดเงิน|รวม|ยอดชำระ|ชำระ)`, 'i'),
  pay: new RegExp(`${en('cash|change|credit|card|visa|master|qr|promptpay')}|(^|\\s)(เงินสด|ทอน|เงินทอน|บัตร|โอน|พร้อมเพย์)`, 'i'),
  vat: /(ภาษีมูลค่าเพิ่ม|(?<![a-z])vat\s*\d|(?<![a-z])vat\s*7|v\.a\.t|ภาษี\s*7)/i,
  discount: /(ส่วนลด|(?<![a-z])discount|(?<![a-z])disc\.?(?![a-z])|(^|\s)ลด\s)/i,
  billDiscount: /(ท้ายบิล|ทั้งบิล|ส่วนลดรวม|bill\s*disc|total\s*disc)/i,
  skip: new RegExp(`${en('tid|trace|batch|ref|approval|appr|auth|member|point|tel|pos\\s*id|branch|cashier|credit\\s*limit')}|สมาชิก|คะแนน|โทร|สาขา|พนักงาน|วงเงิน|ยอดยกมา|มัดจำ`, 'i'),
  receiptNo: /(receipt\s*no|เลขที่ใบเสร็จ|ใบเสร็จ(รับเงิน)?\s*(เลขที่|no)|ใบกำกับ(ภาษี)?\s*(เลขที่|no)|tax\s*invoice\s*no|invoice\s*no|inv\.?\s*no|bill\s*no|เลขที่บิล)/i,
  receiptNoGeneric: /(เลขที่|(?<![a-z])no\.?(?![a-z]))/i,
  notReceiptNo: /(tel|โทร|fax|แฟกซ์|member|สมาชิก|pos|tax\s*id|ผู้เสียภาษี|ทะเบียน|registration|reg\.?\s*no|card|บัตร|สาขา|branch)/i,
  date: /(date|วันที่)/i,
};

const SUPPLIER_ALIASES = [
  ['makro', 'แม็คโคร', 'แมคโคร', 'แม็กโคร', 'แมกโคร'],
  ['lotus', 'โลตัส', 'lotuss'],
  ['big c', 'bigc', 'บิ๊กซี', 'บิ๊ก ซี'],
  ['tops', 'ท็อปส์', 'ทอปส์'],
  ['cp freshmart', 'ซีพี เฟรชมาร์ท', 'cp fresh'],
  ['villa market', 'วิลล่า'],
  ['foodland', 'ฟู้ดแลนด์'],
  ['gourmet market', 'กูร์เมต์'],
  ['7-eleven', 'เซเว่น', '7eleven'],
];
const NAME_STOPWORDS = new Set(['บริษัท', 'บจก', 'จำกัด', 'มหาชน', '(มหาชน)', 'ร้าน', 'หจก', 'ห้างหุ้นส่วนจำกัด', 'สาขา', 'สำนักงานใหญ่',
  'co', 'co.', 'ltd', 'ltd.', 'company', 'limited', 'the', 'shop', 'store', 'บมจ']);

const THAI_MONTHS = [['ม.ค.', 'มกราคม'], ['ก.พ.', 'กุมภาพันธ์'], ['มี.ค.', 'มีนาคม'], ['เม.ย.', 'เมษายน'], ['พ.ค.', 'พฤษภาคม'], ['มิ.ย.', 'มิถุนายน'],
  ['ก.ค.', 'กรกฎาคม'], ['ส.ค.', 'สิงหาคม'], ['ก.ย.', 'กันยายน'], ['ต.ค.', 'ตุลาคม'], ['พ.ย.', 'พฤศจิกายน'], ['ธ.ค.', 'ธันวาคม']];

/* ------------------------------------------------------------ rows */

/** Boxes → rows (boxes whose vertical centres are close), each row's cells left to right. */
export function groupRows(boxes) {
  const items = boxes.filter((b) => b.text && b.text.trim()).map((b) => ({ ...b, cy: b.y + b.h / 2 })).sort((a, b) => a.cy - b.cy);
  const hs = items.map((b) => b.h).sort((a, b) => a - b);
  const medH = hs.length ? hs[Math.floor(hs.length / 2)] : 40;
  const rows = [];
  items.forEach((b) => {
    const row = rows[rows.length - 1];
    if (row && Math.abs(b.cy - row.cy) < Math.min(medH, Math.min(b.h, row.h)) * 0.45) {
      row.cells.push(b);
      row.cy = row.cells.reduce((s, c) => s + c.cy, 0) / row.cells.length;
      row.h = Math.max(row.h, b.h);
    } else rows.push({ cy: b.cy, h: b.h, top: b.y, cells: [b] });
  });
  rows.forEach(finishRow);
  return rows;
}
function finishRow(r) {
  r.cells.sort((a, b) => a.x - b.x);
  r.text = r.cells.map((c) => c.text.trim()).join(' ');
  r.top = Math.min(...r.cells.map((c) => c.y));
  r.bottom = Math.max(...r.cells.map((c) => c.y + c.h));
}

/** Items printed over two rows: a name row, then a row of only numbers ("2 @ 45.00", "3 X 38.00  114.00"). */
function mergeTwoRowItems(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    if (b && lettersIn(a.text) >= 2 && !KEY.total.test(a.text) && !KEY.pay.test(a.text)) {
      const bLetters = lettersIn(b.text.replace(/(?<=\d\s*)[xX×@](?=\s*\d)|\s[xX×@]\s/g, ' '));
      const bNums = rowTokens(b).filter((k) => k.nums.length).length;
      const aHasMoney = rowTokens(a).some((k) => k.money);
      const bLooksLikeQtyPrice = /\d\s*[xX×@]\s*\d/.test(b.text);
      if (bLetters < 2 && bNums >= 1 && (!aHasMoney || bLooksLikeQtyPrice)) {
        const merged = { cy: a.cy, h: a.h + b.h, cells: [...a.cells, ...b.cells] };
        finishRow(merged);
        out.push(merged);
        i++;
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

/* ------------------------------------------------------------ columns */

// What a column heading says it holds. Checked in this order: "VALUE INCLUDED VAT" is the amount, "PACK PRICE" the price,
// "VAT CODE" not the amount, "ARTICLE DESCRIPTION" the name.
const COL_KINDS = [
  ['amount', /(amount|value|total|มูลค่า|จำนวนเงิน|รวมเงิน|(^|\s)รวม|ยอดเงิน|ราคารวม)/i],
  ['vat', /(vat\s*code|tax\s*code|รหัส\s*ภ\.?\s*พ|^vat$)/i],
  ['price', /(price|ราคา|@|ต่อหน่วย|หน่วยละ|u\/p)/i],
  ['name', /(description|รายการ|รายละเอียด|ชื่อสินค้า|product|particular|(?<![a-z])items?(?![a-z]))/i],
  ['qty', /(quantity|qty|weight|จำนวน|น้ำหนัก|ปริมาณ)/i],
  ['code', /(article|barcode|sku|รหัส|(?<![a-z])code(?![a-z])|number)/i],
  ['unit', /(unit|pack|หน่วย|บรรจุ)/i],
];
const kindOf = (text) => { const k = COL_KINDS.find(([, re]) => re.test(text)); return k ? k[0] : ''; };

/**
 * The item table's headings (QUANTITY / ARTICLE NUMBER / DESCRIPTION / UNIT / PRICE / AMOUNT, or จำนวน / รายการ / ราคา / รวม),
 * as columns: [{ kind, cx, x0, x1 }] left to right, plus the last heading row. Headings printed over two or three lines
 * ("PACK" over "PRICE" over "ราคา(บาท)") are read as one. null when the receipt has no table headings.
 */
export function findColumns(rows) {
  for (let i = 0; i < rows.length; i++) {
    // Table headings come before the items: once a row has an amount of money, it is too late (a footer laid out like
    // headings — "จำนวนชิ้น  ราคาก่อนภาษี  ภาษี  รวมเงิน" — is not the table).
    if (rowTokens(rows[i]).some((k) => k.money && k.nums.some((v) => v > 0))) return null;
    const kinds = new Set(rows[i].cells.map((c) => kindOf(c.text)).filter(Boolean));
    if (kinds.size < 3 || (!kinds.has('amount') && !kinds.has('price'))) continue;
    if (rows[i].cells.some((c) => isMoneyToken(c.text.trim()))) continue;
    // The heading band: this row and the heading rows right under it (no money, still headings).
    let end = i;
    while (end + 1 < rows.length && end - i < 3) {
      const next = rows[end + 1];
      const gap = next.top - rows[end].bottom;
      if (gap > rows[end].h * 1.2 || next.cells.some((c) => isMoneyToken(c.text.trim()))) break;
      if (next.cells.filter((c) => kindOf(c.text)).length < 2) break;
      end++;
    }
    // Stack the heading cells that sit over one another into columns.
    const cells = rows.slice(i, end + 1).flatMap((r) => r.cells).sort((a, b) => a.x - b.x);
    const cols = [];
    cells.forEach((c) => {
      const col = cols.find((k) => {
        const overlap = Math.min(k.x1, c.x + c.w) - Math.max(k.x0, c.x);
        return overlap > Math.min(k.x1 - k.x0, c.w) * 0.3;
      });
      if (col) { col.texts.push(c.text); col.x0 = Math.min(col.x0, c.x); col.x1 = Math.max(col.x1, c.x + c.w); } else cols.push({ texts: [c.text], x0: c.x, x1: c.x + c.w });
    });
    const out = cols.map((k) => ({ kind: kindOf(k.texts.join(' ')) || 'other', x0: k.x0, x1: k.x1, cx: (k.x0 + k.x1) / 2, label: k.texts.join(' ') }))
      .sort((a, b) => a.cx - b.cx);
    const found = new Set(out.map((k) => k.kind));
    if (!found.has('amount') || found.size < 3) continue;
    return { cols: out, headerEnd: end };
  }
  return null;
}
/** The column a point across the page falls in: inside a heading's span wins, otherwise the closest heading. */
function colAt(cols, x) {
  let best = null, bestD = Infinity;
  cols.forEach((k) => {
    const d = x < k.x0 ? k.x0 - x : x > k.x1 ? x - k.x1 : 0;
    const dd = d * 4 + Math.abs(x - k.cx) * 0.01;
    if (dd < bestD) { bestD = dd; best = k; }
  });
  return best ? best.kind : '';
}

/* ------------------------------------------------------------ the receipt */

function parseDate(text, todayIso) {
  const s = thaiDigits(text);
  const ok = (y, mo, d) => {
    if (y > 2400) y -= 543;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return '';
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return todayIso && iso > todayIso ? '' : iso;
  };
  // 2025-02-18 (year first)
  let m;
  const iso = /(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/g;
  while ((m = iso.exec(s))) { const r = ok(Number(m[1]), Number(m[2]), Number(m[3])); if (r) return r; }
  // 18/02/2568, 18-02-2025, 3/11/25
  const dmy = /(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2,4})(?!\d)/g;
  while ((m = dmy.exec(s))) {
    if (m[3].length === 3) continue;
    let y = Number(m[3]);
    if (m[3].length === 2) y = y >= 60 ? 2500 + y : 2000 + y;
    const r = ok(y, Number(m[2]), Number(m[1]));
    if (r) return r;
  }
  // 18 ก.พ. 68 / 18 กุมภาพันธ์ 2568
  const months = THAI_MONTHS.map((pair, i) => [i + 1, pair]);
  const names = months.flatMap(([, pair]) => pair).map((n) => n.replace(/\./g, '\\.?')).join('|');
  const thai = new RegExp(`(\\d{1,2})\\s*(${names})\\s*(\\d{2,4})`, 'g');
  while ((m = thai.exec(s))) {
    const word = m[2].replace(/\./g, '');
    const mo = months.find(([, pair]) => pair.some((n) => n.replace(/\./g, '') === word));
    if (!mo) continue;
    let y = Number(m[3]);
    if (m[3].length === 2) y = y >= 60 ? 2500 + y : 2000 + y;
    const r = ok(y, mo[0], Number(m[1]));
    if (r) return r;
  }
  return '';
}

/** Splits a row into its numbers (with every way to read them), unit words and words. */
function rowTokens(row, cols) {
  const toks = [];
  row.cells.forEach((c) => {
    const text = c.text.trim(), parts = text.split(/\s+/);
    // Thai vowel and tone marks sit above or below a letter and take no width of their own.
    const width = (t) => t.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').length;
    const total = Math.max(1, width(text));
    const wordy = lettersIn(c.text.replace(new RegExp(`(^|\\s)(${UNIT_ALT})(\\s|$)`, 'ig'), ' ')) >= 2;   // a name cell, not a "2 ขวด" cell
    let from = 0;
    parts.forEach((t, i) => {
      // Where the word sits across the page, from its place among the cell's characters.
      const at = text.indexOf(t, from); from = at + t.length;
      const before = width(text.slice(0, at));
      const x0 = c.x + (c.w * before) / total, x1 = c.x + (c.w * (before + width(t))) / total;
      const next = parts[i + 1] || '';
      const sizeHere = wordy && /^\d+(\.\d+)?$/.test(thaiDigits(t)) && UNIT_RE.test(next.replace(/,$/, ''));
      toks.push({ t, cell: c, i, wordy, x: x0, cx: (x0 + x1) / 2, col: cols ? colAt(cols, (x0 + x1) / 2) : '', money: isMoneyToken(t),
        nums: sizeHere ? [] : numberReadings(t), size: sizeHere,
        unit: !wordy && UNIT_RE.test(t.replace(/,$/, '')) ? t.replace(/,$/, '') : '' });
    });
  });
  return toks;
}

/** One item row → { code, name, qty, unit, size, unitPrice, amount, confident } when qty × price = amount works out (or a single price). */
function readItem(row, width, cols) {
  const toks = rowTokens(row, cols);
  const moneyToks = toks.filter((k) => k.money && k.nums.length);
  if (!moneyToks.length) return null;
  // With table headings, the amount is the money in the amount column; without, the rightmost money on the row.
  const inAmountCol = cols ? moneyToks.filter((k) => k.col === 'amount') : [];
  const amountTok = (inAmountCol.length ? inAmountCol : moneyToks).reduce((a, b) => (b.x >= a.x ? b : a));
  if (!inAmountCol.length && amountTok.cx < width * 0.55) return null;
  const amounts = amountTok.nums.filter((v) => v !== 0);
  if (!amounts.length) return null;
  const isCode = (k) => /^\d{8,14}$/.test(thaiDigits(k.t).replace(/[oO]/g, '0'));
  // VAT-code and product-code columns hold no quantities or prices.
  const known = (kind) => cols && cols.some((c) => c.kind === kind);
  // Columns the headings didn't name (a discount, a running count) hold no quantity or price once both have their own.
  const others = toks.filter((k) => k !== amountTok && k.nums.length && !/[-/]\d/.test(k.t) && !isCode(k) && k.col !== 'vat' && k.col !== 'code'
    && !(k.col === 'other' && known('qty') && known('price')));
  const codeTok = toks.find(isCode);
  // A number outside the column it belongs in counts against that reading (more than a rounding difference).
  const off = (k, kind) => (cols && cols.some((c) => c.kind === kind) && k.col !== kind ? 0.02 : 0);
  let best = null;
  for (const amount of amounts) {
    for (const p of others) {
      if (!p.money) continue;
      for (const price of p.nums) {
        if (!(price > 0)) continue;
        for (const q of others) {
          if (q === p) continue;
          for (const qty of q.nums) {
            if (!(qty > 0) || qty > 10000) continue;
            const err = Math.abs(qty * price - amount) / Math.abs(amount);
            // Quantities usually stand left of the price, and prices have two decimals.
            const score = err + (q.x > p.x ? 0.002 : 0) + (Math.round(price * 100) !== price * 100 ? 0.003 : 0) + off(q, 'qty') + off(p, 'price');
            if (err <= 0.015 && (!best || score < best.score)) best = { amount, price, qty, score };
          }
        }
        if (!best) {
          const derived = amount / price;
          if (derived > 0 && derived < 1000 && Math.abs(derived - Math.round(derived * 1000) / 1000) < 1e-9) {
            best = { amount, price, qty: Math.round(derived * 1000) / 1000, score: 0.5 };
          }
        }
      }
    }
  }
  // A discount column: quantity × price − the discount = the amount ("3 × 45.00 − 10.00 = 125.00").
  let lineDiscount = 0;
  if (!best && cols) {
    const dToks = toks.filter((k) => k.col === 'other' && k.money && k.nums.length);
    for (const q of others.filter((k) => k.col === 'qty')) for (const p of others.filter((k) => k.col === 'price' && k.money)) for (const d of dToks) {
      for (const qty of q.nums) for (const price of p.nums) for (const disc of d.nums) for (const amount of amounts) {
        const dv = Math.abs(disc);
        if (!best && qty > 0 && price > 0 && dv > 0 && Math.abs(qty * price - dv - amount) < 0.011) { best = { amount, price, qty, score: 0.01 }; lineDiscount = dv; }
      }
    }
  }
  // The quantity column says how many even when there is no price to check it against.
  // Not on a total or payment row, and not when a printed price disagrees; always left for the person to check.
  if (!best && cols && !KEY.total.test(row.text) && !KEY.pay.test(row.text) && !others.some((k) => k.col === 'price' && k.money)) {
    const qTok = others.find((k) => k.col === 'qty' && k.nums.some((v) => v > 0 && v <= 10000));
    if (qTok) {
      const qty = qTok.nums.find((v) => v > 0 && v <= 10000), amount = amounts[0];
      best = { amount, price: Math.round((amount / qty) * 10000) / 10000, qty, score: 0.5 };
    }
  }
  const amount = best ? best.amount : amounts[0];
  let qty = best ? best.qty : 1;
  const unitPrice = best ? best.price : amount;
  if (best && !lineDiscount) {
    const exact = Math.round((amount / unitPrice) * 1000) / 1000;
    if (Math.abs(exact - qty) / qty < 0.015) qty = exact;
  }
  // The unit only from its own column ("2 ขวด"); "5 กก" inside the name is a pack size.
  let unitTok = toks.find((k) => k.unit && (!cols || k.col === 'unit' || k.col === 'qty'));
  let nameText;
  if (cols && cols.some((c) => c.kind === 'name')) {
    // A word in the unit column is the unit even when the reader got a letter wrong ("กร" for "กล").
    if (!unitTok) {
      const w = toks.find((k) => k.col === 'unit' && !k.nums.length && !/\d/.test(k.t) && lettersIn(k.t) >= 1 && k.t.length <= 8);
      if (w) unitTok = { unit: w.t };
    }
    nameText = toks.filter((k) => (k.col === 'name' || k.col === 'code' || (k.col === 'other' && lettersIn(k.t) >= 2)) && k !== codeTok).map((k) => k.t).join(' ');
  } else nameText = row.cells.filter((c) => lettersIn(c.text.replace(new RegExp(`(^|\\s)(${UNIT_ALT})(\\s|$)`, 'ig'), ' ')) >= 2)
    .map((c) => c.text.trim()).join(' ');
  const sizeM = SIZE_RE.exec(thaiDigits(nameText));
  const name = nameText.replace(/^(\s*[\d.,]+\s+)+/, '').replace(/^\d{8,14}\s*/, '').replace(/\s+\d+\s*$/, '').replace(/^[*#•·\-\s]+/, '').trim();
  return {
    code: codeTok ? thaiDigits(codeTok.t).replace(/[oO]/g, '0') : '',
    name, qty, unit: unitTok ? showUnit(unitTok.unit) : '',
    size: sizeM ? { qty: Number(sizeM[1]), unit: sizeM[2].replace(/\.$/, '') } : null,
    unitPrice: Math.round(unitPrice * 10000) / 10000, amount: Math.round(amount * 100) / 100,
    ...(lineDiscount ? { discount: Math.round(lineDiscount * 100) / 100 } : {}),
    confident: !!best && best.score < 0.5, raw: row.text, y: Math.round(row.top), h: Math.round(row.bottom - row.top),
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
/** Shares `amount` across the lines by their amounts (rounding goes to the last line), `sign` −1 to take off, +1 to add. */
function spread(lines, amount, sign, field) {
  const base = lines.reduce((s, l) => s + l.amount, 0);
  if (!(base > 0) || !(amount > 0)) return;
  let left = amount;
  lines.forEach((l, i) => {
    const share = i === lines.length - 1 ? left : round2((amount * l.amount) / base);
    left = round2(left - share);
    l.amount = round2(l.amount + sign * share);
    l[field] = round2((l[field] || 0) + share);
  });
}

/**
 * OCR result → { supplierId, supplierHint, date, receiptNo, taxId, lines, billDiscount, vat, vatAdded, total, totalMatches, rows }.
 * opts.suppliers: the shop's suppliers ({ id, name, taxId }); opts.today: no dates after it.
 */
export function parseReceipt(ocr, opts = {}) {
  const width = ocr.width || Math.max(...ocr.boxes.map((b) => b.x + b.w), 1);
  const rows = mergeTwoRowItems(groupRows(ocr.boxes || []));
  const table = findColumns(rows);
  const cols = table ? table.cols : null;
  const lines = [];
  let billDiscount = 0;
  for (let i = table ? table.headerEnd + 1 : 0; i < rows.length; i++) {
    const row = rows[i], text = row.text;
    if (KEY.skip.test(text) && !/\d+[.,]\d{2}\s*$/.test(text)) continue;
    const item = readItem(row, width, cols);
    if (KEY.discount.test(text) && (lines.length || KEY.billDiscount.test(text))) {
      const nums = rowTokens(row).filter((k) => k.money && k.nums.length);
      if (!nums.length) continue;
      const d = Math.abs(nums[nums.length - 1].nums[0]);
      if (KEY.billDiscount.test(text)) billDiscount = round2(billDiscount + d);
      else {
        const prev = lines[lines.length - 1];
        prev.discount = round2((prev.discount || 0) + d);
        prev.amount = round2(prev.amount - d);
      }
      continue;
    }
    // A total, payment or VAT row ends the items — unless it is itself a clear item (qty × price = amount).
    if ((KEY.total.test(text) || KEY.pay.test(text) || KEY.vat.test(text)) && !(item && item.confident)) {
      if (lines.length) break;
      continue;
    }
    if (!item) continue;
    item.row = i;
    lines.push(item);
  }
  // Totals misread by a digit (2945.50 for 2845.50) at the end, with no qty × price of their own, are not items.
  while (lines.length >= 3) {
    const last = lines[lines.length - 1];
    if (last.confident || last.code) break;
    const confident = lines.filter((l) => l.confident);
    const ref = confident.length ? confident.reduce((s, l) => s + l.amount, 0) : lines.slice(0, -1).reduce((s, l) => s + l.amount, 0);
    if (!(ref > 0) || Math.abs(last.amount - ref) / ref > 0.05) break;
    lines.pop();
  }
  // Totals whose label was garbled ("LEGAL AM0UNT" → "2101NT") read as items at the end of the list. Lines are cut only
  // when the receipt itself proves it: the lines kept add up to an amount printed again below them (a total shows up
  // more than once: total, cash, "ยอดชำระ"), and the full list adds up to nothing printed. Lines with a qty × price,
  // a product code or a price of their own are never cut.
  const moneyBelow = (rowIdx) => {
    const out = [];
    rows.slice(rowIdx + 1).forEach((r) => rowTokens(r).forEach((k) => { if (k.money) k.nums.forEach((v) => { if (v > 0) out.push(round2(v)); }); }));
    return out;
  };
  const sumOf = (ls) => round2(ls.reduce((s, l) => s + l.amount, 0));
  if (lines.length >= 3) {
    const lastRow = lines[lines.length - 1].row;
    const afterAll = moneyBelow(lastRow);
    const fullSumPrinted = afterAll.some((v) => Math.abs(v - sumOf(lines)) < 0.01);
    for (let k = lines.length - 1; k >= 2 && !fullSumPrinted; k--) {
      const cut = lines.slice(k);
      if (cut.some((l) => l.confident || l.code || l.unitPrice !== l.amount)) break;
      const kept = sumOf(lines.slice(0, k));
      const seen = moneyBelow(lines[k - 1].row).filter((v) => Math.abs(v - kept) < 0.01).length;
      const below = afterAll.some((v) => Math.abs(v - kept) < 0.01);
      if (seen >= 2 || below) { lines.length = k; break; }
    }
  }
  if (billDiscount) spread(lines, billDiscount, -1, 'discount');
  const lastItemRow = lines.length ? lines[lines.length - 1].row : -1;
  const firstItemRow = lines.length ? lines[0].row : rows.length;

  const all = rows.map((r) => r.text).join('\n');
  const header = rows.slice(0, firstItemRow).map((r) => r.text).join('\n');
  const below = rows.slice(lastItemRow + 1);
  const values = [];
  below.forEach((r) => rowTokens(r).forEach((k) => { if (k.money) k.nums.forEach((v) => { if (v > 0) values.push(round2(v)); }); }));
  let vat = 0;
  below.forEach((r) => {
    if (!KEY.vat.test(r.text)) return;
    const m = rowTokens(r).filter((k) => k.money && k.nums.length);
    if (m.length) vat = round2(m[m.length - 1].nums[0]);
  });
  // The total: VAT added on top of the item prices (an ex-VAT tax invoice), else what the lines add up to, else the most repeated amount.
  const sum = round2(lines.reduce((s, l) => s + l.amount, 0));
  let total = 0, vatAdded = 0;
  if (vat > 0 && values.some((v) => Math.abs(v - (sum + vat)) < 0.02)) {
    total = round2(sum + vat);
    vatAdded = vat;
    spread(lines, vat, +1, 'vat');
  } else total = values.find((v) => Math.abs(v - sum) < 0.01) || 0;
  if (!total && values.length) {
    const count = {};
    values.forEach((v) => { count[v] = (count[v] || 0) + 1; });
    total = Number(Object.keys(count).sort((a, b) => count[b] - count[a] || b - a)[0]);
  }
  const finalSum = round2(lines.reduce((s, l) => s + l.amount, 0));

  // Receipt number: a specific label first; a plain "เลขที่ / No." only on rows that aren't a phone, member or POS number.
  let receiptNo = '';
  const pick = (re, guard) => rows.some((r) => {
    if (!re.test(r.text) || (guard && guard.test(r.text))) return false;
    const after = r.text.split(re).pop();
    // Not a phone number, and not a 13-digit company/tax registration number (0 + 12 digits).
    const m = (thaiDigits(after).match(/[A-Z0-9][A-Z0-9-]{3,}/gi) || []).filter((tk) => /\d{4,}/.test(tk) && !/^\d{1,3}-\d{3}-\d{4}$/.test(tk) && !/^0\d{12}$/.test(tk))
      .sort((a, b) => b.length - a.length)[0];
    if (m) receiptNo = m;
    return !!m;
  });
  if (!pick(KEY.receiptNo)) pick(KEY.receiptNoGeneric, KEY.notReceiptNo);
  const taxM = thaiDigits(header + '\n' + all).match(/(?:^|\D)(0\d{12})(?!\d)/);
  const taxId = taxM ? taxM[1] : '';
  const dateRow = rows.find((r) => KEY.date.test(r.text) && parseDate(r.text, opts.today));
  const date = parseDate(dateRow ? dateRow.text : all, opts.today);

  // Supplier: tax ID, then a known chain's name, then the shop's own supplier names (real words, not "บริษัท … จำกัด").
  const sups = (opts.suppliers || []).filter((s) => s.active !== false);
  const low = (header || all).toLowerCase();
  let supplierId = '', supplierHint = '';
  const byTax = taxId && sups.find((s) => String(s.taxId || '').replace(/\D/g, '') === taxId);
  if (byTax) supplierId = byTax.id;
  if (!supplierId) {
    const chain = SUPPLIER_ALIASES.find((names) => names.some((n) => low.includes(n)));
    if (chain) {
      supplierHint = chain[0];
      const s = sups.find((x) => chain.some((n) => x.name.toLowerCase().includes(n)));
      if (s) supplierId = s.id;
    }
  }
  if (!supplierId) {
    let bestScore = 0;
    sups.forEach((s) => {
      const words = s.name.toLowerCase().split(/[\s()\-/,]+/).filter((w) => w.length >= 3 && !NAME_STOPWORDS.has(w));
      if (!words.length) return;
      const hit = words.filter((w) => low.includes(w)).length;
      const score = hit / words.length;
      if ((score === 1 || (score >= 0.5 && hit >= 2)) && score > bestScore) { bestScore = score; supplierId = s.id; }
    });
  }
  lines.forEach((l) => { delete l.row; });
  return { supplierId, supplierHint, date, receiptNo, taxId, lines, billDiscount, vat, vatAdded, total, sum: finalSum,
    totalMatches: !!total && Math.abs(total - finalSum) < 0.01, columns: cols ? cols.map((c) => c.kind) : [], rows };
}

/* ------------------------------------------------------------ matching */

const norm = (s) => thaiDigits(String(s || '').toLowerCase()).replace(/[\s.,()\-/*#:;'"!]+/g, '');
const bigrams = (s) => { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; };
/** How much of the ingredient's name is in the receipt's words (0–1), and overall likeness. */
function likeness(receiptName, ingName) {
  const a = bigrams(norm(receiptName)), b = bigrams(norm(ingName));
  if (!a.length || !b.length) return { cover: 0, dice: 0 };
  const pool = a.slice();
  let common = 0;
  b.forEach((g) => { const i = pool.indexOf(g); if (i >= 0) { common++; pool.splice(i, 1); } });
  return { cover: common / b.length, dice: (2 * common) / (a.length + b.length) };
}
const isWeight = (u) => ['kg', 'g'].includes(canonUnit(u));

// Thai letters the reader mixes up, each group written as its first letter; tone and small marks dropped.
const LOOKALIKE = {};
['ดคตฅศ', 'บปษ', 'เโ', 'ไใ', 'ผฝ', 'พฟ', 'ถภ', 'ฎฏฐ', 'ชซ', 'รว', 'อฮ', 'ลส', 'ขฃ', 'ทฑ', 'ิี', 'ึื', 'ุู']
  .forEach((g) => [...g].forEach((ch) => { LOOKALIKE[ch] = g[0]; }));
/** A name as the reader might have seen it: no tone marks, look-alike letters made the same, no spaces or signs. */
const skeleton = (s) => [...norm(s).replace(/[\u0E48-\u0E4C\u0E4E\u0E31\u0E47]/g, '').replace(/\u0E4D\u0E32/g, '\u0E33').replace(/\u0E4D/g, '')]
  .map((ch) => LOOKALIKE[ch] || ch).join('');
/**
 * The fewest letter changes (look-alikes counted as the same) to find the ingredient's name somewhere in the receipt's
 * text. "เค๊ะหพับเพ่เมก้า" holds "โต๊ะพับโฟเมก้า" with 1 change (an extra ห). Both are skeletons.
 */
function changesToFind(p, t) {
  if (!p.length || !t.length) return Infinity;
  let prev = new Array(t.length + 1).fill(0);   // the name may start anywhere in the receipt's text
  for (let i = 1; i <= p.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (p[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return Math.min(...prev);
}
// Names of 6+ letters; one changed letter allowed per 8 (6–7 letters: look-alikes only). "ผงปรุงรสหมู" is not
// "ผงปรุงรสไก่" and "พริกแห้ง" is not "พริกแกง": a real word changed is a different thing.
const FUZZY_MIN_LEN = 6, fuzzyAllowed = (len) => Math.floor(len / 8);

/** Ingredient units in one receipt unit, from what the receipt says: its unit column, a size in the name, or a weighed quantity. */
export function factorFor(line, ing) {
  if (!line.size && line.name) {
    const m = SIZE_RE.exec(thaiDigits(line.name));
    if (m) line = { ...line, size: { qty: Number(m[1]), unit: m[2].replace(/\.$/, '') } };
  }
  if (line.unit) {
    const f = unitFactor(line.unit, ing.unit);
    if (f) return f;
  }
  if (line.size) {
    const f = unitFactor(line.size.unit, ing.unit);
    if (f) return Math.round(line.size.qty * f * 10000) / 10000;
  }
  // A weighed item (5.222) without a unit is in kilograms.
  if (!line.unit && !line.size && Math.round(line.qty) !== line.qty && isWeight(ing.unit)) return unitFactor('kg', ing.unit);
  return null;   // the person says how much they received
}

/**
 * Receipt lines → ingredient suggestions: { ingredientId, how: 'code' | 'name' | '', factor, ingQty, unitCost, needsCheck, costRatio }.
 * factor = ingredient units in one receipt unit (1 กก = 1000 กรัม; a 700 ml bottle = 700 มล.). Never guessed as 1.
 */
export function matchLines(lines, ingredients, supplierId) {
  const usable = ingredients.filter((i) => i.active !== false && i.kind !== 'prep');
  const skels = new Map(), skel = (i) => { if (!skels.has(i)) skels.set(i, skeleton(i.name)); return skels.get(i); };
  return lines.map((l) => {
    let ing = null, how = '', factor = null;
    if (l.code) {
      for (const i of usable) {
        const items = (i.supplierItems || []).filter((s) => s.supplierCode === l.code);
        const si = items.find((s) => s.supplierId === supplierId) || items[0];
        if (si) {
          ing = i; how = 'code';
          // The remembered pack only applies when the receipt speaks of the same pack.
          const samePack = !l.unit || !si.packName || canonUnit(l.unit) === canonUnit(si.packName);
          factor = samePack ? Number(si.packQty) || null : null;
          break;
        }
        if (i.code && i.code === l.code) { ing = i; how = 'code'; break; }
      }
    }
    if (!ing && l.name) {
      let best = null;
      usable.forEach((i) => {
        if (norm(i.name).length < 4) return;   // "น้ำ", "ไข่", "หมู" would match too much
        const s = likeness(l.name, i.name);
        const score = s.cover * 0.7 + s.dice * 0.3;
        if (s.cover >= 0.8 && s.dice >= 0.3 && (!best || score > best.score)) best = { i, score };
      });
      if (best) { ing = best.i; how = 'name'; }
    }
    // Letters misread: the long-enough name found in the receipt's text with the fewest changes (and the longest name on a tie).
    if (!ing && l.name) {
      const t = skeleton(l.name);
      let best = null;
      usable.forEach((i) => {
        const p = skel(i);
        if (p.length < FUZZY_MIN_LEN) return;
        const d = changesToFind(p, t);
        if (d <= fuzzyAllowed(p.length) && (!best || d < best.d || (d === best.d && p.length > best.len))) best = { i, d, len: p.length };
      });
      if (best) { ing = best.i; how = 'name'; }
    }
    if (ing && !factor) factor = factorFor(l, ing);
    const ingQty = ing && factor ? Math.round(l.qty * factor * 1000) / 1000 : null;
    const unitCost = ingQty ? Math.round((l.amount / ingQty) * 10000) / 10000 : null;
    const usual = ing ? Number(ing.costPerUnit) || 0 : 0;
    return { ...l, ingredientId: ing ? ing.id : '', how, factor, ingQty, unitCost,
      needsCheck: !!ing && (!factor || how === 'name'), costRatio: usual > 0 && unitCost ? Math.round((unitCost / usual) * 100) / 100 : null };
  });
}
