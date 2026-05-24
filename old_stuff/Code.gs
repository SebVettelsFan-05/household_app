/**
 * My Fridge — Google Apps Script backend (JSON API)
 * Acts as an API consumed by a static frontend (e.g. GitHub Pages).
 */

const SHEET_NAME = 'Inventory';
const HEADERS = ['ID', 'Name', 'Quantity (g)', 'Expiry Date', 'Added', 'Category'];
const VALID_CATEGORIES = ['Meat', 'Veggies', 'Other'];

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
  // Migration: ensure headers match
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
  // Backfill missing categories
  const lastRow = sheet.getLastRow();
  const catCol = HEADERS.indexOf('Category') + 1;
  if (lastRow > 1) {
    const range = sheet.getRange(2, catCol, lastRow - 1, 1);
    const vals = range.getValues();
    let dirty = false;
    for (let i = 0; i < vals.length; i++) {
      if (!vals[i][0]) { vals[i][0] = 'Other'; dirty = true; }
    }
    if (dirty) range.setValues(vals);
  }
  return sheet;
}

function normalizeName_(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizeCategory_(c) {
  const s = String(c || '').trim();
  if (!s) return 'Other';
  const match = VALID_CATEGORIES.find(v => v.toLowerCase() === s.toLowerCase());
  return match || 'Other';
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
    .map(row => ({
      id: row[0],
      name: row[1],
      quantity: Number(row[2]) || 0,
      expiry: row[3] ? formatDate_(row[3]) : '',
      added: row[4] ? formatDate_(row[4]) : '',
      category: normalizeCategory_(row[5])
    }))
    .filter(item => item.id);
}

/**
 * Add an item with smart merging: if an item with the same normalized name
 * already exists, increment its quantity and keep the earlier expiry.
 */
function addItem_(name, quantity, expiry, category) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Name required');
  const qty = Number(quantity);
  if (!qty || qty <= 0) throw new Error('Quantity must be greater than zero');

  const items = getItems_();
  const normNew = normalizeName_(trimmedName);
  const existing = items.find(it => normalizeName_(it.name) === normNew);

  if (existing) {
    // Pick the earlier expiry (so reminders fire on the oldest stock)
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

  // No match → new row
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
