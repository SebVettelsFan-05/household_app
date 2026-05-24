import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { categories as categoriesTable, items as itemsTable } from "@/db/schema";
import type { CategoryDef, Item } from "./types";
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
