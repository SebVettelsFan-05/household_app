/**
 * My Fridge — Google Apps Script backend (JSON API)
 * Acts as an API consumed by the Next.js frontend.
 *
 * To deploy: open script.google.com → your project → paste this file
 * over Code.gs → Deploy → Manage deployments → edit (pencil) → Version:
 * "New version" → Deploy. The /exec URL stays the same.
 */

const SHEET_NAME = 'Inventory';
const HEADERS = ['ID', 'Name', 'Quantity (g)', 'Expiry Date', 'Added', 'Category'];

const CATEGORIES_SHEET = 'Categories';
const CAT_HEADERS = ['Name'];
const DEFAULT_CATEGORIES = ['Meat', 'Veggies', 'Other'];
const FALLBACK_CATEGORY = 'Other';

// Per-request memo so getItems_ doesn't re-read the Categories sheet per row.
let _categoriesCache = null;
function invalidateCategoriesCache_() { _categoriesCache = null; }

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || 'list';
  let result;
  try {
    switch (action) {
      case 'list':
        result = { ok: true, items: getItems_() };
        break;
      case 'add':
        result = addItem_(params.name, params.quantity, params.expiry, params.category);
        break;
      case 'update':
        result = { ok: true, items: updateItem_(params.id, params.name, params.quantity, params.expiry, params.category) };
        break;
      case 'delete':
        result = { ok: true, items: deleteItem_(params.id) };
        break;
      case 'listCategories':
        result = { ok: true, categories: listCategories_() };
        break;
      case 'addCategory':
        result = addCategory_(params.name);
        break;
      case 'deleteCategory':
        result = deleteCategory_(params.name);
        break;
      default:
        result = { ok: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: err.message || String(err) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Inventory sheet ---------- */

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
  const lastRow = sheet.getLastRow();
  const catCol = HEADERS.indexOf('Category') + 1;
  if (lastRow > 1) {
    const range = sheet.getRange(2, catCol, lastRow - 1, 1);
    const vals = range.getValues();
    let dirty = false;
    for (let i = 0; i < vals.length; i++) {
      if (!vals[i][0]) { vals[i][0] = FALLBACK_CATEGORY; dirty = true; }
    }
    if (dirty) range.setValues(vals);
  }
  return sheet;
}

/* ---------- Categories sheet ---------- */

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
  // First-time creation: seed defaults
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
  // Defensive: always keep the fallback available even if someone deletes it
  // directly in the sheet — otherwise normalizeCategory_ would have nowhere to fall back.
  if (!list.some(function (c) { return c.toLowerCase() === FALLBACK_CATEGORY.toLowerCase(); })) {
    list.unshift(FALLBACK_CATEGORY);
  }
  _categoriesCache = list;
  return list;
}

function addCategory_(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Name required');
  if (trimmed.length > 32) throw new Error('Name is too long');
  const sheet = getCategoriesSheet_();
  const existing = listCategories_();
  if (existing.some(function (e) { return e.toLowerCase() === trimmed.toLowerCase(); })) {
    return { ok: true, categories: existing, existed: true };
  }
  sheet.appendRow([trimmed]);
  invalidateCategoriesCache_();
  return { ok: true, categories: listCategories_() };
}

function deleteCategory_(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Name required');
  if (trimmed.toLowerCase() === FALLBACK_CATEGORY.toLowerCase()) {
    throw new Error('Cannot delete the fallback category "' + FALLBACK_CATEGORY + '"');
  }
  const sheet = getCategoriesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const vals = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).toLowerCase() === trimmed.toLowerCase()) {
        sheet.deleteRow(i + 2);
        break;
      }
    }
  }
  invalidateCategoriesCache_();

  // Reassign any items that used this category to the fallback.
  let reassigned = 0;
  const itemSheet = getSheet_();
  const ilast = itemSheet.getLastRow();
  if (ilast > 1) {
    const catCol = HEADERS.indexOf('Category') + 1;
    const range = itemSheet.getRange(2, catCol, ilast - 1, 1);
    const cvals = range.getValues();
    let dirty = false;
    for (let i = 0; i < cvals.length; i++) {
      if (String(cvals[i][0]).toLowerCase() === trimmed.toLowerCase()) {
        cvals[i][0] = FALLBACK_CATEGORY;
        dirty = true;
        reassigned++;
      }
    }
    if (dirty) range.setValues(cvals);
  }

  return {
    ok: true,
    categories: listCategories_(),
    items: getItems_(),
    reassigned: reassigned
  };
}

/* ---------- Helpers ---------- */

function normalizeName_(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizeCategory_(c) {
  const s = String(c || '').trim();
  if (!s) return FALLBACK_CATEGORY;
  const list = listCategories_();
  const match = list.find(function (v) { return v.toLowerCase() === s.toLowerCase(); });
  return match || FALLBACK_CATEGORY;
}

function formatDate_(d) {
  if (!d) return '';
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(d), tz, 'yyyy-MM-dd');
}

/* ---------- Items CRUD ---------- */

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
        category: normalizeCategory_(row[5])
      };
    })
    .filter(function (item) { return item.id; });
}

function addItem_(name, quantity, expiry, category) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Name required');
  const qty = Number(quantity);
  if (!qty || qty <= 0) throw new Error('Quantity must be greater than zero');

  const items = getItems_();
  const normNew = normalizeName_(trimmedName);
  const existing = items.find(function (it) { return normalizeName_(it.name) === normNew; });

  if (existing) {
    let mergedExpiry = existing.expiry;
    if (expiry) {
      if (!existing.expiry || expiry < existing.expiry) {
        mergedExpiry = expiry;
      }
    }
    const updated = updateItem_(
      existing.id,
      existing.name,
      existing.quantity + qty,
      mergedExpiry,
      existing.category
    );
    return { ok: true, items: updated, merged: true, mergedInto: existing.name, addedQty: qty };
  }

  const sheet = getSheet_();
  const id = Utilities.getUuid();
  const expiryVal = expiry ? new Date(expiry + 'T00:00:00') : '';
  sheet.appendRow([
    id, trimmedName, qty, expiryVal, new Date(), normalizeCategory_(category)
  ]);
  return { ok: true, items: getItems_(), merged: false };
}

function updateItem_(id, name, quantity, expiry, category) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return getItems_();
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) {
      const rowNum = i + 2;
      const expiryVal = expiry ? new Date(expiry + 'T00:00:00') : '';
      sheet.getRange(rowNum, 2, 1, 3).setValues([[String(name).trim(), Number(quantity) || 0, expiryVal]]);
      sheet.getRange(rowNum, 6).setValue(normalizeCategory_(category));
      break;
    }
  }
  return getItems_();
}

function deleteItem_(id) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return getItems_();
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) {
      sheet.deleteRow(i + 2);
      break;
    }
  }
  return getItems_();
}
