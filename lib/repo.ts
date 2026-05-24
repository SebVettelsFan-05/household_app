import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  categories as categoriesTable,
  favoriteRecipes as favoritesTable,
  groceryItems as groceryTable,
  items as itemsTable,
  recipes as recipesTable,
} from "@/db/schema";
import { thisWeekStart, nextWeekStart } from "./dates";
import type {
  CategoryDef,
  FavoriteRecipe,
  GroceryItem,
  Item,
  Recipe,
  RecipeIngredient,
} from "./types";
import {
  DEFAULT_CATEGORIES,
  FALLBACK_CATEGORY,
  formatDate,
  normalizeName,
  pickCategory,
} from "./normalize";

function rowToItem(r: typeof itemsTable.$inferSelect): Item {
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    expiry: r.expiry || "",
    added: formatDate(r.added),
    category: r.category,
  };
}

function rowToCategory(r: typeof categoriesTable.$inferSelect): CategoryDef {
  return { name: r.name, color: r.color ?? null };
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
    return DEFAULT_CATEGORIES.map((name) => ({ name, color: null }));
  }
  const list = rows.map(rowToCategory);
  // Defensive: ensure fallback is always offered, even if someone deleted it
  // directly in the DB.
  if (!list.some((c) => c.name.toLowerCase() === FALLBACK_CATEGORY.toLowerCase())) {
    list.unshift({ name: FALLBACK_CATEGORY, color: null });
  }
  return list;
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
  if (trimmed.toLowerCase() === FALLBACK_CATEGORY.toLowerCase()) {
    throw new Error(`Cannot delete the fallback category "${FALLBACK_CATEGORY}"`);
  }

  const allItems = await db.select().from(itemsTable);
  const affected = allItems.filter(
    (i) => i.category.toLowerCase() === trimmed.toLowerCase()
  );
  if (affected.length > 0) {
    for (const it of affected) {
      await db
        .update(itemsTable)
        .set({ category: FALLBACK_CATEGORY })
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
  const qty = Number(input.quantity);
  if (!qty || qty <= 0) throw new Error("Quantity must be greater than zero");

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const category = pickCategory(input.category, validCats);
  const expiry = input.expiry ? input.expiry : null;

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
    await db
      .update(itemsTable)
      .set({
        quantity: existing.quantity + qty,
        expiry: mergedExpiry,
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
  });
  return { items: await listItemsRepo(), merged: false };
}

export type UpdateItemInput = AddItemInput & { id: string };

export async function updateItemRepo(input: UpdateItemInput): Promise<Item[]> {
  if (!input.id) throw new Error("id required");
  const trimmedName = String(input.name ?? "").trim();
  if (!trimmedName) throw new Error("Name required");
  const qty = Number(input.quantity);

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const category = pickCategory(input.category, validCats);

  await db
    .update(itemsTable)
    .set({
      name: trimmedName,
      quantity: qty || 0,
      expiry: input.expiry ? input.expiry : null,
      category,
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
    store: r.store || "",
    addedBy: r.addedBy,
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
  store?: string;
  addedBy: string;
};

export async function addGroceryRepo(
  input: AddGroceryInput
): Promise<GroceryItem[]> {
  const trimmedName = String(input.name ?? "").trim();
  if (!trimmedName) throw new Error("Name required");
  const qty = Number(input.quantity);
  if (!qty || qty <= 0) throw new Error("Quantity must be greater than zero");
  const addedBy = String(input.addedBy ?? "").trim();
  if (!addedBy) throw new Error("Added by required");

  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const category = pickCategory(input.category, validCats);
  const store = input.store ? String(input.store).trim() : null;

  await db.insert(groceryTable).values({
    name: trimmedName,
    quantity: qty,
    category,
    store,
    addedBy,
  });
  return listGroceryRepo();
}

export type UpdateGroceryInput = {
  id: string;
  name?: string;
  quantity?: number;
  category?: string;
  store?: string;
  addedBy?: string;
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
    patch.name = trimmed;
  }
  if (input.quantity !== undefined) {
    const qty = Number(input.quantity);
    if (!qty || qty <= 0) throw new Error("Quantity must be greater than zero");
    patch.quantity = qty;
  }
  if (input.category !== undefined) {
    patch.category = pickCategory(input.category, validCats);
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

export async function bulkAddGroceryRepo(
  inputs: Array<{
    name: string;
    quantity: number;
    category?: string;
    store?: string;
    addedBy: string;
  }>
): Promise<GroceryItem[]> {
  if (inputs.length === 0) return listGroceryRepo();
  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  const rows = inputs.map((input) => {
    const name = String(input.name ?? "").trim();
    const qty = Number(input.quantity);
    const addedBy = String(input.addedBy ?? "").trim();
    if (!name) throw new Error("Each ingredient needs a name");
    if (!qty || qty <= 0)
      throw new Error(`Quantity for "${name}" must be > 0`);
    if (!addedBy) throw new Error("Added by required");
    return {
      name,
      quantity: qty,
      category: pickCategory(input.category, validCats),
      store: input.store ? String(input.store).trim() || null : null,
      addedBy,
    };
  });
  await db.insert(groceryTable).values(rows);
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
  };
}

function rowToFavorite(r: typeof favoritesTable.$inferSelect): FavoriteRecipe {
  return {
    id: r.id,
    name: r.name,
    link: r.link || "",
    description: r.description || "",
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
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

export type AddRecipeInput = {
  weekStart: string;
  day: number;
  assignedTo: string;
  name: string;
  link?: string;
  description?: string;
  ingredients?: unknown;
};

function validateRecipeBase(input: AddRecipeInput) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Recipe name required");
  const assignedTo = String(input.assignedTo ?? "").trim();
  if (!assignedTo) throw new Error("Assigned cook required");
  if (typeof input.day !== "number" || input.day < 0 || input.day > 4) {
    throw new Error("Day must be Sunday through Thursday (0–4)");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.weekStart))) {
    throw new Error("weekStart must be YYYY-MM-DD");
  }
  return { name, assignedTo };
}

export async function addRecipeRepo(
  input: AddRecipeInput
): Promise<Recipe[]> {
  const { name, assignedTo } = validateRecipeBase(input);
  const validCats = (await listCategoriesRepo()).map((c) => c.name);
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
  });
  return listRecipesRepo();
}

export type UpdateRecipeInput = Partial<AddRecipeInput> & { id: string };

export async function updateRecipeRepo(
  input: UpdateRecipeInput
): Promise<Recipe[]> {
  if (!input.id) throw new Error("id required");
  const validCats = (await listCategoriesRepo()).map((c) => c.name);

  const patch: Partial<typeof recipesTable.$inferInsert> = {};
  if (input.name !== undefined) {
    const t = String(input.name).trim();
    if (!t) throw new Error("Recipe name required");
    patch.name = t;
  }
  if (input.assignedTo !== undefined) {
    const t = String(input.assignedTo).trim();
    if (!t) throw new Error("Assigned cook required");
    patch.assignedTo = t;
  }
  if (input.day !== undefined) {
    if (input.day < 0 || input.day > 4)
      throw new Error("Day must be 0–4 (Sun–Thu)");
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
}): Promise<FavoriteRecipe[]> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Name required");
  const validCats = (await listCategoriesRepo()).map((c) => c.name);
  await db.insert(favoritesTable).values({
    name,
    link: input.link ? String(input.link).trim() || null : null,
    description: input.description
      ? String(input.description).trim() || null
      : null,
    ingredients: sanitizeIngredients(input.ingredients, validCats),
  });
  return listFavoritesRepo();
}

export async function deleteFavoriteRepo(id: string): Promise<FavoriteRecipe[]> {
  if (!id) throw new Error("id required");
  await db.delete(favoritesTable).where(eq(favoritesTable.id, id));
  return listFavoritesRepo();
}
