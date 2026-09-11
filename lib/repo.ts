import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/db/client";
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
import { thisWeekStart, nextWeekStart } from "./dates";
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
import { allocationsFromStored, normalizeAllocations } from "./allocations";
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
  if (!isBuyer(owner)) throw new Error(`Unknown household member: ${owner}`);
  return owner;
}

/** Dormant like `owner`: stored, never used to scope anything. */
function validatePool(input: string | undefined): GroceryPool {
  const pool = String(input ?? "").trim() || "house";
  if (!(GROCERY_POOLS as readonly string[]).includes(pool)) {
    throw new Error(`Pool must be one of ${GROCERY_POOLS.join(", ")}`);
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
  if (!match) throw new Error("Choose a valid category");
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
    throw new Error(
      `${label} must be a whole number between 1 and ${MAX_POSTGRES_INTEGER}`
    );
  }
  return quantity;
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
    throw new Error("Color must be a 6-digit hex like #RRGGBB");
  }
  return color.toLowerCase();
}

export async function addCategoryRepo(
  name: string,
  color?: string | null
): Promise<{ categories: CategoryDef[]; existed: boolean }> {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("Name required");
  if (trimmed.length > 32) throw new Error("Name is too long");
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
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("Name required");
  const validatedColor = validateColor(color);
  await db
    .update(categoriesTable)
    .set({ color: validatedColor })
    .where(eq(categoriesTable.name, trimmed));
  return listCategoriesRepo();
}

export async function deleteCategoryRepo(
  name: string
): Promise<{ categories: CategoryDef[]; items: Item[]; reassigned: number }> {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("Name required");
  if (isProtectedCategory(trimmed)) {
    throw new Error(`Cannot delete the default category "${trimmed}"`);
  }

  const allItems = await db.select().from(itemsTable);
  const affected = allItems.filter(
    (i) => i.category.toLowerCase() === trimmed.toLowerCase()
  );
  if (affected.length > 0) {
    for (const it of affected) {
      await db
        .update(itemsTable)
        .set({
          category: FALLBACK_CATEGORY,
          categoryReviewed: false,
        })
        .where(eq(itemsTable.id, it.id));
    }
  }

  await db.delete(categoriesTable).where(eq(categoriesTable.name, trimmed));

  const [categories, items] = await Promise.all([
    listCategoriesRepo(),
    listItemsRepo(),
  ]);
  return { categories, items, reassigned: affected.length };
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
  const trimmedName = String(input.name ?? "").trim();
  if (!trimmedName) throw new Error("Name required");
  const qty = requirePositiveIntegerQuantity(input.quantity);

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const category = input.categoryReviewed
    ? requireValidCategory(input.category, validCats)
    : pickCategory(input.category, validCats);
  const expiry = input.expiry ? input.expiry : null;
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
        quantity: existing.quantity + qty,
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
  if (!input.id) throw new Error("id required");
  const trimmedName = String(input.name ?? "").trim();
  if (!trimmedName) throw new Error("Name required");
  // Same rule as add — an edit must not be able to park a 0 or fractional
  // quantity on a row that add would have rejected.
  const qty = requirePositiveIntegerQuantity(input.quantity);

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const category = input.categoryReviewed
    ? requireValidCategory(input.category, validCats)
    : pickCategory(input.category, validCats);

  await db
    .update(itemsTable)
    .set({
      name: trimmedName,
      quantity: qty,
      expiry: input.expiry ? input.expiry : null,
      category,
      ...(input.categoryReviewed !== undefined
        ? { categoryReviewed: input.categoryReviewed === true }
        : {}),
      ...(input.owner !== undefined
        ? { owner: validateOwner(input.owner) || null }
        : {}),
    })
    .where(eq(itemsTable.id, input.id));

  return listItemsRepo();
}

export async function deleteItemRepo(id: string): Promise<Item[]> {
  if (!id) throw new Error("id required");
  await db.delete(itemsTable).where(eq(itemsTable.id, id));
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
  const trimmedName = String(input.name ?? "").trim();
  if (!trimmedName) throw new Error("Name required");
  const qty = requirePositiveIntegerQuantity(input.quantity);
  const addedBy = String(input.addedBy ?? "").trim();
  if (!addedBy) throw new Error("Added by required");

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const category = input.categoryReviewed
    ? requireValidCategory(input.category, validCats)
    : pickCategory(input.category, validCats);
  const store = input.store ? String(input.store).trim() : null;
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
        quantity: existing.quantity + qty,
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
  if (!input.id) throw new Error("id required");

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const patch: Partial<typeof groceryTable.$inferInsert> = {};

  if (input.name !== undefined) {
    const trimmed = String(input.name).trim();
    if (!trimmed) throw new Error("Name required");
    patch.name = titleCaseName(trimmed);
  }
  if (input.quantity !== undefined) {
    const qty = requirePositiveIntegerQuantity(input.quantity);
    patch.quantity = qty;
  }
  if (input.category !== undefined) {
    patch.category = pickCategory(input.category, validCats);
    if (input.categoryReviewed !== undefined) {
      patch.categoryReviewed = input.categoryReviewed === true;
    }
  }
  if (input.store !== undefined) {
    const s = String(input.store).trim();
    patch.store = s || null;
  }
  if (input.addedBy !== undefined) {
    const a = String(input.addedBy).trim();
    if (!a) throw new Error("Added by required");
    patch.addedBy = a;
  }
  if (input.pool !== undefined) {
    patch.pool = validatePool(input.pool);
  }
  if (input.done !== undefined) {
    patch.done = !!input.done;
  }

  await db.update(groceryTable).set(patch).where(eq(groceryTable.id, input.id));
  return listGroceryRepo();
}

export async function deleteGroceryRepo(id: string): Promise<GroceryItem[]> {
  if (!id) throw new Error("id required");
  await db.delete(groceryTable).where(eq(groceryTable.id, id));
  return listGroceryRepo();
}

export async function clearGroceryRepo(): Promise<GroceryItem[]> {
  await db.delete(groceryTable);
  return [];
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

  // Cache existing inventory by normalized name so consecutive moves merge
  // into the same row instead of inserting duplicates.
  const byNorm = new Map<string, typeof itemsTable.$inferSelect>();
  for (const r of inventoryRows) byNorm.set(normalizeName(r.name), r);

  for (const g of done) {
    const name = String(g.name ?? "").trim();
    if (!name) continue;
    const category = pickCategory(g.category, validCats);
    const groceryCategoryValid = validCats.some(
      (valid) => valid.toLowerCase() === g.category.toLowerCase()
    );
    const categoryReviewed = g.categoryReviewed && groceryCategoryValid;
    const norm = normalizeName(name);
    const existing = byNorm.get(norm);
    if (existing) {
      const nextQty = existing.quantity + (g.quantity || 0);
      const replaceCategory = shouldReplaceStoredCategory(
        existing.category,
        existing.categoryReviewed,
        category,
        categoryReviewed,
        validCats
      );
      await db
        .update(itemsTable)
        .set({
          quantity: nextQty,
          ...(replaceCategory ? { category, categoryReviewed } : {}),
        })
        .where(eq(itemsTable.id, existing.id));
      existing.quantity = nextQty;
      if (replaceCategory) {
        existing.category = category;
        existing.categoryReviewed = categoryReviewed;
      }
    } else {
      const [inserted] = await db
        .insert(itemsTable)
        .values({
          name,
          quantity: g.quantity || 0,
          // Inventory items don't currently carry store/addedBy/owner.
          category,
          categoryReviewed,
        })
        .returning();
      if (inserted) byNorm.set(norm, inserted);
    }
  }

  // Drop the moved grocery rows after inventory writes succeed, so a
  // partial failure leaves the user with both lists rather than nothing.
  await db
    .delete(groceryTable)
    .where(
      inArray(
        groceryTable.id,
        done.map((d) => d.id)
      )
    );

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
    const rawName = String(input.name ?? "").trim();
    const quantity = requirePositiveIntegerQuantity(
      input.quantity,
      `Quantity for "${rawName || "ingredient"}"`
    );
    const addedBy = String(input.addedBy ?? "").trim();
    if (!rawName) throw new Error("Each ingredient needs a name");
    if (!addedBy) throw new Error("Added by required");
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
      store: input.store ? String(input.store).trim() || null : null,
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
    existing.quantity = requirePositiveIntegerQuantity(
      existing.quantity + row.quantity,
      `Combined quantity for "${row.name}"`
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
    target.quantity = requirePositiveIntegerQuantity(
      target.quantity + input.quantity,
      `Combined quantity for "${input.name}"`
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

  const writes: BatchItem<"pg">[] = [];
  for (const target of openRows) {
    if (!target.changed) continue;
    writes.push(
      db
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
    writes.push(db.insert(groceryTable).values(toInsert));
  }
  if (writes.length > 0) {
    // `batch` only exists on the neon-http driver (it runs the statements
    // in one round trip / transaction). The local node-postgres driver used
    // for dev and smoke tests has no batch, so fall back to sequential
    // awaits there.
    const batchable = db as unknown as {
      batch?: (items: [BatchItem<"pg">, ...BatchItem<"pg">[]]) => Promise<unknown>;
    };
    if (typeof batchable.batch === "function") {
      await batchable.batch(
        writes as [BatchItem<"pg">, ...BatchItem<"pg">[]]
      );
    } else {
      for (const w of writes) await w;
    }
  }
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
    const name = String(o.name ?? "").trim();
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
    throw new Error(`${label} must be a whole number of 0 or more`);
  }
  return n === 0 ? null : n;
}

function validateRecipeSlot(input: {
  day?: number;
  weekStart?: string;
}) {
  if (typeof input.day !== "number" || input.day < 0 || input.day > 6) {
    throw new Error("Day must be Sunday through Saturday (0-6)");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.weekStart))) {
    throw new Error("weekStart must be YYYY-MM-DD");
  }
}

function validateRecipeBase(input: AddRecipeInput) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Recipe name required");
  const assignedTo = String(input.assignedTo ?? "").trim();
  if (!assignedTo) throw new Error("Assigned cook required");
  validateRecipeSlot(input);
  return { name, assignedTo };
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
      throw new Error("That day already has a recipe");
    }
    if (sameSlot.some((r) => r.noMeal)) return listRecipesRepo();
    await db.insert(recipesTable).values({
      weekStart: input.weekStart,
      day: input.day,
      assignedTo: "",
      name: "",
      link: null,
      description: input.description
        ? String(input.description).trim() || null
        : null,
      ingredients: [],
      servings: null,
      portions: null,
      noMeal: true,
    });
    return listRecipesRepo();
  }

  const { name, assignedTo } = validateRecipeBase(input);
  // A day holds one recipe. Filling a day that was marked "no meal"
  // replaces the marker.
  const sameSlot = await recipesInSlot(input);
  if (sameSlot.some((r) => !r.noMeal)) {
    throw new Error("That day already has a recipe");
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
  await db.insert(recipesTable).values({
    weekStart: input.weekStart,
    day: input.day,
    assignedTo,
    name,
    link: input.link ? String(input.link).trim() || null : null,
    description: input.description
      ? String(input.description).trim() || null
      : null,
    ingredients: sanitizeIngredients(input.ingredients, validCats),
    servings: validateRecipeCount(input.servings, "Servings"),
    portions: validateRecipeCount(input.portions, "Portions"),
    noMeal: false,
  });
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
  if (!input.id) throw new Error("id required");
  const validCats = (await listCategoriesRepo()).map((c) => c.name);

  // A "no meal" marker has no name or cook, so those requirements are lifted
  // when the patch is turning the row into one.
  const makingMarker = input.noMeal === true;
  const patch: Partial<typeof recipesTable.$inferInsert> = {};
  if (input.name !== undefined && !makingMarker) {
    const t = String(input.name).trim();
    if (!t) throw new Error("Recipe name required");
    patch.name = t;
  }
  if (input.assignedTo !== undefined && !makingMarker) {
    const t = String(input.assignedTo).trim();
    if (!t) throw new Error("Assigned cook required");
    patch.assignedTo = t;
  }
  if (input.day !== undefined) {
    if (input.day < 0 || input.day > 6)
      throw new Error("Day must be Sunday through Saturday (0-6)");
    patch.day = input.day;
  }
  if (input.weekStart !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.weekStart))
      throw new Error("weekStart must be YYYY-MM-DD");
    patch.weekStart = input.weekStart;
  }
  if (input.link !== undefined) {
    const s = String(input.link).trim();
    patch.link = s || null;
  }
  if (input.description !== undefined) {
    const s = String(input.description).trim();
    patch.description = s || null;
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
    .where(eq(recipesTable.id, input.id))
    .limit(1);
  if (existingRows.length === 0) throw new Error("Recipe not found");
  const merged = { ...existingRows[0], ...patch };
  if (!merged.noMeal) {
    if (!String(merged.name ?? "").trim()) throw new Error("Recipe name required");
    if (!String(merged.assignedTo ?? "").trim()) throw new Error("Assigned cook required");
  }
  const moving =
    (patch.day !== undefined && patch.day !== existingRows[0].day) ||
    (patch.weekStart !== undefined && patch.weekStart !== existingRows[0].weekStart) ||
    (patch.noMeal !== undefined && patch.noMeal !== existingRows[0].noMeal);
  if (moving) {
    const others = (
      await recipesInSlot({ weekStart: merged.weekStart, day: merged.day })
    ).filter((r) => r.id !== input.id);
    if (merged.noMeal) {
      if (others.some((r) => !r.noMeal)) throw new Error("That day already has a recipe");
      if (others.length > 0) {
        // Already marked; drop this row instead of keeping two markers.
        await db.delete(recipesTable).where(eq(recipesTable.id, input.id));
        return listRecipesRepo();
      }
    } else {
      if (others.some((r) => !r.noMeal)) throw new Error("That day already has a recipe");
      const markers = others.filter((r) => r.noMeal);
      if (markers.length > 0) {
        await db.delete(recipesTable).where(inArray(recipesTable.id, markers.map((m) => m.id)));
      }
    }
  }

  await db.update(recipesTable).set(patch).where(eq(recipesTable.id, input.id));
  return listRecipesRepo();
}

export async function deleteRecipeRepo(id: string): Promise<Recipe[]> {
  if (!id) throw new Error("id required");
  await db.delete(recipesTable).where(eq(recipesTable.id, id));
  return listRecipesRepo();
}

/* ---------- Favorites ---------- */

export async function listFavoritesRepo(): Promise<FavoriteRecipe[]> {
  const rows = await db.select().from(favoritesTable);
  return rows.map(rowToFavorite);
}

export async function addFavoriteRepo(input: {
  name: string;
  link?: string;
  description?: string;
  ingredients?: unknown;
  servings?: number;
}): Promise<{ favorites: FavoriteRecipe[]; existed: boolean }> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Name required");
  const link = input.link ? String(input.link).trim() : "";
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
    return { favorites: existing, existed: true };
  }

  await db.insert(favoritesTable).values({
    name,
    link: link || null,
    description: input.description
      ? String(input.description).trim() || null
      : null,
    ingredients: sanitizeIngredients(input.ingredients, validCats),
    // A favorite that never learned its base servings just stores null.
    servings:
      Number.isInteger(Number(input.servings)) && Number(input.servings) > 0
        ? Number(input.servings)
        : null,
  });
  return { favorites: await listFavoritesRepo(), existed: false };
}

export async function deleteFavoriteRepo(id: string): Promise<FavoriteRecipe[]> {
  if (!id) throw new Error("id required");
  await db.delete(favoritesTable).where(eq(favoritesTable.id, id));
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
    throw new Error("Color must be a 6-digit hex like #RRGGBB");
  }
  return color.toLowerCase();
}

export async function addExpenseCategoryRepo(
  name: string,
  color?: string | null
): Promise<{ expenseCategories: ExpenseCategoryDef[]; existed: boolean }> {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("Name required");
  if (trimmed.length > 32) throw new Error("Name is too long");
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
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("Name required");
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
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("Name required");
  if (trimmed.toLowerCase() === EXPENSE_FALLBACK.toLowerCase()) {
    throw new Error(
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

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function validateOccurredOn(input: string | undefined): string {
  const s = String(input ?? "").trim();
  if (!s) return todayYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error("Date must be YYYY-MM-DD");
  }
  return s;
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

/** The payer has to be a household member, or settlement silently drops them. */
function validatePaidBy(input: string | undefined): string {
  const paidBy = String(input ?? "").trim();
  if (!paidBy) throw new Error("Paid by required");
  if (!isBuyer(paidBy)) {
    throw new Error(`"${paidBy}" is not a household member`);
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
    throw new Error("Amount must be greater than zero");
  }
  const paidBy = validatePaidBy(input.paidBy);
  // Re-checked here rather than trusted: the repo is the last gate before
  // storage, and a stored expense whose lines don't sum breaks settlement.
  const allocations = normalizeAllocations(input.allocations, amountCents, {
    members: BUYERS,
    mealGroup: await currentMealGroup(),
  });

  const store = input.store ? String(input.store).trim() : "";
  const description = input.description
    ? String(input.description).trim()
    : "";
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
  if (!input.id) throw new Error("id required");
  const patch: Partial<typeof expensesTable.$inferInsert> = {};

  if (input.amountCents !== undefined) {
    const cents = Math.round(Number(input.amountCents));
    if (!Number.isFinite(cents) || cents <= 0) {
      throw new Error("Amount must be greater than zero");
    }
    patch.amountCents = cents;
  }
  if (input.paidBy !== undefined) {
    patch.paidBy = validatePaidBy(input.paidBy);
  }
  if (input.description !== undefined) {
    const d = String(input.description).trim();
    patch.description = d || null;
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
  // current row, so fetch it once.
  const needsRow =
    input.store !== undefined ||
    input.occurredOn !== undefined ||
    input.allocations !== undefined ||
    input.amountCents !== undefined;
  let row: typeof expensesTable.$inferSelect | null = null;
  if (needsRow) {
    const existing = await db
      .select()
      .from(expensesTable)
      .where(eq(expensesTable.id, input.id))
      .limit(1);
    if (existing.length === 0) throw new Error("Expense not found");
    row = existing[0];
  }

  if (row) {
    const finalAmount = patch.amountCents ?? row.amountCents;
    if (input.allocations !== undefined) {
      // Names already on this row's snapshot stay valid even if they have
      // left the household, so an untouched edit round-trips.
      const allowed = allocationsFromStored(row.allocations, row.amountCents)
        .flatMap((a) => a.splitAmong)
        .filter((n) => !isBuyer(n));
      patch.allocations = normalizeAllocations(input.allocations, finalAmount, {
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
        throw new Error("Amount changed; re-enter the allocations");
      }
      patch.allocations = [{ ...current[0], amountCents: finalAmount }];
    }
  }

  if (row && (input.store !== undefined || input.occurredOn !== undefined)) {
    const newStore =
      input.store !== undefined
        ? String(input.store).trim()
        : row.store || "";
    const newOccurredOn =
      input.occurredOn !== undefined
        ? validateOccurredOn(input.occurredOn)
        : row.occurredOn || formatDate(row.added);
    patch.store = newStore || null;
    patch.occurredOn = newOccurredOn;
    patch.name = expenseDisplayName(newStore, newOccurredOn);
  }

  await db.update(expensesTable).set(patch).where(eq(expensesTable.id, input.id));
  return listExpensesRepo();
}

export async function deleteExpenseRepo(
  id: string
): Promise<{ expenses: Expense[]; removedReceiptFileId: string | null }> {
  if (!id) throw new Error("id required");
  const existing = await db
    .select({ receiptFileId: expensesTable.receiptFileId })
    .from(expensesTable)
    .where(eq(expensesTable.id, id))
    .limit(1);
  const removedReceiptFileId =
    existing.length > 0 ? existing[0].receiptFileId : null;
  await db.delete(expensesTable).where(eq(expensesTable.id, id));
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
  const name = String(raw ?? "").trim();
  if (!name) throw new Error("Place / account name required");
  if (name.length > MAX_SHARED_NAME_LEN) {
    throw new Error("Place / account name is too long");
  }
  return name;
}

function sanitizeSharedAccountFields(raw: unknown): SharedAccountField[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("Fields must be an array");
  if (raw.length > MAX_SHARED_FIELDS) {
    throw new Error(`Shared account can have at most ${MAX_SHARED_FIELDS} fields`);
  }

  const out: SharedAccountField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = cleanSharedKind(o.kind);
    const labelRaw = String(o.label ?? "").trim();
    const label =
      labelRaw.slice(0, MAX_SHARED_LABEL_LEN) ||
      (kind === "image" ? "Image" : kind === "password" ? "Password" : "Field");
    const value = String(o.value ?? "");

    if (kind === "image") {
      if (value.length > MAX_SHARED_IMAGE_DATA_URL_LEN) {
        throw new Error("Image is too large. Use a smaller photo.");
      }
      if (value && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
        throw new Error("Images must be stored as image data URLs");
      }
    } else if (value.length > MAX_SHARED_TEXT_VALUE_LEN) {
      throw new Error("Field value is too long");
    }

    const field: SharedAccountField = {
      id: cleanSharedFieldId(o.id),
      label,
      kind,
      value,
    };
    const filename = String(o.filename ?? "").trim();
    const mimeType = String(o.mimeType ?? "").trim();
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
  if (!id) throw new Error("id required");
  const rows = await db
    .select()
    .from(sharedAccountsTable)
    .where(eq(sharedAccountsTable.id, id))
    .limit(1);
  if (rows.length === 0) throw new Error("Shared account not found");
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
  if (!input.id) throw new Error("id required");
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
    .where(eq(sharedAccountsTable.id, input.id))
    .returning({ id: sharedAccountsTable.id });
  if (updated.length === 0) throw new Error("Shared account not found");
  return listSharedAccountsRepo();
}

export async function deleteSharedAccountRepo(
  id: string
): Promise<SharedAccount[]> {
  if (!id) throw new Error("id required");
  const deleted = await db
    .delete(sharedAccountsTable)
    .where(eq(sharedAccountsTable.id, id))
    .returning({ id: sharedAccountsTable.id });
  if (deleted.length === 0) throw new Error("Shared account not found");
  return listSharedAccountsRepo();
}
