import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db, type Db } from "@/db/client";
import {
  categories as categoriesTable,
  expenseCategories as expenseCategoriesTable,
  expenses as expensesTable,
  favoriteRecipes as favoritesTable,
  groceryItems as groceryTable,
  householdSettings as settingsTable,
  items as itemsTable,
  recipes as recipesTable,
  sharedAccounts as sharedAccountsTable,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import { thisWeekStart, nextWeekStart, todayYmd } from "./dates";
import type {
  CategoryDef,
  Expense,
  ExpenseAllocation,
  ExpenseCategoryDef,
  FavoriteRecipe,
  GroceryItem,
  GroceryPool,
  Item,
  MealGroup,
  Recipe,
  RecipeIngredient,
  SharedAccount,
  SharedAccountField,
  SharedFieldKind,
} from "./types";
import { BUYERS, GROCERY_POOLS, MEAL_GROUP_KEY, isBuyer } from "./types";
import {
  allocationsFromStored,
  normalizeAllocations,
  type ResolveContext,
} from "./allocations";
import { NotFoundError, ValidationError } from "./errors";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  EXPENSE_FALLBACK,
  FALLBACK_CATEGORY,
  MAINSTAY_CATEGORIES,
  formatDate,
  isProtectedCategory,
  mergeAddedBy,
  normalizeName,
  pickCategory,
  sortCategories,
  titleCaseName,
} from "./normalize";

/**
 * Runs a group of statements as one all-or-nothing unit, on either driver.
 *
 *   - neon-http exposes `batch`, which the server runs inside a single
 *     transaction; there is no interactive transaction to open.
 *   - node-postgres (local dev, smoke tests) has no `batch`, so a real
 *     transaction is opened instead.
 *
 * `build` receives the handle the statements must be bound to rather than
 * returning a prebuilt list: a query built on `db` executes on its own
 * connection from the pool and would land *outside* the transaction.
 *
 * `database` defaults to the real handle; tests pass a fake so both branches
 * can be exercised on one machine (local dev only ever hits `transaction`).
 */
export async function runWritesAtomically(
  build: (tx: Db) => BatchItem<"pg">[],
  database: Db = db
): Promise<void> {
  const batchable = database as unknown as {
    batch?: (items: [BatchItem<"pg">, ...BatchItem<"pg">[]]) => Promise<unknown>;
  };
  if (typeof batchable.batch === "function") {
    const writes = build(database);
    if (writes.length === 0) return;
    await batchable.batch(writes as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
    return;
  }
  await database.transaction(async (tx) => {
    for (const write of build(tx)) await write;
  });
}

function rowToItem(r: typeof itemsTable.$inferSelect): Item {
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    expiry: r.expiry || "",
    added: formatDate(r.added),
    category: r.category,
    categoryReviewed: r.categoryReviewed,
    owner: r.owner || "",
  };
}

/**
 * "" (shared) or one of the household members. Anything else is rejected.
 * The UI no longer sets an owner — the column is dormant, see
 * docs/SHARED_KITCHEN.md — but the API still accepts one.
 */
function validateOwner(input: string | undefined): string {
  const owner = String(input ?? "").trim();
  if (!owner) return "";
  if (!isBuyer(owner)) throw new ValidationError(`Unknown household member: ${owner}`);
  return owner;
}

/** Dormant like `owner`: stored, never used to scope anything. */
function validatePool(input: string | undefined): GroceryPool {
  const pool = String(input ?? "").trim() || "house";
  if (!(GROCERY_POOLS as readonly string[]).includes(pool)) {
    throw new ValidationError(`Pool must be one of ${GROCERY_POOLS.join(", ")}`);
  }
  return pool as GroceryPool;
}

function rowToCategory(r: typeof categoriesTable.$inferSelect): CategoryDef {
  return { name: r.name, color: r.color ?? null };
}

function requireValidCategory(input: string | undefined, validCats: string[]) {
  const requested = String(input ?? "").trim();
  const match = validCats.find(
    (category) => category.toLowerCase() === requested.toLowerCase()
  );
  if (!match) throw new ValidationError("Choose a valid category");
  return match;
}

const MAX_POSTGRES_INTEGER = 2_147_483_647;

function requirePositiveIntegerQuantity(
  input: number,
  label = "Quantity"
): number {
  const quantity = Number(input);
  if (
    !Number.isFinite(quantity) ||
    !Number.isInteger(quantity) ||
    quantity <= 0 ||
    quantity > MAX_POSTGRES_INTEGER
  ) {
    throw new ValidationError(
      `${label} must be a whole number between 1 and ${MAX_POSTGRES_INTEGER}`
    );
  }
  return quantity;
}

/**
 * Adding two quantities that are each individually legal can still land past
 * int4: Postgres answers that with a 22003 the user only sees as an opaque
 * 500, after the rest of the statement has already been decided. Every place
 * two stored quantities are merged goes through here first, so the overflow
 * is a 400 the user can act on.
 */
function requireMergedQuantity(a: number, b: number, label?: string): number {
  const total = a + b;
  if (total > MAX_POSTGRES_INTEGER) {
    throw new ValidationError(
      label
        ? `Quantity for "${label}" would exceed the maximum`
        : "Quantity would exceed the maximum"
    );
  }
  return total;
}

/* ---------- Shared input validation ---------- */

// Free-text ceilings. Postgres would happily take far more, but a novel
// pasted into a "name" field is never intentional and it wrecks every list
// view that has to render it.
const MAX_NAME_LEN = 120;
const MAX_STORE_LEN = 80;
const MAX_DESCRIPTION_LEN = 500;
const MAX_RECIPE_NAME_LEN = 160;
const MAX_LINK_LEN = 2000;
const MAX_CATEGORY_LEN = 32;

/**
 * Postgres text columns cannot hold U+0000 at all — handing one over raises
 * SQLSTATE 22021, which surfaces as an opaque 500 — and the rest of the C0
 * controls only ever arrive from a bad paste. Both are dropped before the
 * string is measured, so the length limits describe what actually gets
 * stored. Tab and newline are real content in a description, so they stay.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

/** Required free text: a real string, non-empty after trimming, capped. */
function requireText(value: unknown, label: string, maxLen: number): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${label} must be text`);
  }
  const trimmed = stripControlChars(value).trim();
  if (!trimmed) throw new ValidationError(`${label} required`);
  if (trimmed.length > maxLen) {
    throw new ValidationError(`${label} is too long (max ${maxLen} characters)`);
  }
  return trimmed;
}

/** Optional free text: missing becomes "", non-strings are still rejected. */
function optionalText(value: unknown, label: string, maxLen: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new ValidationError(`${label} must be text`);
  }
  const trimmed = stripControlChars(value).trim();
  if (trimmed.length > maxLen) {
    throw new ValidationError(`${label} is too long (max ${maxLen} characters)`);
  }
  return trimmed;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every row id is a UUID. Handing Postgres anything else raises a cast error
 * (SQLSTATE 22P02) that would surface as a 500 with SQL in it, so the shape
 * is checked here, before the query is built.
 */
function requireId(value: unknown, label = "id"): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new ValidationError(`${label} required`);
  if (!UUID_RE.test(s)) throw new ValidationError(`${label} is not valid`);
  return s;
}

/** A real calendar date written YYYY-MM-DD. "2026-02-31" is rejected. */
function requireDate(value: unknown, label: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ValidationError(`${label} must be YYYY-MM-DD`);
  }
  const [y, m, d] = s.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() + 1 !== m ||
    probe.getUTCDate() !== d
  ) {
    throw new ValidationError(`${label} is not a real date`);
  }
  return s;
}

function shouldReplaceStoredCategory(
  existingCategory: string,
  existingReviewed: boolean,
  incomingCategory: string,
  incomingReviewed: boolean,
  validCats: string[]
): boolean {
  if (incomingReviewed) return true;
  const existingIsValid = validCats.some(
    (valid) => valid.toLowerCase() === existingCategory.toLowerCase()
  );
  if (!existingIsValid) return true;

  // Automatic suggestions may upgrade an unreviewed fallback, but never
  // erase a useful historical category or downgrade it to Other. Explicit
  // review remains the correction path for legacy non-fallback rows.
  return (
    !existingReviewed &&
    existingCategory.toLowerCase() === FALLBACK_CATEGORY.toLowerCase() &&
    incomingCategory.toLowerCase() !== FALLBACK_CATEGORY.toLowerCase()
  );
}

/* ---------- Categories ---------- */

export async function ensureDefaultCategories(): Promise<void> {
  await db
    .insert(categoriesTable)
    .values(DEFAULT_CATEGORIES.map((name) => ({ name })))
    .onConflictDoNothing();
}

export async function listCategoriesRepo(): Promise<CategoryDef[]> {
  const rows = await db.select().from(categoriesTable);
  if (rows.length === 0) {
    await ensureDefaultCategories();
    return sortCategories(
      DEFAULT_CATEGORIES.map((name) => ({ name, color: null }))
    );
  }
  const list = rows.map(rowToCategory);
  // Defensive: ensure mainstays + fallback are always present, even on older
  // databases that predate them or if someone deleted one directly in the DB.
  const required = [...MAINSTAY_CATEGORIES, FALLBACK_CATEGORY];
  const missing = required.filter(
    (r) => !list.some((c) => c.name.toLowerCase() === r.toLowerCase())
  );
  if (missing.length > 0) {
    await db
      .insert(categoriesTable)
      .values(missing.map((name) => ({ name })))
      .onConflictDoNothing();
    for (const m of missing) list.push({ name: m, color: null });
  }
  return sortCategories(list);
}

function validateColor(color: string | undefined | null): string | null {
  if (color === undefined || color === null || color === "") return null;
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new ValidationError("Color must be a 6-digit hex like #RRGGBB");
  }
  return color.toLowerCase();
}

export async function addCategoryRepo(
  name: string,
  color?: string | null
): Promise<{ categories: CategoryDef[]; existed: boolean }> {
  const trimmed = requireText(name, "Name", MAX_CATEGORY_LEN);
  const validatedColor = validateColor(color);

  const existing = await listCategoriesRepo();
  if (existing.some((e) => e.name.toLowerCase() === trimmed.toLowerCase())) {
    return { categories: existing, existed: true };
  }
  await db
    .insert(categoriesTable)
    .values({ name: trimmed, color: validatedColor })
    .onConflictDoNothing();
  const categories = await listCategoriesRepo();
  return { categories, existed: false };
}

export async function updateCategoryColorRepo(
  name: string,
  color: string | null
): Promise<CategoryDef[]> {
  const trimmed = requireText(name, "Name", MAX_CATEGORY_LEN);
  const validatedColor = validateColor(color);
  await db
    .update(categoriesTable)
    .set({ color: validatedColor })
    .where(eq(categoriesTable.name, trimmed));
  return listCategoriesRepo();
}

/** Everything that still names a category, so a delete can be described. */
export type CategoryUsage = {
  items: number;
  grocery: number;
  recipeIngredients: number;
  favoriteIngredients: number;
};

export function totalCategoryUsage(usage: CategoryUsage): number {
  return (
    usage.items +
    usage.grocery +
    usage.recipeIngredients +
    usage.favoriteIngredients
  );
}

type CategoryReassignPlan = {
  usage: CategoryUsage;
  itemIds: string[];
  groceryIds: string[];
  recipes: Array<{ id: string; ingredients: RecipeIngredient[] }>;
  favorites: Array<{ id: string; ingredients: RecipeIngredient[] }>;
};

/** The matching entries, rewritten onto the fallback and back for review. */
function reassignIngredients(
  raw: unknown,
  lowerName: string
): { ingredients: RecipeIngredient[]; moved: number } | null {
  const current: RecipeIngredient[] = Array.isArray(raw) ? raw : [];
  let moved = 0;
  const ingredients = current.map((ing) => {
    if (String(ing?.category ?? "").toLowerCase() !== lowerName) return ing;
    moved += 1;
    return { ...ing, category: FALLBACK_CATEGORY, categoryReviewed: false };
  });
  return moved === 0 ? null : { ingredients, moved };
}

/**
 * Every row that would have to move if `name` were deleted.
 *
 * Deleting a category used to reassign inventory only, so a grocery row or a
 * recipe ingredient kept a category name that no longer existed — the pill
 * rendered with no color, the row sorted into a group the filters don't
 * offer, and nothing in the UI could fix it. The same plan backs the
 * pre-confirm count, so the dialog promises exactly what the delete does.
 */
async function planCategoryReassign(
  name: string
): Promise<CategoryReassignPlan> {
  const lower = name.toLowerCase();
  const [itemRows, groceryRows, recipeRows, favoriteRows] = await Promise.all([
    db.select({ id: itemsTable.id, category: itemsTable.category }).from(itemsTable),
    db
      .select({ id: groceryTable.id, category: groceryTable.category })
      .from(groceryTable),
    db
      .select({ id: recipesTable.id, ingredients: recipesTable.ingredients })
      .from(recipesTable),
    db
      .select({ id: favoritesTable.id, ingredients: favoritesTable.ingredients })
      .from(favoritesTable),
  ]);

  const itemIds = itemRows
    .filter((r) => r.category.toLowerCase() === lower)
    .map((r) => r.id);
  const groceryIds = groceryRows
    .filter((r) => r.category.toLowerCase() === lower)
    .map((r) => r.id);

  const recipes: CategoryReassignPlan["recipes"] = [];
  let recipeIngredients = 0;
  for (const row of recipeRows) {
    const next = reassignIngredients(row.ingredients, lower);
    if (!next) continue;
    recipes.push({ id: row.id, ingredients: next.ingredients });
    recipeIngredients += next.moved;
  }

  const favorites: CategoryReassignPlan["favorites"] = [];
  let favoriteIngredients = 0;
  for (const row of favoriteRows) {
    const next = reassignIngredients(row.ingredients, lower);
    if (!next) continue;
    favorites.push({ id: row.id, ingredients: next.ingredients });
    favoriteIngredients += next.moved;
  }

  return {
    usage: {
      items: itemIds.length,
      grocery: groceryIds.length,
      recipeIngredients,
      favoriteIngredients,
    },
    itemIds,
    groceryIds,
    recipes,
    favorites,
  };
}

/** Read-only: what a delete of `name` would move, for the confirm dialog. */
export async function categoryUsageRepo(name: string): Promise<CategoryUsage> {
  const trimmed = requireText(name, "Name", MAX_CATEGORY_LEN);
  const plan = await planCategoryReassign(trimmed);
  return plan.usage;
}

export async function deleteCategoryRepo(name: string): Promise<{
  categories: CategoryDef[];
  items: Item[];
  reassigned: number;
  usage: CategoryUsage;
}> {
  const trimmed = requireText(name, "Name", MAX_CATEGORY_LEN);
  if (isProtectedCategory(trimmed)) {
    throw new ValidationError(`Cannot delete the default category "${trimmed}"`);
  }

  const plan = await planCategoryReassign(trimmed);

  // The reassignments and the delete go out as one unit: a half-applied
  // delete is exactly the dangling-name state this is meant to prevent.
  const reassign = { category: FALLBACK_CATEGORY, categoryReviewed: false };
  await runWritesAtomically((tx) => {
    const writes: BatchItem<"pg">[] = [];
    if (plan.itemIds.length > 0) {
      writes.push(
        tx
          .update(itemsTable)
          .set(reassign)
          .where(inArray(itemsTable.id, plan.itemIds))
      );
    }
    if (plan.groceryIds.length > 0) {
      writes.push(
        tx
          .update(groceryTable)
          .set(reassign)
          .where(inArray(groceryTable.id, plan.groceryIds))
      );
    }
    for (const r of plan.recipes) {
      writes.push(
        tx
          .update(recipesTable)
          .set({ ingredients: r.ingredients })
          .where(eq(recipesTable.id, r.id))
      );
    }
    for (const f of plan.favorites) {
      writes.push(
        tx
          .update(favoritesTable)
          .set({ ingredients: f.ingredients })
          .where(eq(favoritesTable.id, f.id))
      );
    }
    writes.push(tx.delete(categoriesTable).where(eq(categoriesTable.name, trimmed)));
    return writes;
  });

  const [categories, items] = await Promise.all([
    listCategoriesRepo(),
    listItemsRepo(),
  ]);
  return {
    categories,
    items,
    reassigned: totalCategoryUsage(plan.usage),
    usage: plan.usage,
  };
}

/* ---------- Items ---------- */

export async function listItemsRepo(): Promise<Item[]> {
  const rows = await db.select().from(itemsTable);
  return rows.map(rowToItem);
}

export type AddItemInput = {
  name: string;
  quantity: number;
  expiry?: string;
  category?: string;
  categoryReviewed?: boolean;
  // "" = shared household food; a member name = that person's own food.
  owner?: string;
};

export async function addItemRepo(
  input: AddItemInput
): Promise<{
  items: Item[];
  merged: boolean;
  mergedInto?: string;
  addedQty?: number;
}> {
  const trimmedName = requireText(input.name, "Name", MAX_NAME_LEN);
  const qty = requirePositiveIntegerQuantity(input.quantity);

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const category = input.categoryReviewed
    ? requireValidCategory(input.category, validCats)
    : pickCategory(input.category, validCats);
  const expiry = input.expiry ? requireDate(input.expiry, "Expiry") : null;
  const owner = validateOwner(input.owner);

  // One shelf, one row per thing: the merge is a plain normalized-name match.
  const all = await db.select().from(itemsTable);
  const normNew = normalizeName(trimmedName);
  const existing = all.find((it) => normalizeName(it.name) === normNew);

  if (existing) {
    let mergedExpiry: string | null = existing.expiry;
    if (expiry) {
      if (!existing.expiry || expiry < existing.expiry) {
        mergedExpiry = expiry;
      }
    }
    const replaceCategory = shouldReplaceStoredCategory(
      existing.category,
      existing.categoryReviewed,
      category,
      input.categoryReviewed === true,
      validCats
    );
    await db
      .update(itemsTable)
      .set({
        quantity: requireMergedQuantity(existing.quantity, qty),
        expiry: mergedExpiry,
        // Reviewed labels are durable corrections. Unreviewed/legacy rows can
        // be refreshed by the current classifier when the item is added again.
        ...(replaceCategory ? { category } : {}),
        ...(replaceCategory
          ? { categoryReviewed: input.categoryReviewed === true }
          : {}),
      })
      .where(eq(itemsTable.id, existing.id));

    return {
      items: await listItemsRepo(),
      merged: true,
      mergedInto: existing.name,
      addedQty: qty,
    };
  }

  await db.insert(itemsTable).values({
    name: trimmedName,
    quantity: qty,
    expiry,
    category,
    categoryReviewed: input.categoryReviewed === true,
    owner: owner || null,
  });
  return { items: await listItemsRepo(), merged: false };
}

export type UpdateItemInput = AddItemInput & { id: string };

export async function updateItemRepo(input: UpdateItemInput): Promise<Item[]> {
  const id = requireId(input.id);
  const trimmedName = requireText(input.name, "Name", MAX_NAME_LEN);
  // Same rule as add — an edit must not be able to park a 0 or fractional
  // quantity on a row that add would have rejected.
  const qty = requirePositiveIntegerQuantity(input.quantity);

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const category = input.categoryReviewed
    ? requireValidCategory(input.category, validCats)
    : pickCategory(input.category, validCats);

  const updated = await db
    .update(itemsTable)
    .set({
      name: trimmedName,
      quantity: qty,
      expiry: input.expiry ? requireDate(input.expiry, "Expiry") : null,
      category,
      ...(input.categoryReviewed !== undefined
        ? { categoryReviewed: input.categoryReviewed === true }
        : {}),
      ...(input.owner !== undefined
        ? { owner: validateOwner(input.owner) || null }
        : {}),
    })
    .where(eq(itemsTable.id, id))
    .returning({ id: itemsTable.id });

  if (updated.length === 0) throw new NotFoundError();
  return listItemsRepo();
}

export async function deleteItemRepo(id: string): Promise<Item[]> {
  const itemId = requireId(id);
  const deleted = await db
    .delete(itemsTable)
    .where(eq(itemsTable.id, itemId))
    .returning({ id: itemsTable.id });
  if (deleted.length === 0) throw new NotFoundError();
  return listItemsRepo();
}

/* ---------- Grocery list ---------- */

function rowToGrocery(r: typeof groceryTable.$inferSelect): GroceryItem {
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    category: r.category,
    categoryReviewed: r.categoryReviewed,
    store: r.store || "",
    addedBy: r.addedBy,
    pool: (GROCERY_POOLS as readonly string[]).includes(r.pool)
      ? (r.pool as GroceryPool)
      : "house",
    done: r.done,
    added: formatDate(r.added),
  };
}

export async function listGroceryRepo(): Promise<GroceryItem[]> {
  const rows = await db.select().from(groceryTable);
  return rows.map(rowToGrocery);
}

export type AddGroceryInput = {
  name: string;
  quantity: number;
  category?: string;
  categoryReviewed?: boolean;
  store?: string;
  addedBy: string;
  pool?: GroceryPool;
};

export async function addGroceryRepo(
  input: AddGroceryInput
): Promise<GroceryItem[]> {
  const trimmedName = requireText(input.name, "Name", MAX_NAME_LEN);
  const qty = requirePositiveIntegerQuantity(input.quantity);
  const addedBy = requireText(input.addedBy, "Added by", MAX_NAME_LEN);

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const category = input.categoryReviewed
    ? requireValidCategory(input.category, validCats)
    : pickCategory(input.category, validCats);
  const store = optionalText(input.store, "Store", MAX_STORE_LEN) || null;
  const pool = validatePool(input.pool);
  const canonicalName = titleCaseName(trimmedName);

  // Case-insensitive merge against open (not-done) rows. Done rows are left
  // alone — those represent items already bought, so the user is asking for
  // more of the same and we open a fresh line for it.
  const all = await db.select().from(groceryTable);
  const normNew = normalizeName(canonicalName);
  const existing = all.find(
    (g) => !g.done && normalizeName(g.name) === normNew
  );

  if (existing) {
    const replaceCategory = shouldReplaceStoredCategory(
      existing.category,
      existing.categoryReviewed,
      category,
      input.categoryReviewed === true,
      validCats
    );
    await db
      .update(groceryTable)
      .set({
        quantity: requireMergedQuantity(existing.quantity, qty),
        name: canonicalName,
        // Track every requester so "For Arthur" + "For Eli" becomes
        // "For Arthur, Eli" instead of silently dropping the new person.
        addedBy: mergeAddedBy(existing.addedBy, addedBy),
        ...(replaceCategory ? { category } : {}),
        ...(replaceCategory
          ? { categoryReviewed: input.categoryReviewed === true }
          : {}),
      })
      .where(eq(groceryTable.id, existing.id));
    return listGroceryRepo();
  }

  await db.insert(groceryTable).values({
    name: canonicalName,
    quantity: qty,
    category,
    categoryReviewed: input.categoryReviewed === true,
    store,
    addedBy,
    pool,
  });
  return listGroceryRepo();
}

export type UpdateGroceryInput = {
  id: string;
  name?: string;
  quantity?: number;
  category?: string;
  categoryReviewed?: boolean;
  store?: string;
  addedBy?: string;
  pool?: GroceryPool;
  done?: boolean;
};

export async function updateGroceryRepo(
  input: UpdateGroceryInput
): Promise<GroceryItem[]> {
  const id = requireId(input.id);

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const patch: Partial<typeof groceryTable.$inferInsert> = {};

  if (input.name !== undefined) {
    patch.name = titleCaseName(requireText(input.name, "Name", MAX_NAME_LEN));
  }
  if (input.quantity !== undefined) {
    const qty = requirePositiveIntegerQuantity(input.quantity);
    patch.quantity = qty;
  }
  if (input.category !== undefined) {
    patch.category = pickCategory(input.category, validCats);
  }
  // The reviewed flag stands on its own: confirming the category the row
  // already has sends no `category`, and that confirmation must still stick.
  if (input.categoryReviewed !== undefined) {
    patch.categoryReviewed = input.categoryReviewed === true;
  }
  if (input.store !== undefined) {
    patch.store = optionalText(input.store, "Store", MAX_STORE_LEN) || null;
  }
  if (input.addedBy !== undefined) {
    patch.addedBy = requireText(input.addedBy, "Added by", MAX_NAME_LEN);
  }
  if (input.pool !== undefined) {
    patch.pool = validatePool(input.pool);
  }
  if (input.done !== undefined) {
    patch.done = !!input.done;
  }
  if (Object.keys(patch).length === 0) {
    throw new ValidationError("Nothing to update");
  }

  const updated = await db
    .update(groceryTable)
    .set(patch)
    .where(eq(groceryTable.id, id))
    .returning({ id: groceryTable.id });
  if (updated.length === 0) throw new NotFoundError();
  return listGroceryRepo();
}

export async function deleteGroceryRepo(id: string): Promise<GroceryItem[]> {
  const groceryId = requireId(id);
  const deleted = await db
    .delete(groceryTable)
    .where(eq(groceryTable.id, groceryId))
    .returning({ id: groceryTable.id });
  if (deleted.length === 0) throw new NotFoundError();
  return listGroceryRepo();
}

export async function clearGroceryRepo(): Promise<GroceryItem[]> {
  await db.delete(groceryTable);
  return [];
}

/** The grocery columns the move reads. */
export type MoveDoneGroceryRow = {
  id: string;
  name: string;
  quantity: number;
  category: string;
  categoryReviewed: boolean;
};

/** The inventory columns the move reads. */
export type MoveDoneInventoryRow = {
  id: string;
  name: string;
  quantity: number;
  category: string;
  categoryReviewed: boolean;
};

export type MoveDonePlan = {
  /** Existing inventory rows whose final state differs from the stored one. */
  updates: Array<{
    id: string;
    quantity: number;
    // Present only when the category is being replaced, so an untouched
    // category is never rewritten.
    category?: string;
    categoryReviewed?: boolean;
  }>;
  inserts: Array<{
    name: string;
    quantity: number;
    category: string;
    categoryReviewed: boolean;
  }>;
  /** Every done grocery row, including ones too broken to move. */
  deleteIds: string[];
};

/**
 * The whole move, decided in memory: which inventory rows change, which get
 * created, and which grocery rows go away. Pure, so every quantity is capped
 * and every category resolved before the first statement is sent — and so
 * the merge rules can be tested without a database.
 *
 * `done` must already be in the order the rows should be applied (oldest
 * first); consecutive rows with the same normalized name fold together, the
 * same way repeated adds do.
 */
export function planMoveDone(
  done: MoveDoneGroceryRow[],
  inventory: MoveDoneInventoryRow[],
  validCats: string[]
): MoveDonePlan {
  type Target = {
    quantity: number;
    category: string;
    categoryReviewed: boolean;
    changed: boolean;
    categoryChanged: boolean;
  };
  const existingByNorm = new Map<string, Target & { id: string }>();
  for (const r of inventory) {
    existingByNorm.set(normalizeName(r.name), {
      id: r.id,
      quantity: r.quantity,
      category: r.category,
      categoryReviewed: r.categoryReviewed,
      changed: false,
      categoryChanged: false,
    });
  }
  const insertByNorm = new Map<string, Target & { name: string }>();

  for (const g of done) {
    const name = String(g.name ?? "").trim();
    // A done row with no usable name can't become an inventory item, but it
    // still leaves the list — same as before.
    if (!name) continue;
    const category = pickCategory(g.category, validCats);
    const groceryCategoryValid = validCats.some(
      (valid) => valid.toLowerCase() === g.category.toLowerCase()
    );
    const categoryReviewed = g.categoryReviewed && groceryCategoryValid;
    const norm = normalizeName(name);
    const target = existingByNorm.get(norm) ?? insertByNorm.get(norm);

    if (!target) {
      insertByNorm.set(norm, {
        name,
        quantity: g.quantity || 0,
        // Inventory items don't currently carry store/addedBy/owner.
        category,
        categoryReviewed,
        changed: true,
        categoryChanged: true,
      });
      continue;
    }

    target.quantity = requireMergedQuantity(
      target.quantity,
      g.quantity || 0,
      name
    );
    target.changed = true;
    if (
      shouldReplaceStoredCategory(
        target.category,
        target.categoryReviewed,
        category,
        categoryReviewed,
        validCats
      )
    ) {
      target.category = category;
      target.categoryReviewed = categoryReviewed;
      target.categoryChanged = true;
    }
  }

  const updates: MoveDonePlan["updates"] = [];
  for (const target of existingByNorm.values()) {
    if (!target.changed) continue;
    updates.push({
      id: target.id,
      quantity: target.quantity,
      ...(target.categoryChanged
        ? { category: target.category, categoryReviewed: target.categoryReviewed }
        : {}),
    });
  }

  return {
    updates,
    inserts: [...insertByNorm.values()].map((row) => ({
      name: row.name,
      quantity: row.quantity,
      category: row.category,
      categoryReviewed: row.categoryReviewed,
    })),
    deleteIds: done.map((d) => d.id),
  };
}

/**
 * Moves every checked-off grocery row into the inventory (items table) and
 * deletes those grocery rows. Returns the post-move state for both tables
 * plus a count, so the UI can pop a "moved N items" toast and refresh.
 *
 * Merge behavior matches the regular add-to-inventory path: if a matching
 * item already exists, quantities add. Reviewed inventory categories are
 * preserved; otherwise the grocery row carries its current category across.
 * Expiry is left empty (the user can fill it in after).
 *
 * Inventory writes and the grocery deletes go out as one unit. They used to
 * be issued row by row with the deletes last, so a row that failed halfway
 * through left the inventory written *and* the list intact — and the retry
 * the user naturally reached for added everything a second time.
 */
export async function moveDoneGroceryToItemsRepo(): Promise<{
  items: Item[];
  grocery: GroceryItem[];
  moved: number;
}> {
  const allGrocery = await db.select().from(groceryTable);
  const done = allGrocery
    .filter((g) => g.done)
    .sort(
      (a, b) =>
        a.added.getTime() - b.added.getTime() || a.id.localeCompare(b.id)
    );
  if (done.length === 0) {
    return {
      items: await listItemsRepo(),
      grocery: await listGroceryRepo(),
      moved: 0,
    };
  }

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const inventoryRows = await db.select().from(itemsTable);

  // Throws before anything is written when a merged quantity overflows.
  const plan = planMoveDone(done, inventoryRows, validCats);

  await runWritesAtomically((tx) => {
    const writes: BatchItem<"pg">[] = [];
    for (const u of plan.updates) {
      writes.push(
        tx
          .update(itemsTable)
          .set({
            quantity: u.quantity,
            ...(u.category !== undefined
              ? { category: u.category, categoryReviewed: u.categoryReviewed }
              : {}),
          })
          .where(eq(itemsTable.id, u.id))
      );
    }
    if (plan.inserts.length > 0) {
      writes.push(tx.insert(itemsTable).values(plan.inserts));
    }
    writes.push(
      tx.delete(groceryTable).where(inArray(groceryTable.id, plan.deleteIds))
    );
    return writes;
  });

  return {
    items: await listItemsRepo(),
    grocery: await listGroceryRepo(),
    moved: done.length,
  };
}

export async function bulkAddGroceryRepo(
  inputs: Array<{
    name: string;
    quantity: number;
    category?: string;
    categoryReviewed?: boolean;
    store?: string;
    addedBy: string;
    pool?: GroceryPool;
  }>
): Promise<GroceryItem[]> {
  if (inputs.length === 0) return listGroceryRepo();
  const validCats = (await listCategoriesRepo()).map((c) => c.name);

  // Validate and canonicalize the whole request before the first write. A
  // recipe can contain count-based rows with quantity 0; previously an early
  // merge could commit before a later invalid row threw, so retrying doubled
  // the first item.
  const preparedRows = inputs.map((input) => {
    if (typeof input.name !== "string" || !input.name.trim()) {
      throw new ValidationError("Each ingredient needs a name");
    }
    const rawName = requireText(input.name, "Ingredient name", MAX_NAME_LEN);
    const quantity = requirePositiveIntegerQuantity(
      input.quantity,
      `Quantity for "${rawName}"`
    );
    const addedBy = requireText(input.addedBy, "Added by", MAX_NAME_LEN);
    const categoryReviewed = input.categoryReviewed === true;
    const category = categoryReviewed
      ? requireValidCategory(input.category, validCats)
      : pickCategory(input.category, validCats);
    const name = titleCaseName(rawName);
    return {
      name,
      norm: normalizeName(name),
      quantity,
      category,
      categoryReviewed,
      store: optionalText(input.store, "Store", MAX_STORE_LEN) || null,
      addedBy,
      pool: validatePool(input.pool),
    };
  });

  // Coalesce repeated ingredient names before touching the database. Besides
  // issuing fewer writes, this lets us validate the final summed quantity up
  // front and keeps duplicate category review semantics deterministic.
  const preparedByNorm = new Map<
    string,
    (typeof preparedRows)[number]
  >();
  for (const row of preparedRows) {
    const existing = preparedByNorm.get(row.norm);
    if (!existing) {
      preparedByNorm.set(row.norm, { ...row });
      continue;
    }
    existing.quantity = requireMergedQuantity(
      existing.quantity,
      row.quantity,
      row.name
    );
    existing.name = row.name;
    existing.addedBy = mergeAddedBy(existing.addedBy, row.addedBy);
    if (row.categoryReviewed || !existing.categoryReviewed) {
      existing.category = row.category;
      existing.categoryReviewed = row.categoryReviewed;
    }
  }
  const prepared = [...preparedByNorm.values()];

  // Snapshot the current rows once so we can match against existing open
  // entries by normalized name (same merge rule as addGroceryRepo).
  const existingRows = await db.select().from(groceryTable);
  const openRows = existingRows
    .filter((r) => !r.done)
    .map((r) => ({
      id: r.id,
      name: r.name,
      norm: normalizeName(r.name),
      quantity: r.quantity,
      category: r.category,
      categoryReviewed: r.categoryReviewed,
      addedBy: r.addedBy,
      changed: false,
    }));

  // Fold everything into the in-memory snapshot first, so every combined
  // quantity is validated before the first write and a late integer
  // overflow cannot partially commit earlier recipe ingredients.
  const toInsert: Array<typeof groceryTable.$inferInsert> = [];
  for (const input of prepared) {
    const target = openRows.find((o) => o.norm === input.norm);
    if (!target) {
      toInsert.push({
        name: input.name,
        quantity: input.quantity,
        category: input.category,
        categoryReviewed: input.categoryReviewed,
        store: input.store,
        addedBy: input.addedBy,
        pool: input.pool,
      });
      continue;
    }
    target.quantity = requireMergedQuantity(
      target.quantity,
      input.quantity,
      input.name
    );
    target.name = input.name;
    target.addedBy = mergeAddedBy(target.addedBy, input.addedBy);
    if (
      shouldReplaceStoredCategory(
        target.category,
        target.categoryReviewed,
        input.category,
        input.categoryReviewed,
        validCats
      )
    ) {
      target.category = input.category;
      target.categoryReviewed = input.categoryReviewed;
    }
    target.changed = true;
  }

  await runWritesAtomically((tx) => {
    const writes: BatchItem<"pg">[] = [];
    for (const target of openRows) {
      if (!target.changed) continue;
      writes.push(
        tx
          .update(groceryTable)
          .set({
            quantity: target.quantity,
            name: target.name,
            addedBy: target.addedBy,
            category: target.category,
            categoryReviewed: target.categoryReviewed,
          })
          .where(eq(groceryTable.id, target.id))
      );
    }
    if (toInsert.length > 0) {
      writes.push(tx.insert(groceryTable).values(toInsert));
    }
    return writes;
  });
  return listGroceryRepo();
}

/* ---------- Recipes ---------- */

function sanitizeIngredients(
  raw: unknown,
  validCats: string[]
): RecipeIngredient[] {
  if (!Array.isArray(raw)) return [];
  const out: RecipeIngredient[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    // Ingredients land in a jsonb column, which Postgres refuses outright
    // when a string carries U+0000.
    const name = stripControlChars(String(o.name ?? "")).trim();
    const qty = Number(o.quantity);
    if (!name) continue;
    if (!qty || qty <= 0) continue;
    out.push({
      name,
      quantity: qty,
      category: pickCategory(
        typeof o.category === "string" ? o.category : undefined,
        validCats
      ),
      categoryReviewed: o.categoryReviewed === true,
    });
  }
  return out;
}

function rowToRecipe(r: typeof recipesTable.$inferSelect): Recipe {
  return {
    id: r.id,
    weekStart: r.weekStart,
    day: r.day,
    assignedTo: r.assignedTo,
    name: r.name,
    link: r.link || "",
    description: r.description || "",
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    servings: r.servings ?? 0,
    portions: r.portions ?? 0,
    noMeal: r.noMeal,
  };
}

function rowToFavorite(r: typeof favoritesTable.$inferSelect): FavoriteRecipe {
  return {
    id: r.id,
    name: r.name,
    link: r.link || "",
    description: r.description || "",
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    servings: r.servings ?? 0,
  };
}

export async function listRecipesRepo(): Promise<Recipe[]> {
  const weeks = [thisWeekStart(), nextWeekStart()];
  const rows = await db
    .select()
    .from(recipesTable)
    .where(inArray(recipesTable.weekStart, weeks));
  return rows.map(rowToRecipe);
}

// Past-week recipes — everything with a weekStart strictly before the
// current week. Sorted newest-first by (weekStart, day) so the archive UI
// can render a reverse chronology without re-sorting.
export async function listArchivedRecipesRepo(): Promise<Recipe[]> {
  const cutoff = thisWeekStart();
  const rows = await db
    .select()
    .from(recipesTable)
    .where(lt(recipesTable.weekStart, cutoff));
  // "No meal" markers are bookkeeping, not recipes — never archive them.
  const archive = rows.filter((r) => !r.noMeal).map(rowToRecipe);
  archive.sort((a, b) => {
    if (a.weekStart !== b.weekStart) return b.weekStart.localeCompare(a.weekStart);
    return a.day - b.day;
  });
  return archive;
}

export type AddRecipeInput = {
  weekStart: string;
  day: number;
  assignedTo: string;
  name: string;
  link?: string;
  description?: string;
  ingredients?: unknown;
  servings?: number;
  portions?: number;
  noMeal?: boolean;
};

/** Non-negative whole number; 0 and undefined both mean "not set" (null). */
function validateRecipeCount(
  input: number | undefined,
  label: string
): number | null {
  if (input === undefined || input === null) return null;
  const n = Number(input);
  if (!Number.isInteger(n) || n < 0 || n > MAX_POSTGRES_INTEGER) {
    throw new ValidationError(`${label} must be a whole number of 0 or more`);
  }
  return n === 0 ? null : n;
}

function validateRecipeSlot(input: {
  day?: number;
  weekStart?: string;
}) {
  if (
    typeof input.day !== "number" ||
    !Number.isInteger(input.day) ||
    input.day < 0 ||
    input.day > 6
  ) {
    throw new ValidationError("Day must be Sunday through Saturday (0-6)");
  }
  requireDate(input.weekStart, "weekStart");
}

function validateRecipeBase(input: AddRecipeInput) {
  const name = requireText(input.name, "Recipe name", MAX_RECIPE_NAME_LEN);
  const assignedTo = requireText(input.assignedTo, "Assigned cook", MAX_NAME_LEN);
  validateRecipeSlot(input);
  return { name, assignedTo };
}

/**
 * A day holds one recipe, enforced by a unique index on (week_start, day).
 * Two housemates filling the same slot at the same moment lose that race in
 * Postgres rather than in the read-then-write check, so translate the code.
 */
function isSlotConflict(e: unknown): boolean {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

async function withSlotConflict<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isSlotConflict(e)) {
      throw new ValidationError("That day already has a recipe");
    }
    throw e;
  }
}

export async function addRecipeRepo(
  input: AddRecipeInput
): Promise<Recipe[]> {
  const noMeal = input.noMeal === true;
  const validCats = (await listCategoriesRepo()).map((c) => c.name);

  // A day holds either a recipe or a "no meal" marker, never both.
  if (noMeal) {
    validateRecipeSlot(input);
    const sameSlot = await recipesInSlot(input);
    if (sameSlot.some((r) => !r.noMeal)) {
      throw new ValidationError("That day already has a recipe");
    }
    if (sameSlot.some((r) => r.noMeal)) return listRecipesRepo();
    const markerNote =
      optionalText(input.description, "Description", MAX_DESCRIPTION_LEN) ||
      null;
    await withSlotConflict(() =>
      db.insert(recipesTable).values({
        weekStart: input.weekStart,
        day: input.day,
        assignedTo: "",
        name: "",
        link: null,
        description: markerNote,
        ingredients: [],
        servings: null,
        portions: null,
        noMeal: true,
      })
    );
    return listRecipesRepo();
  }

  const { name, assignedTo } = validateRecipeBase(input);
  // A day holds one recipe. Filling a day that was marked "no meal"
  // replaces the marker.
  const sameSlot = await recipesInSlot(input);
  if (sameSlot.some((r) => !r.noMeal)) {
    throw new ValidationError("That day already has a recipe");
  }
  const markers = sameSlot.filter((r) => r.noMeal);
  if (markers.length > 0) {
    await db.delete(recipesTable).where(
      inArray(
        recipesTable.id,
        markers.map((m) => m.id)
      )
    );
  }
  await withSlotConflict(() =>
    db.insert(recipesTable).values({
      weekStart: input.weekStart,
      day: input.day,
      assignedTo,
      name,
      link: optionalText(input.link, "Link", MAX_LINK_LEN) || null,
      description:
        optionalText(input.description, "Description", MAX_DESCRIPTION_LEN) ||
        null,
      ingredients: sanitizeIngredients(input.ingredients, validCats),
      servings: validateRecipeCount(input.servings, "Servings"),
      portions: validateRecipeCount(input.portions, "Portions"),
      noMeal: false,
    })
  );
  return listRecipesRepo();
}

/** Rows already sitting on the given week + day. */
async function recipesInSlot(input: {
  weekStart?: string;
  day?: number;
}): Promise<Array<typeof recipesTable.$inferSelect>> {
  if (!input.weekStart || typeof input.day !== "number") return [];
  return db
    .select()
    .from(recipesTable)
    .where(
      and(
        eq(recipesTable.weekStart, input.weekStart),
        eq(recipesTable.day, input.day)
      )
    );
}

export type UpdateRecipeInput = Partial<AddRecipeInput> & { id: string };

export async function updateRecipeRepo(
  input: UpdateRecipeInput
): Promise<Recipe[]> {
  const id = requireId(input.id);
  const validCats = (await listCategoriesRepo()).map((c) => c.name);

  // A "no meal" marker has no name or cook, so those requirements are lifted
  // when the patch is turning the row into one.
  const makingMarker = input.noMeal === true;
  const patch: Partial<typeof recipesTable.$inferInsert> = {};
  if (input.name !== undefined && !makingMarker) {
    patch.name = requireText(input.name, "Recipe name", MAX_RECIPE_NAME_LEN);
  }
  if (input.assignedTo !== undefined && !makingMarker) {
    patch.assignedTo = requireText(
      input.assignedTo,
      "Assigned cook",
      MAX_NAME_LEN
    );
  }
  if (input.day !== undefined) {
    if (!Number.isInteger(input.day) || input.day < 0 || input.day > 6)
      throw new ValidationError("Day must be Sunday through Saturday (0-6)");
    patch.day = input.day;
  }
  if (input.weekStart !== undefined) {
    patch.weekStart = requireDate(input.weekStart, "weekStart");
  }
  if (input.link !== undefined) {
    patch.link = optionalText(input.link, "Link", MAX_LINK_LEN) || null;
  }
  if (input.description !== undefined) {
    patch.description =
      optionalText(input.description, "Description", MAX_DESCRIPTION_LEN) ||
      null;
  }
  if (input.ingredients !== undefined) {
    patch.ingredients = sanitizeIngredients(input.ingredients, validCats);
  }
  if (input.servings !== undefined) {
    patch.servings = validateRecipeCount(input.servings, "Servings");
  }
  if (input.portions !== undefined) {
    patch.portions = validateRecipeCount(input.portions, "Portions");
  }
  if (input.noMeal !== undefined) {
    patch.noMeal = input.noMeal === true;
    // Turning a row into a marker strips everything a meal carried.
    if (patch.noMeal) {
      patch.name = "";
      patch.assignedTo = "";
      patch.ingredients = [];
      patch.servings = null;
      patch.portions = null;
    }
  }

  // Slot invariant (a day holds a recipe or a marker, never both) and the
  // "a real recipe has a name and a cook" rule both need the merged row.
  const existingRows = await db
    .select()
    .from(recipesTable)
    .where(eq(recipesTable.id, id))
    .limit(1);
  if (existingRows.length === 0) throw new NotFoundError();
  if (Object.keys(patch).length === 0) {
    throw new ValidationError("Nothing to update");
  }
  const merged = { ...existingRows[0], ...patch };
  if (!merged.noMeal) {
    if (!String(merged.name ?? "").trim()) throw new ValidationError("Recipe name required");
    if (!String(merged.assignedTo ?? "").trim()) throw new ValidationError("Assigned cook required");
  }
  const moving =
    (patch.day !== undefined && patch.day !== existingRows[0].day) ||
    (patch.weekStart !== undefined && patch.weekStart !== existingRows[0].weekStart) ||
    (patch.noMeal !== undefined && patch.noMeal !== existingRows[0].noMeal);
  if (moving) {
    const others = (
      await recipesInSlot({ weekStart: merged.weekStart, day: merged.day })
    ).filter((r) => r.id !== id);
    if (merged.noMeal) {
      if (others.some((r) => !r.noMeal)) throw new ValidationError("That day already has a recipe");
      if (others.length > 0) {
        // Already marked; drop this row instead of keeping two markers.
        await db.delete(recipesTable).where(eq(recipesTable.id, id));
        return listRecipesRepo();
      }
    } else {
      if (others.some((r) => !r.noMeal)) throw new ValidationError("That day already has a recipe");
      const markers = others.filter((r) => r.noMeal);
      if (markers.length > 0) {
        await db.delete(recipesTable).where(inArray(recipesTable.id, markers.map((m) => m.id)));
      }
    }
  }

  await withSlotConflict(() =>
    db.update(recipesTable).set(patch).where(eq(recipesTable.id, id))
  );
  return listRecipesRepo();
}

export async function deleteRecipeRepo(id: string): Promise<Recipe[]> {
  const recipeId = requireId(id);
  const deleted = await db
    .delete(recipesTable)
    .where(eq(recipesTable.id, recipeId))
    .returning({ id: recipesTable.id });
  if (deleted.length === 0) throw new NotFoundError();
  return listRecipesRepo();
}

/* ---------- Favorites ---------- */

export async function listFavoritesRepo(): Promise<FavoriteRecipe[]> {
  const rows = await db.select().from(favoritesTable);
  return rows.map(rowToFavorite);
}

/** Base servings a favorite was written for; 0 means "never learned". */
function normalizedServings(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= MAX_POSTGRES_INTEGER ? n : 0;
}

export async function addFavoriteRepo(input: {
  name: string;
  link?: string;
  description?: string;
  ingredients?: unknown;
  servings?: number;
}): Promise<{ favorites: FavoriteRecipe[]; existed: boolean }> {
  const name = requireText(input.name, "Name", MAX_RECIPE_NAME_LEN);
  const link = optionalText(input.link, "Link", MAX_LINK_LEN);
  const validCats = (await listCategoriesRepo()).map((c) => c.name);

  // Dedupe: a favorite already exists if its name matches case-insensitively,
  // OR if both have a link and the links match case-insensitively. Same
  // recipe pasted twice (or favorited from the modal twice) is treated as a
  // no-op rather than a duplicate row.
  const nameKey = name.toLowerCase();
  const linkKey = link.toLowerCase();
  const existing = await listFavoritesRepo();
  const dup = existing.find((f) => {
    if (f.name.trim().toLowerCase() === nameKey) return true;
    if (linkKey && (f.link || "").trim().toLowerCase() === linkKey) return true;
    return false;
  });
  if (dup) {
    const incomingServings = normalizedServings(input.servings);
    // A favorite saved before the scraper learned its base servings is stuck
    // at 0 forever otherwise. Fill that one field in and touch nothing else.
    if (incomingServings && !dup.servings) {
      await db
        .update(favoritesTable)
        .set({ servings: incomingServings })
        .where(eq(favoritesTable.id, dup.id));
      return { favorites: await listFavoritesRepo(), existed: true };
    }
    return { favorites: existing, existed: true };
  }

  await db.insert(favoritesTable).values({
    name,
    link: link || null,
    description:
      optionalText(input.description, "Description", MAX_DESCRIPTION_LEN) ||
      null,
    ingredients: sanitizeIngredients(input.ingredients, validCats),
    // A favorite that never learned its base servings just stores null.
    servings: normalizedServings(input.servings) || null,
  });
  return { favorites: await listFavoritesRepo(), existed: false };
}

export async function deleteFavoriteRepo(id: string): Promise<FavoriteRecipe[]> {
  const favoriteId = requireId(id);
  const deleted = await db
    .delete(favoritesTable)
    .where(eq(favoritesTable.id, favoriteId))
    .returning({ id: favoritesTable.id });
  if (deleted.length === 0) throw new NotFoundError();
  return listFavoritesRepo();
}

/* ---------- Expense categories ---------- */

async function ensureDefaultExpenseCategories(): Promise<void> {
  await db
    .insert(expenseCategoriesTable)
    .values(DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ name })))
    .onConflictDoNothing();
}

// Mirror the fridge-category ordering: user-added first (A–Z), then the
// Misc fallback pinned to the end.
function sortExpenseCategories(
  list: ExpenseCategoryDef[]
): ExpenseCategoryDef[] {
  const fallbackLower = EXPENSE_FALLBACK.toLowerCase();
  const rest: ExpenseCategoryDef[] = [];
  let fallback: ExpenseCategoryDef | undefined;
  for (const c of list) {
    if (c.name.toLowerCase() === fallbackLower) fallback = c;
    else rest.push(c);
  }
  rest.sort((a, b) => a.name.localeCompare(b.name));
  return [...rest, ...(fallback ? [fallback] : [])];
}

export async function listExpenseCategoriesRepo(): Promise<ExpenseCategoryDef[]> {
  const rows = await db.select().from(expenseCategoriesTable);
  if (rows.length === 0) {
    await ensureDefaultExpenseCategories();
    return sortExpenseCategories(
      DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ name, color: null }))
    );
  }
  const list = rows.map((r) => ({ name: r.name, color: r.color ?? null }));
  if (
    !list.some(
      (c) => c.name.toLowerCase() === EXPENSE_FALLBACK.toLowerCase()
    )
  ) {
    list.push({ name: EXPENSE_FALLBACK, color: null });
  }
  return sortExpenseCategories(list);
}

function validateHexColor(color: string | undefined | null): string | null {
  if (color === undefined || color === null || color === "") return null;
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new ValidationError("Color must be a 6-digit hex like #RRGGBB");
  }
  return color.toLowerCase();
}

export async function addExpenseCategoryRepo(
  name: string,
  color?: string | null
): Promise<{ expenseCategories: ExpenseCategoryDef[]; existed: boolean }> {
  const trimmed = requireText(name, "Name", MAX_CATEGORY_LEN);
  const validatedColor = validateHexColor(color);

  const existing = await listExpenseCategoriesRepo();
  if (existing.some((e) => e.name.toLowerCase() === trimmed.toLowerCase())) {
    return { expenseCategories: existing, existed: true };
  }
  await db
    .insert(expenseCategoriesTable)
    .values({ name: trimmed, color: validatedColor })
    .onConflictDoNothing();
  return {
    expenseCategories: await listExpenseCategoriesRepo(),
    existed: false,
  };
}

export async function updateExpenseCategoryColorRepo(
  name: string,
  color: string | null
): Promise<ExpenseCategoryDef[]> {
  const trimmed = requireText(name, "Name", MAX_CATEGORY_LEN);
  const validatedColor = validateHexColor(color);
  await db
    .update(expenseCategoriesTable)
    .set({ color: validatedColor })
    .where(eq(expenseCategoriesTable.name, trimmed));
  return listExpenseCategoriesRepo();
}

export async function deleteExpenseCategoryRepo(name: string): Promise<{
  expenseCategories: ExpenseCategoryDef[];
  expenses: Expense[];
  reassigned: number;
}> {
  const trimmed = requireText(name, "Name", MAX_CATEGORY_LEN);
  if (trimmed.toLowerCase() === EXPENSE_FALLBACK.toLowerCase()) {
    throw new ValidationError(
      `Cannot delete the fallback category "${EXPENSE_FALLBACK}"`
    );
  }

  const allExpenses = await db.select().from(expensesTable);
  const affected = allExpenses.filter(
    (e) => e.category.toLowerCase() === trimmed.toLowerCase()
  );
  if (affected.length > 0) {
    for (const ex of affected) {
      await db
        .update(expensesTable)
        .set({ category: EXPENSE_FALLBACK })
        .where(eq(expensesTable.id, ex.id));
    }
  }

  await db
    .delete(expenseCategoriesTable)
    .where(eq(expenseCategoriesTable.name, trimmed));

  const [expenseCategories, expenses] = await Promise.all([
    listExpenseCategoriesRepo(),
    listExpensesRepo(),
  ]);
  return { expenseCategories, expenses, reassigned: affected.length };
}

/* ---------- Expenses ---------- */

function rowToExpense(r: typeof expensesTable.$inferSelect): Expense {
  return {
    id: r.id,
    name: r.name,
    amountCents: r.amountCents,
    category: r.category,
    store: r.store || "",
    paidBy: r.paidBy,
    // NULL (or unreadable) allocations mean a pre-feature row: one house
    // line over everyone, which is exactly the old five-way behaviour.
    allocations: allocationsFromStored(r.allocations, r.amountCents),
    // Legacy rows didn't have occurred_on — fall back to the creation date so
    // monthly bucketing/display stays sensible.
    occurredOn: r.occurredOn || formatDate(r.added),
    description: r.description || "",
    receiptUrl: r.receiptUrl || "",
    receiptFileId: r.receiptFileId || "",
    receiptMime: r.receiptMime || "",
    added: formatDate(r.added),
  };
}

// "Costco 2026-05-26" → "Costco May 26"
function expenseDisplayName(store: string, occurredOn: string): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [, mStr, dStr] = occurredOn.split("-");
  const mIdx = (Number(mStr) || 1) - 1;
  const day = Number(dStr) || 1;
  const label = `${months[mIdx]} ${day}`;
  const trimmedStore = store.trim();
  return trimmedStore ? `${trimmedStore} ${label}` : `Expense ${label}`;
}

export function validateOccurredOn(input: string | undefined): string {
  // Defaulting uses the household timezone, not the server's: an expense
  // logged on Friday evening in Toronto must not land on Saturday because
  // the server clock is UTC.
  const today = todayYmd();
  if (input === undefined || input === null || input === "") return today;
  const occurredOn = requireDate(input, "Date");
  // A future date lands the expense in the receipts total but in no
  // settlement month, so the household is short by an amount nothing
  // explains. Same comparison the settlement months use: plain string
  // ordering is correct for YYYY-MM-DD.
  if (occurredOn > today) {
    throw new ValidationError("Date can't be in the future");
  }
  return occurredOn;
}

export async function listExpensesRepo(): Promise<Expense[]> {
  const rows = await db.select().from(expensesTable);
  return rows.map(rowToExpense);
}

/**
 * The household members who currently share dinners, per the `meal_group`
 * setting. Anything unrecognised is dropped; an empty result means the
 * group hasn't been set up and `meals` allocations can't be resolved.
 */
export async function currentMealGroup(): Promise<string[]> {
  const raw = await getSettingRepo(MEAL_GROUP_KEY);
  const members =
    raw && typeof raw === "object" && Array.isArray((raw as MealGroup).members)
      ? (raw as MealGroup).members
      : [];
  return members.map((m) => String(m ?? "").trim()).filter(isBuyer);
}

/**
 * `normalizeAllocations` is shared with the client and throws plain Errors,
 * but every one of its messages is a bad-input message — re-label them so the
 * route answers 400 instead of hiding them behind a generic 500.
 */
function checkedAllocations(
  raw: unknown,
  totalCents: number,
  ctx: ResolveContext
): ExpenseAllocation[] {
  try {
    return normalizeAllocations(raw, totalCents, ctx);
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : String(e));
  }
}

/** The payer has to be a household member, or settlement silently drops them. */
function validatePaidBy(input: string | undefined): string {
  const paidBy = String(input ?? "").trim();
  if (!paidBy) throw new ValidationError("Paid by required");
  if (!isBuyer(paidBy)) {
    throw new ValidationError(`"${paidBy}" is not a household member`);
  }
  return paidBy;
}

export type AddExpenseInput = {
  amountCents: number;
  store?: string;
  paidBy: string;
  occurredOn?: string;
  description?: string;
  // Already normalised by the caller (see normalizeAllocations).
  allocations: ExpenseAllocation[];
  receiptUrl?: string;
  receiptFileId?: string;
  receiptMime?: string;
};

export async function addExpenseRepo(
  input: AddExpenseInput
): Promise<Expense[]> {
  const amountCents = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new ValidationError("Amount must be greater than zero");
  }
  const paidBy = validatePaidBy(input.paidBy);
  // Re-checked here rather than trusted: the repo is the last gate before
  // storage, and a stored expense whose lines don't sum breaks settlement.
  const allocations = checkedAllocations(input.allocations, amountCents, {
    members: BUYERS,
    mealGroup: await currentMealGroup(),
  });

  const store = optionalText(input.store, "Store", MAX_STORE_LEN);
  const description = optionalText(
    input.description,
    "Description",
    MAX_DESCRIPTION_LEN
  );
  const occurredOn = validateOccurredOn(input.occurredOn);
  const name = expenseDisplayName(store, occurredOn);

  await db.insert(expensesTable).values({
    name,
    amountCents,
    category: EXPENSE_FALLBACK,
    store: store || null,
    paidBy,
    allocations,
    occurredOn,
    description: description || null,
    receiptUrl: input.receiptUrl || null,
    receiptFileId: input.receiptFileId || null,
    receiptMime: input.receiptMime || null,
  });
  return listExpensesRepo();
}

export type UpdateExpenseInput = {
  id: string;
  amountCents?: number;
  store?: string;
  paidBy?: string;
  occurredOn?: string;
  description?: string;
  // Raw client input; normalised here against the row's *final* amount.
  allocations?: unknown;
  // Set together when replacing the attached receipt. Caller is responsible
  // for deleting the old Drive file *after* the DB update succeeds.
  receiptUrl?: string;
  receiptFileId?: string;
  receiptMime?: string;
};

export async function updateExpenseRepo(
  input: UpdateExpenseInput
): Promise<Expense[]> {
  const id = requireId(input.id);
  const patch: Partial<typeof expensesTable.$inferInsert> = {};

  if (input.amountCents !== undefined) {
    const cents = Math.round(Number(input.amountCents));
    if (!Number.isFinite(cents) || cents <= 0) {
      throw new ValidationError("Amount must be greater than zero");
    }
    patch.amountCents = cents;
  }
  if (input.paidBy !== undefined) {
    patch.paidBy = validatePaidBy(input.paidBy);
  }
  if (input.description !== undefined) {
    patch.description =
      optionalText(input.description, "Description", MAX_DESCRIPTION_LEN) ||
      null;
  }
  if (input.receiptUrl !== undefined) {
    patch.receiptUrl = input.receiptUrl || null;
  }
  if (input.receiptFileId !== undefined) {
    patch.receiptFileId = input.receiptFileId || null;
  }
  if (input.receiptMime !== undefined) {
    patch.receiptMime = input.receiptMime || null;
  }

  // Store and date both feed into the auto-name; allocations have to be
  // re-checked against the row's final amount. Either way we need the
  // current row, and an unknown id has to 404 rather than update nothing.
  const existing = await db
    .select()
    .from(expensesTable)
    .where(eq(expensesTable.id, id))
    .limit(1);
  if (existing.length === 0) throw new NotFoundError();
  const row = existing[0];

  const finalAmount = patch.amountCents ?? row.amountCents;
  if (input.allocations !== undefined) {
    // Names already on this row's snapshot stay valid even if they have
    // left the household, so an untouched edit round-trips.
    const allowed = allocationsFromStored(row.allocations, row.amountCents)
      .flatMap((a) => a.splitAmong)
      .filter((n) => !isBuyer(n));
    patch.allocations = checkedAllocations(input.allocations, finalAmount, {
      members: BUYERS,
      mealGroup: await currentMealGroup(),
      allowed,
    });
  } else if (finalAmount !== row.amountCents) {
    // The amount moved but the client didn't re-send the split. A single
    // line can simply be restated at the new total; anything with a real
    // split would be guesswork, so we make the user redo it.
    const current = allocationsFromStored(row.allocations, row.amountCents);
    if (current.length !== 1) {
      throw new ValidationError("Amount changed; re-enter the allocations");
    }
    patch.allocations = [{ ...current[0], amountCents: finalAmount }];
  }

  if (input.store !== undefined || input.occurredOn !== undefined) {
    const newStore =
      input.store !== undefined
        ? optionalText(input.store, "Store", MAX_STORE_LEN)
        : row.store || "";
    const newOccurredOn =
      input.occurredOn !== undefined
        ? validateOccurredOn(input.occurredOn)
        : row.occurredOn || formatDate(row.added);
    patch.store = newStore || null;
    patch.occurredOn = newOccurredOn;
    patch.name = expenseDisplayName(newStore, newOccurredOn);
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError("Nothing to update");
  }
  await db.update(expensesTable).set(patch).where(eq(expensesTable.id, id));
  return listExpensesRepo();
}

export async function deleteExpenseRepo(
  id: string
): Promise<{ expenses: Expense[]; removedReceiptFileId: string | null }> {
  const expenseId = requireId(id);
  const existing = await db
    .select({ receiptFileId: expensesTable.receiptFileId })
    .from(expensesTable)
    .where(eq(expensesTable.id, expenseId))
    .limit(1);
  if (existing.length === 0) throw new NotFoundError();
  const removedReceiptFileId = existing[0].receiptFileId;
  await db.delete(expensesTable).where(eq(expensesTable.id, expenseId));
  return {
    expenses: await listExpensesRepo(),
    removedReceiptFileId,
  };
}

export async function clearExpensesRepo(): Promise<{
  expenses: Expense[];
  removedReceiptFileIds: string[];
}> {
  // Collect any receipts we need to clean up before the rows are gone.
  const rows = await db
    .select({ receiptFileId: expensesTable.receiptFileId })
    .from(expensesTable);
  const removedReceiptFileIds = rows
    .map((r) => r.receiptFileId)
    .filter((id): id is string => Boolean(id));
  await db.delete(expensesTable);
  return { expenses: [], removedReceiptFileIds };
}

/* ---------- Household settings (shared monthly state) ---------- */

export async function getSettingRepo(key: string): Promise<unknown | null> {
  const rows = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, key))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0].value;
}

export async function putSettingRepo(
  key: string,
  value: unknown
): Promise<void> {
  // Last-write-wins. Concurrent edits from two housemates aren't expected
  // to overlap here (rent/utility numbers change rarely), so no need for
  // optimistic concurrency yet.
  await db
    .insert(settingsTable)
    .values({ key, value: value as object })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: value as object, updatedAt: sql`NOW()` },
    });
}

/* ---------- Shared passwords / accounts ---------- */

const VAULT_PREFIX = "vault:v1:";
const MAX_SHARED_FIELDS = 80;
const MAX_SHARED_NAME_LEN = 96;
const MAX_SHARED_LABEL_LEN = 80;
const MAX_SHARED_TEXT_VALUE_LEN = 20000;
const MAX_SHARED_IMAGE_DATA_URL_LEN = 1500000;

let vaultKeyCache: Buffer | null = null;

function getVaultKey(): Buffer {
  if (vaultKeyCache) return vaultKeyCache;
  const secret = process.env.VAULT_SECRET || process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "VAULT_SECRET or AUTH_SECRET must be set to store shared passwords"
    );
  }
  vaultKeyCache = createHash("sha256").update(secret).digest();
  return vaultKeyCache;
}

function encryptVaultValue(value: string): string {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getVaultKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${VAULT_PREFIX}${iv.toString("base64url")}.${tag.toString(
    "base64url"
  )}.${encrypted.toString("base64url")}`;
}

function decryptVaultValue(value: string): string {
  if (!value || !value.startsWith(VAULT_PREFIX)) return value || "";
  const rest = value.slice(VAULT_PREFIX.length);
  const [ivB64, tagB64, encryptedB64] = rest.split(".");
  if (!ivB64 || !tagB64 || !encryptedB64) {
    throw new Error("Shared account field is not a valid encrypted value");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getVaultKey(),
      Buffer.from(ivB64, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedB64, "base64url")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error(
      "Shared account field could not be decrypted. Check VAULT_SECRET/AUTH_SECRET."
    );
  }
}

function formatTimestamp(d: Date | string | null | undefined): string {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function cleanSharedKind(raw: unknown): SharedFieldKind {
  return raw === "password" || raw === "image" ? raw : "text";
}

function cleanSharedFieldId(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (/^[a-zA-Z0-9_-]{6,80}$/.test(s)) return s;
  return randomUUID();
}

function sanitizeSharedAccountName(raw: unknown): string {
  return requireText(raw, "Place / account name", MAX_SHARED_NAME_LEN);
}

function sanitizeSharedAccountFields(raw: unknown): SharedAccountField[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ValidationError("Fields must be an array");
  if (raw.length > MAX_SHARED_FIELDS) {
    throw new ValidationError(`Shared account can have at most ${MAX_SHARED_FIELDS} fields`);
  }

  const out: SharedAccountField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = cleanSharedKind(o.kind);
    const labelRaw = stripControlChars(String(o.label ?? "")).trim();
    const label =
      labelRaw.slice(0, MAX_SHARED_LABEL_LEN) ||
      (kind === "image" ? "Image" : kind === "password" ? "Password" : "Field");
    const value = String(o.value ?? "");

    if (kind === "image") {
      if (value.length > MAX_SHARED_IMAGE_DATA_URL_LEN) {
        throw new ValidationError("Image is too large. Use a smaller photo.");
      }
      if (value && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
        throw new ValidationError("Images must be stored as image data URLs");
      }
    } else if (value.length > MAX_SHARED_TEXT_VALUE_LEN) {
      throw new ValidationError("Field value is too long");
    }

    const field: SharedAccountField = {
      id: cleanSharedFieldId(o.id),
      label,
      kind,
      value,
    };
    const filename = stripControlChars(String(o.filename ?? "")).trim();
    const mimeType = stripControlChars(String(o.mimeType ?? "")).trim();
    if (kind === "image") {
      if (filename) field.filename = filename.slice(0, 180);
      if (mimeType && mimeType.startsWith("image/")) {
        field.mimeType = mimeType.slice(0, 80);
      }
    }
    out.push(field);
  }
  return out;
}

function toStoredSharedFields(
  fields: SharedAccountField[]
): SharedAccountField[] {
  return fields.map((field) => ({
    ...field,
    value: encryptVaultValue(field.value),
  }));
}

function fromStoredSharedFields(raw: unknown): SharedAccountField[] {
  if (!Array.isArray(raw)) return [];
  const out: SharedAccountField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = cleanSharedKind(o.kind);
    const field: SharedAccountField = {
      id: cleanSharedFieldId(o.id),
      label:
        String(o.label ?? "").trim().slice(0, MAX_SHARED_LABEL_LEN) ||
        (kind === "image" ? "Image" : kind === "password" ? "Password" : "Field"),
      kind,
      value: decryptVaultValue(String(o.value ?? "")),
    };
    const filename = String(o.filename ?? "").trim();
    const mimeType = String(o.mimeType ?? "").trim();
    if (kind === "image") {
      if (filename) field.filename = filename;
      if (mimeType) field.mimeType = mimeType;
    }
    out.push(field);
  }
  return out;
}

function fromStoredSharedFieldSummaries(raw: unknown): SharedAccountField[] {
  if (!Array.isArray(raw)) return [];
  const out: SharedAccountField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = cleanSharedKind(o.kind);
    const field: SharedAccountField = {
      id: cleanSharedFieldId(o.id),
      label:
        String(o.label ?? "").trim().slice(0, MAX_SHARED_LABEL_LEN) ||
        (kind === "image" ? "Image" : kind === "password" ? "Password" : "Field"),
      kind,
      value: "",
    };
    const filename = String(o.filename ?? "").trim();
    const mimeType = String(o.mimeType ?? "").trim();
    if (kind === "image") {
      if (filename) field.filename = filename;
      if (mimeType) field.mimeType = mimeType;
    }
    out.push(field);
  }
  return out;
}

function rowToSharedAccount(
  r: typeof sharedAccountsTable.$inferSelect
): SharedAccount {
  return {
    id: r.id,
    name: r.name,
    fields: fromStoredSharedFields(r.fields),
    createdAt: formatTimestamp(r.createdAt),
    updatedAt: formatTimestamp(r.updatedAt),
  };
}

function rowToSharedAccountSummary(
  r: typeof sharedAccountsTable.$inferSelect
): SharedAccount {
  return {
    id: r.id,
    name: r.name,
    fields: fromStoredSharedFieldSummaries(r.fields),
    createdAt: formatTimestamp(r.createdAt),
    updatedAt: formatTimestamp(r.updatedAt),
  };
}

export async function listSharedAccountsRepo(): Promise<SharedAccount[]> {
  const rows = await db.select().from(sharedAccountsTable);
  rows.sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
  return rows.map(rowToSharedAccountSummary);
}

export async function getSharedAccountRepo(id: string): Promise<SharedAccount> {
  const accountId = requireId(id);
  const rows = await db
    .select()
    .from(sharedAccountsTable)
    .where(eq(sharedAccountsTable.id, accountId))
    .limit(1);
  if (rows.length === 0) throw new NotFoundError();
  return rowToSharedAccount(rows[0]);
}

export type AddSharedAccountInput = {
  name: string;
  fields?: unknown;
};

export async function addSharedAccountRepo(
  input: AddSharedAccountInput
): Promise<{ accounts: SharedAccount[]; account: SharedAccount }> {
  const name = sanitizeSharedAccountName(input.name);
  const fields = sanitizeSharedAccountFields(input.fields);
  const [inserted] = await db
    .insert(sharedAccountsTable)
    .values({
      name,
      fields: toStoredSharedFields(fields),
    })
    .returning();
  if (!inserted) throw new Error("Shared account was not created");
  return {
    accounts: await listSharedAccountsRepo(),
    account: rowToSharedAccount(inserted),
  };
}

export type UpdateSharedAccountInput = {
  id: string;
  name?: string;
  fields?: unknown;
};

export async function updateSharedAccountRepo(
  input: UpdateSharedAccountInput
): Promise<SharedAccount[]> {
  const id = requireId(input.id);
  const patch: Partial<typeof sharedAccountsTable.$inferInsert> = {};
  if (input.name !== undefined) {
    patch.name = sanitizeSharedAccountName(input.name);
  }
  if (input.fields !== undefined) {
    patch.fields = toStoredSharedFields(
      sanitizeSharedAccountFields(input.fields)
    );
  }
  const updated = await db
    .update(sharedAccountsTable)
    .set({ ...patch, updatedAt: sql`NOW()` })
    .where(eq(sharedAccountsTable.id, id))
    .returning({ id: sharedAccountsTable.id });
  if (updated.length === 0) throw new NotFoundError();
  return listSharedAccountsRepo();
}

export async function deleteSharedAccountRepo(
  id: string
): Promise<SharedAccount[]> {
  const accountId = requireId(id);
  const deleted = await db
    .delete(sharedAccountsTable)
    .where(eq(sharedAccountsTable.id, accountId))
    .returning({ id: sharedAccountsTable.id });
  if (deleted.length === 0) throw new NotFoundError();
  return listSharedAccountsRepo();
}
