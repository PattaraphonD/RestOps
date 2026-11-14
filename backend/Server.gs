/**
 * Restaurant Ops — Google Apps Script web API.
 *
 * The phone app never talks to Google Sheets directly. It POSTs JSON to this script's
 * web-app URL; this script checks the user's session, takes a lock for every write, and
 * reads/writes the spreadsheet. All business rules live in Core.gs (shared with the app).
 *
 * First-time setup: open the spreadsheet → Extensions → Apps Script, add Core.gs and this
 * file, then run `setup` once from the editor (see README.md).
 */

/** Leave empty when this script is bound to the spreadsheet (Extensions → Apps Script). */
var SPREADSHEET_ID = '';

/* --------------------------------------------------------------- web entry */

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e && e.postData ? e.postData.contents : '{}');
  } catch (err) {
    return json_({ ok: false, error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON.' } });
  }
  return json_(api_().handle(req));
}

function doGet() {
  return json_({ ok: true, data: { service: 'Restaurant Ops API', version: RestoCore.VERSION } });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function api_() {
  return RestoCore.createApi({
    db: sheetDb_(),
    sessions: sessions_(),
    uuid: function () { return Utilities.getUuid(); },
    now: function () { return new Date(); }
  });
}

/* ------------------------------------------------------- spreadsheet store */

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheetDb_() {
  var ss = ss_();
  var tz = ss.getSpreadsheetTimeZone();
  var cache = {};

  var checked = {};
  function sheet(table) {
    var sh = ss.getSheetByName(table);
    // New tabs and new columns (added in later versions) are created on first use.
    if (!sh || (!checked[table] && sh.getLastColumn() < RestoCore.SCHEMA[table].length)) sh = prepareTab_(ss, table);
    checked[table] = true;
    return sh;
  }

  function normalize(col, v) {
    if (v instanceof Date) {
      return col === 'date' || /Date$/.test(col) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
    }
    return v;
  }

  function load(table) {
    if (cache[table]) return cache[table];
    var sh = sheet(table);
    var cols = RestoCore.SCHEMA[table];
    var last = sh.getLastRow();
    var rows = [];
    if (last > 1) {
      var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
      for (var i = 0; i < values.length; i++) {
        var o = { __row: i + 2 };
        var empty = true;
        for (var j = 0; j < cols.length; j++) {
          o[cols[j]] = normalize(cols[j], values[i][j]);
          if (values[i][j] !== '') empty = false;
        }
        if (!empty) rows.push(o);
      }
    }
    cache[table] = { sheet: sh, cols: cols, rows: rows };
    return cache[table];
  }

  function toValues(cols, o) {
    return cols.map(function (c) { return o[c] === undefined || o[c] === null ? '' : o[c]; });
  }

  function strip(o) {
    var c = {};
    for (var k in o) if (k !== '__row') c[k] = o[k];
    return c;
  }

  return {
    read: function (table) { return load(table).rows.map(strip); },

    append: function (table, objs) {
      if (!objs.length) return;
      var t = load(table);
      var start = t.sheet.getLastRow() + 1;
      t.sheet.getRange(start, 1, objs.length, t.cols.length).setValues(objs.map(function (o) { return toValues(t.cols, o); }));
      objs.forEach(function (o, i) { var c = strip(o); c.__row = start + i; t.rows.push(c); });
    },

    updateWhere: function (table, pred, patch) {
      var t = load(table), n = 0;
      t.rows.forEach(function (r) {
        if (!pred(strip(r))) return;
        for (var k in patch) r[k] = patch[k];
        t.sheet.getRange(r.__row, 1, 1, t.cols.length).setValues([toValues(t.cols, r)]);
        n++;
      });
      return n;
    },

    removeWhere: function (table, pred) {
      var t = load(table);
      var doomed = t.rows.filter(function (r) { return pred(strip(r)); })
        .map(function (r) { return r.__row; }).sort(function (a, b) { return b - a; });
      doomed.forEach(function (row) { t.sheet.deleteRow(row); });
      if (doomed.length) delete cache[table];
      return doomed.length;
    },

    lock: function (fn) {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) {
        throw { code: 'BUSY', message: 'The system is busy saving someone else\'s entry. Please try again.' };
      }
      try {
        cache = {};               // always read fresh data inside the lock
        var result = fn();
        SpreadsheetApp.flush();
        return result;
      } finally {
        lock.releaseLock();
      }
    }
  };
}

/* ---------------------------------------------------------------- sessions */

function sessions_() {
  var cache = CacheService.getScriptCache();
  return {
    get: function (key) { return cache.get(key); },
    put: function (key, value, ttl) { cache.put(key, String(value), Math.min(ttl, 21600)); },
    remove: function (key) { cache.remove(key); }
  };
}

/* ------------------------------------------------------------------- setup */

/**
 * Run once from the Apps Script editor (select "setup" → Run).
 * Creates every tab with its header row, default settings and the first owner account.
 * The owner's temporary password is shown in the execution log. Safe to run again.
 */
function setup() { return setup_('th'); }

/** Same as setup(), but fills Settings with Thai channel, category and unit lists. */
function setupThai() { return setup_('th'); }

/**
 * Creates a tab, or upgrades it in place: new columns are only ever appended at the end,
 * so an older sheet keeps all its data. Refuses to touch a tab whose headers don't match.
 */
function prepareTab_(ss, table) {
  var cols = RestoCore.SCHEMA[table];
  var sh = ss.getSheetByName(table);
  if (!sh) {
    try { sh = ss.insertSheet(table); } catch (e) { sh = ss.getSheetByName(table); } // created by a parallel request
  }
  if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
  var header = sh.getRange(1, 1, 1, cols.length);
  var existing = header.getValues()[0];
  var used = existing.filter(function (v) { return v !== ''; }).length;
  for (var i = 0; i < used; i++) {
    if (existing[i] !== cols[i]) {
      throw new Error('Tab "' + table + '" has different headers (column ' + (i + 1) + ' is "' + existing[i] +
        '", expected "' + cols[i] + '"). Rename that tab and run setup() again.');
    }
  }
  header.setValues([cols]).setFontWeight('bold').setBackground('#1f3b2d').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  // Keep ids, dates and references as plain text so Sheets does not reformat them.
  cols.forEach(function (c, i) {
    if (i >= used && RestoCore.TEXT_COLUMNS.indexOf(c) >= 0 && sh.getMaxRows() > 1) {
      sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    }
  });
  if (sh.getMaxColumns() > cols.length) sh.deleteColumns(cols.length + 1, sh.getMaxColumns() - cols.length);
  return sh;
}

function setup_(lang) {
  var ss = ss_();
  Object.keys(RestoCore.SCHEMA).forEach(function (table) { prepareTab_(ss, table); });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  var password = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  var result = api_().initialize({ ownerUsername: 'owner', ownerPassword: password,
    ownerName: lang === 'th' ? 'เจ้าของร้าน' : 'Owner', restaurantName: ss.getName(), lang: lang });

  var msg = result.ownerCreated
    ? 'Setup complete / ตั้งค่าเสร็จแล้ว\n\nSign in to the app with / เข้าสู่ระบบด้วย:\n  Username: owner\n  Password: ' + password +
      '\n\nChange this password in the app (More → My account).\nเปลี่ยนรหัสผ่านนี้ในแอป (เพิ่มเติม → บัญชีของฉัน)'
    : 'Setup complete. Tabs are up to date; an owner account already exists.\nตั้งค่าเสร็จแล้ว แท็บเป็นปัจจุบัน และมีบัญชีเจ้าของร้านอยู่แล้ว';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* not opened from the sheet UI */ }
  return msg;
}

/** Owner locked out? Run this from the editor to set a new temporary owner password. */
function resetOwnerPassword() {
  var db = sheetDb_();
  var owner = db.read('Users').filter(function (u) { return u.role === 'owner'; })[0];
  if (!owner) throw new Error('No owner found. Run setup().');
  var password = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  var salt = Utilities.getUuid().replace(/-/g, '');
  db.lock(function () {
    db.updateWhere('Users', function (u) { return u.id === owner.id; },
      { salt: salt, passwordHash: RestoCore.hashPassword(password, salt), active: true });
  });
  Logger.log('New password for "' + owner.username + '": ' + password);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Restaurant Ops')
    .addItem('Set up / repair tabs', 'setup')
    .addItem('ตั้งค่า / ซ่อมแท็บ (ภาษาไทย)', 'setupThai')
    .addToUi();
}
