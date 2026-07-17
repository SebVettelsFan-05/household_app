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
const HEADERS = ['ID', 'Name', 'Quantity (g)', 'Expiry Date', 'Added', 'Category', 'Category reviewed'];

const CATEGORIES_SHEET = 'Categories';
const CAT_HEADERS = ['Name', 'Color'];
const DEFAULT_CATEGORIES = ['Meat', 'Veggies', 'Other'];
const FALLBACK_CATEGORY = 'Other';

const GROCERY_SHEET = 'Grocery List';
const GROCERY_HEADERS = ['ID', 'Name', 'Quantity (g)', 'Category', 'Category reviewed', 'Store', 'Added by', 'Done', 'Added'];

const RECIPES_SHEET = 'Recipes';
const RECIPES_HEADERS = ['ID', 'Week start', 'Day', 'Day name', 'Assigned to', 'Name', 'Link', 'Description', 'Ingredients'];
const DAY_NAMES_GS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const FAVORITES_SHEET = 'Favorite Recipes';
const FAVORITES_HEADERS = ['ID', 'Name', 'Link', 'Description', 'Ingredients'];

const EXPENSES_SHEET = 'Expenses';
const EXPENSES_HEADERS = ['ID', 'Name', 'Amount', 'Category', 'Store', 'Paid by', 'Added'];

const EXPENSE_CATS_SHEET = 'Expense Categories';
const EXPENSE_CATS_HEADERS = ['Name', 'Color'];

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
      mirrorAll_(
        body.items || [],
        body.categories || [],
        body.grocery || [],
        body.recipes || [],
        body.favorites || [],
        body.expenses || [],
        body.expenseCategories || []
      );
      return jsonOut_({ ok: true });
    }
    return jsonOut_({ ok: false, error: 'Unknown POST action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message || String(err) });
  }
}

function mirrorAll_(items, categories, grocery, recipes, favorites, expenses, expenseCategories) {
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
        it.categoryReviewed ? 'Yes' : '',
      ];
    });
    sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }

  // Categories sheet: same replace-all approach. Each entry can be either
  // a plain name string (legacy) or {name, color}.
  const catSheet = getCategoriesSheet_();
  const catLast = catSheet.getLastRow();
  if (catLast > 1) {
    catSheet.getRange(2, 1, catLast - 1, CAT_HEADERS.length).clearContent();
  }
  if (categories.length > 0) {
    const rows = categories.map(function (c) {
      if (typeof c === 'string') return [c, ''];
      return [c.name || '', c.color || ''];
    });
    catSheet.getRange(2, 1, rows.length, CAT_HEADERS.length).setValues(rows);
  }
  invalidateCategoriesCache_();

  // Grocery List sheet: same replace-all approach.
  if (Array.isArray(grocery)) {
    const groSheet = getGrocerySheet_();
    const groLast = groSheet.getLastRow();
    if (groLast > 1) {
      groSheet.getRange(2, 1, groLast - 1, GROCERY_HEADERS.length).clearContent();
    }
    if (grocery.length > 0) {
      const rows = grocery.map(function (g) {
        return [
          g.id || '',
          g.name || '',
          Number(g.quantity) || 0,
          g.category || FALLBACK_CATEGORY,
          g.categoryReviewed ? 'Yes' : '',
          g.store || '',
          g.addedBy || '',
          g.done ? 'Yes' : '',
          g.added ? new Date(g.added + 'T00:00:00') : '',
        ];
      });
      groSheet.getRange(2, 1, rows.length, GROCERY_HEADERS.length).setValues(rows);
    }
  }

  // Recipes sheet.
  if (Array.isArray(recipes)) {
    const recSheet = getRecipesSheet_();
    const recLast = recSheet.getLastRow();
    if (recLast > 1) {
      recSheet.getRange(2, 1, recLast - 1, RECIPES_HEADERS.length).clearContent();
    }
    if (recipes.length > 0) {
      const rows = recipes.map(function (r) {
        return [
          r.id || '',
          r.weekStart || '',
          typeof r.day === 'number' ? r.day : '',
          typeof r.day === 'number' && DAY_NAMES_GS[r.day] ? DAY_NAMES_GS[r.day] : '',
          r.assignedTo || '',
          r.name || '',
          r.link || '',
          r.description || '',
          formatIngredients_(r.ingredients),
        ];
      });
      recSheet.getRange(2, 1, rows.length, RECIPES_HEADERS.length).setValues(rows);
    }
  }

  // Favorites sheet.
  if (Array.isArray(favorites)) {
    const favSheet = getFavoritesSheet_();
    const favLast = favSheet.getLastRow();
    if (favLast > 1) {
      favSheet.getRange(2, 1, favLast - 1, FAVORITES_HEADERS.length).clearContent();
    }
    if (favorites.length > 0) {
      const rows = favorites.map(function (f) {
        return [
          f.id || '',
          f.name || '',
          f.link || '',
          f.description || '',
          formatIngredients_(f.ingredients),
        ];
      });
      favSheet.getRange(2, 1, rows.length, FAVORITES_HEADERS.length).setValues(rows);
    }
  }

  // Expenses sheet.
  if (Array.isArray(expenses)) {
    const expSheet = getExpensesSheet_();
    const expLast = expSheet.getLastRow();
    if (expLast > 1) {
      expSheet.getRange(2, 1, expLast - 1, EXPENSES_HEADERS.length).clearContent();
    }
    if (expenses.length > 0) {
      const rows = expenses.map(function (e) {
        return [
          e.id || '',
          e.name || '',
          (Number(e.amountCents) || 0) / 100,
          e.category || 'Misc',
          e.store || '',
          e.paidBy || '',
          e.added ? new Date(e.added + 'T00:00:00') : '',
        ];
      });
      expSheet.getRange(2, 1, rows.length, EXPENSES_HEADERS.length).setValues(rows);
      // Format the Amount column as currency so the sheet reads naturally.
      expSheet.getRange(2, 3, rows.length, 1).setNumberFormat('$#,##0.00');
    }
  }

  // Expense categories sheet.
  if (Array.isArray(expenseCategories)) {
    const ecSheet = getExpenseCatsSheet_();
    const ecLast = ecSheet.getLastRow();
    if (ecLast > 1) {
      ecSheet.getRange(2, 1, ecLast - 1, EXPENSE_CATS_HEADERS.length).clearContent();
    }
    if (expenseCategories.length > 0) {
      const rows = expenseCategories.map(function (c) {
        if (typeof c === 'string') return [c, ''];
        return [c.name || '', c.color || ''];
      });
      ecSheet.getRange(2, 1, rows.length, EXPENSE_CATS_HEADERS.length).setValues(rows);
    }
  }
}

function getExpensesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(EXPENSES_SHEET);
  if (sheet) {
    const cols = Math.max(sheet.getLastColumn(), EXPENSES_HEADERS.length);
    const headerRow = sheet.getRange(1, 1, 1, cols).getValues()[0];
    let needsUpdate = false;
    for (let i = 0; i < EXPENSES_HEADERS.length; i++) {
      if (headerRow[i] !== EXPENSES_HEADERS[i]) { needsUpdate = true; break; }
    }
    if (needsUpdate) {
      sheet.getRange(1, 1, 1, EXPENSES_HEADERS.length).setValues([EXPENSES_HEADERS]);
      sheet.getRange(1, 1, 1, EXPENSES_HEADERS.length).setFontWeight('bold');
    }
    return sheet;
  }
  sheet = ss.insertSheet(EXPENSES_SHEET);
  sheet.getRange(1, 1, 1, EXPENSES_HEADERS.length).setValues([EXPENSES_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, EXPENSES_HEADERS.length).setFontWeight('bold');
  return sheet;
}

function getExpenseCatsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(EXPENSE_CATS_SHEET);
  if (sheet) {
    const cols = Math.max(sheet.getLastColumn(), EXPENSE_CATS_HEADERS.length);
    const headerRow = sheet.getRange(1, 1, 1, cols).getValues()[0];
    let needsUpdate = false;
    for (let i = 0; i < EXPENSE_CATS_HEADERS.length; i++) {
      if (headerRow[i] !== EXPENSE_CATS_HEADERS[i]) { needsUpdate = true; break; }
    }
    if (needsUpdate) {
      sheet.getRange(1, 1, 1, EXPENSE_CATS_HEADERS.length).setValues([EXPENSE_CATS_HEADERS]);
      sheet.getRange(1, 1, 1, EXPENSE_CATS_HEADERS.length).setFontWeight('bold');
    }
    return sheet;
  }
  sheet = ss.insertSheet(EXPENSE_CATS_SHEET);
  sheet.getRange(1, 1, 1, EXPENSE_CATS_HEADERS.length).setValues([EXPENSE_CATS_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, EXPENSE_CATS_HEADERS.length).setFontWeight('bold');
  return sheet;
}

function formatIngredients_(list) {
  if (!Array.isArray(list)) return '';
  return list
    .map(function (i) {
      if (!i || !i.name) return '';
      var qty = Number(i.quantity) || 0;
      var unit = qty >= 1000 ? (qty / 1000) + 'kg' : qty + 'g';
      return i.name + ' (' + unit + ')';
    })
    .filter(Boolean)
    .join(', ');
}

function getRecipesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RECIPES_SHEET);
  if (sheet) {
    const cols = Math.max(sheet.getLastColumn(), RECIPES_HEADERS.length);
    const headerRow = sheet.getRange(1, 1, 1, cols).getValues()[0];
    let needsUpdate = false;
    for (let i = 0; i < RECIPES_HEADERS.length; i++) {
      if (headerRow[i] !== RECIPES_HEADERS[i]) { needsUpdate = true; break; }
    }
    if (needsUpdate) {
      sheet.getRange(1, 1, 1, RECIPES_HEADERS.length).setValues([RECIPES_HEADERS]);
      sheet.getRange(1, 1, 1, RECIPES_HEADERS.length).setFontWeight('bold');
    }
    return sheet;
  }
  sheet = ss.insertSheet(RECIPES_SHEET);
  sheet.getRange(1, 1, 1, RECIPES_HEADERS.length).setValues([RECIPES_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, RECIPES_HEADERS.length).setFontWeight('bold');
  return sheet;
}

function getFavoritesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(FAVORITES_SHEET);
  if (sheet) {
    const cols = Math.max(sheet.getLastColumn(), FAVORITES_HEADERS.length);
    const headerRow = sheet.getRange(1, 1, 1, cols).getValues()[0];
    let needsUpdate = false;
    for (let i = 0; i < FAVORITES_HEADERS.length; i++) {
      if (headerRow[i] !== FAVORITES_HEADERS[i]) { needsUpdate = true; break; }
    }
    if (needsUpdate) {
      sheet.getRange(1, 1, 1, FAVORITES_HEADERS.length).setValues([FAVORITES_HEADERS]);
      sheet.getRange(1, 1, 1, FAVORITES_HEADERS.length).setFontWeight('bold');
    }
    return sheet;
  }
  sheet = ss.insertSheet(FAVORITES_SHEET);
  sheet.getRange(1, 1, 1, FAVORITES_HEADERS.length).setValues([FAVORITES_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, FAVORITES_HEADERS.length).setFontWeight('bold');
  return sheet;
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
    // Ensure both headers are present (auto-migrate single-column sheets).
    const cols = Math.max(sheet.getLastColumn(), CAT_HEADERS.length);
    const headerRow = sheet.getRange(1, 1, 1, cols).getValues()[0];
    let needsUpdate = false;
    for (let i = 0; i < CAT_HEADERS.length; i++) {
      if (headerRow[i] !== CAT_HEADERS[i]) { needsUpdate = true; break; }
    }
    if (needsUpdate) {
      sheet.getRange(1, 1, 1, CAT_HEADERS.length).setValues([CAT_HEADERS]);
      sheet.getRange(1, 1, 1, CAT_HEADERS.length).setFontWeight('bold');
    }
    return sheet;
  }
  sheet = ss.insertSheet(CATEGORIES_SHEET);
  sheet.getRange(1, 1, 1, CAT_HEADERS.length).setValues([CAT_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, CAT_HEADERS.length).setFontWeight('bold');
  DEFAULT_CATEGORIES.forEach(function (name) { sheet.appendRow([name, '']); });
  invalidateCategoriesCache_();
  return sheet;
}

function getGrocerySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(GROCERY_SHEET);
  if (sheet) {
    const cols = Math.max(sheet.getLastColumn(), GROCERY_HEADERS.length);
    const headerRow = sheet.getRange(1, 1, 1, cols).getValues()[0];
    let needsUpdate = false;
    for (let i = 0; i < GROCERY_HEADERS.length; i++) {
      if (headerRow[i] !== GROCERY_HEADERS[i]) { needsUpdate = true; break; }
    }
    if (needsUpdate) {
      sheet.getRange(1, 1, 1, GROCERY_HEADERS.length).setValues([GROCERY_HEADERS]);
      sheet.getRange(1, 1, 1, GROCERY_HEADERS.length).setFontWeight('bold');
    }
    return sheet;
  }
  sheet = ss.insertSheet(GROCERY_SHEET);
  sheet.getRange(1, 1, 1, GROCERY_HEADERS.length).setValues([GROCERY_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, GROCERY_HEADERS.length).setFontWeight('bold');
  return sheet;
}

function listCategories_() {
  if (_categoriesCache) return _categoriesCache;
  const sheet = getCategoriesSheet_();
  const lastRow = sheet.getLastRow();
  let list = [];
  if (lastRow >= 2) {
    const vals = sheet.getRange(2, 1, lastRow - 1, CAT_HEADERS.length).getValues();
    list = vals
      .map(function (r) {
        return { name: String(r[0] || '').trim(), color: String(r[1] || '').trim() };
      })
      .filter(function (c) { return c.name; });
  }
  if (!list.some(function (c) { return c.name.toLowerCase() === FALLBACK_CATEGORY.toLowerCase(); })) {
    list.unshift({ name: FALLBACK_CATEGORY, color: '' });
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
        categoryReviewed: String(row[6] || '').toLowerCase() === 'yes',
      };
    })
    .filter(function (item) { return item.id; });
}
