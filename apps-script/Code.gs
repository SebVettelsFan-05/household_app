/**
 * My Fridge — Google Apps Script backend.
 *
 * Postgres (Neon, via Vercel) is now the source of truth. This script's
 * primary job is to serve as a read-only mirror sink:
 *   - doPost handles the `mirror` action: replaces both sheets from a snapshot
 *   - doGet still serves the legacy read API used by the one-time seed import
 *
 * To deploy: open script.google.com → your project → paste this file over
 * Code.gs → Deploy → Manage deployments → pencil/edit on the existing
 * deployment → Version: "New version" → Deploy. The /exec URL stays the same.
 */

const SHEET_NAME = 'Inventory';
const HEADERS = ['ID', 'Name', 'Quantity (g)', 'Expiry Date', 'Added', 'Category'];

const CATEGORIES_SHEET = 'Categories';
const CAT_HEADERS = ['Name'];
const DEFAULT_CATEGORIES = ['Meat', 'Veggies', 'Other'];
const FALLBACK_CATEGORY = 'Other';

let _categoriesCache = null;
function invalidateCategoriesCache_() { _categoriesCache = null; }

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- doPost: mirror writes from Next.js ---------- */

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Bad JSON' });
  }
  const action = body.action || '';
  try {
    if (action === 'mirror') {
      mirrorAll_(body.items || [], body.categories || []);
      return jsonOut_({ ok: true });
    }
    return jsonOut_({ ok: false, error: 'Unknown POST action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message || String(err) });
  }
}

function mirrorAll_(items, categories) {
  // Inventory sheet: drop all data rows, write the snapshot rows.
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
  }
  if (items.length > 0) {
    const rows = items.map(function (it) {
      return [
        it.id || '',
        it.name || '',
        Number(it.quantity) || 0,
        it.expiry ? new Date(it.expiry + 'T00:00:00') : '',
        it.added ? new Date(it.added + 'T00:00:00') : '',
        it.category || FALLBACK_CATEGORY,
      ];
    });
    sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }

  // Categories sheet: same replace-all approach.
  const catSheet = getCategoriesSheet_();
  const catLast = catSheet.getLastRow();
  if (catLast > 1) {
    catSheet.getRange(2, 1, catLast - 1, CAT_HEADERS.length).clearContent();
  }
  if (categories.length > 0) {
    const rows = categories.map(function (name) { return [name]; });
    catSheet.getRange(2, 1, rows.length, CAT_HEADERS.length).setValues(rows);
  }
  invalidateCategoriesCache_();
}

/* ---------- doGet: legacy read API (used by /api/seed) ---------- */

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || 'list';
  let result;
  try {
    switch (action) {
      case 'list':
        result = { ok: true, items: getItems_() };
        break;
      case 'listCategories':
        result = { ok: true, categories: listCategories_() };
        break;
      default:
        result = { ok: false, error: 'Unknown GET action: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: err.message || String(err) };
  }
  return jsonOut_(result);
}

/* ---------- Sheet helpers ---------- */

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    return sheet;
  }
  const currentCols = Math.max(sheet.getLastColumn(), HEADERS.length);
  const headerRow = sheet.getRange(1, 1, 1, currentCols).getValues()[0];
  let needsHeaderUpdate = false;
  for (let i = 0; i < HEADERS.length; i++) {
    if (headerRow[i] !== HEADERS[i]) { needsHeaderUpdate = true; break; }
  }
  if (needsHeaderUpdate) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function getCategoriesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CATEGORIES_SHEET);
  if (sheet) {
    const headerVal = sheet.getRange(1, 1).getValue();
    if (headerVal !== CAT_HEADERS[0]) {
      sheet.getRange(1, 1, 1, CAT_HEADERS.length).setValues([CAT_HEADERS]);
      sheet.getRange(1, 1, 1, CAT_HEADERS.length).setFontWeight('bold');
    }
    return sheet;
  }
  sheet = ss.insertSheet(CATEGORIES_SHEET);
  sheet.getRange(1, 1, 1, CAT_HEADERS.length).setValues([CAT_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, CAT_HEADERS.length).setFontWeight('bold');
  DEFAULT_CATEGORIES.forEach(function (name) { sheet.appendRow([name]); });
  invalidateCategoriesCache_();
  return sheet;
}

function listCategories_() {
  if (_categoriesCache) return _categoriesCache;
  const sheet = getCategoriesSheet_();
  const lastRow = sheet.getLastRow();
  let list = [];
  if (lastRow >= 2) {
    const vals = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    list = vals.map(function (r) { return String(r[0] || '').trim(); }).filter(Boolean);
  }
  if (!list.some(function (c) { return c.toLowerCase() === FALLBACK_CATEGORY.toLowerCase(); })) {
    list.unshift(FALLBACK_CATEGORY);
  }
  _categoriesCache = list;
  return list;
}

function formatDate_(d) {
  if (!d) return '';
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(d), tz, 'yyyy-MM-dd');
}

function getItems_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return data
    .map(function (row) {
      return {
        id: row[0],
        name: row[1],
        quantity: Number(row[2]) || 0,
        expiry: row[3] ? formatDate_(row[3]) : '',
        added: row[4] ? formatDate_(row[4]) : '',
        category: String(row[5] || FALLBACK_CATEGORY).trim() || FALLBACK_CATEGORY,
      };
    })
    .filter(function (item) { return item.id; });
}
