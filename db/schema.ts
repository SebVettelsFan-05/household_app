import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { ExpenseAllocation } from "@/lib/types";

export type IngredientJson = {
  name: string;
  quantity: number;
  category: string;
  categoryReviewed?: boolean;
};

export type SharedAccountFieldJson = {
  id: string;
  label: string;
  kind: "text" | "password" | "image";
  value: string;
  filename?: string;
  mimeType?: string;
};

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(),
  // Stored as DATE (no time component) — matches the original sheet behavior.
  expiry: date("expiry"),
  // Timestamp (not date) so same-day inserts keep their relative order.
  added: timestamp("added", { withTimezone: false }).notNull().defaultNow(),
  category: text("category").notNull().default("Other"),
  // True only after somebody explicitly confirms/changes the category. This
  // lets auto-suggest learn corrections without treating old guesses as fact.
  categoryReviewed: boolean("category_reviewed").notNull().default(false),
  // Member name when the item belongs to one person; null/"" means shared.
  owner: text("owner"),
});

export const categories = pgTable("categories", {
  name: text("name").primaryKey(),
  // Nullable: null means "use the auto-assigned palette color".
  color: text("color"),
});

export const groceryItems = pgTable("grocery_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(),
  category: text("category").notNull().default("Other"),
  categoryReviewed: boolean("category_reviewed").notNull().default(false),
  // Nullable — store is optional.
  store: text("store"),
  // Required — one of the household members.
  addedBy: text("added_by").notNull(),
  // "house" | "meals" | "personal" — which pool the request belongs to.
  // Scopes the merge-on-add and decides the owner when the row moves into
  // inventory. See docs/SHARED_KITCHEN.md.
  pool: text("pool").notNull().default("house"),
  done: boolean("done").notNull().default(false),
  added: timestamp("added", { withTimezone: false }).notNull().defaultNow(),
});

export const recipes = pgTable("recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Sunday of the week this recipe belongs to (yyyy-mm-dd).
  weekStart: date("week_start").notNull(),
  // 0 = Sunday through 6 = Saturday.
  day: integer("day").notNull(),
  assignedTo: text("assigned_to").notNull(),
  name: text("name").notNull(),
  link: text("link"),
  description: text("description"),
  ingredients: jsonb("ingredients").$type<IngredientJson[]>().notNull().default([]),
  // Base servings the ingredient grams were written for.
  servings: integer("servings"),
  // How many portions are being cooked this time.
  portions: integer("portions"),
  // Marks a day with no shared dinner — name/cook/ingredients stay empty.
  noMeal: boolean("no_meal").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
});

export const favoriteRecipes = pgTable("favorite_recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  link: text("link"),
  description: text("description"),
  ingredients: jsonb("ingredients").$type<IngredientJson[]>().notNull().default([]),
  servings: integer("servings"),
  createdAt: timestamp("created_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
});

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Auto-derived display label ("Costco May 26") — kept on the row so the
  // sheet mirror stays simple and reads/exports without recomputation.
  name: text("name").notNull(),
  // Stored as integer cents — avoids floating-point surprises in totals.
  amountCents: integer("amount_cents").notNull(),
  // Kept on the schema for backwards compatibility with older rows. New
  // expenses no longer expose a category in the UI; everything is "Misc".
  category: text("category").notNull().default("Misc"),
  store: text("store"),
  paidBy: text("paid_by").notNull(),
  // One line per "how much, and who for". NULL on legacy rows, which read
  // back as a single house line over everyone. See docs/SHARED_KITCHEN.md.
  allocations: jsonb("allocations").$type<ExpenseAllocation[]>(),
  // Date the expense occurred on. The user picks this; defaults to today.
  // Distinct from `added`, which is the row creation timestamp.
  occurredOn: date("occurred_on"),
  // Optional free-text description ("Gas", "Pizza", etc.). Shown beside the
  // store name in the monthly breakdown and used as a secondary grouping
  // key, so "Costco" and "Costco (Gas)" tally separately.
  description: text("description"),
  // Receipt attachment — uploaded to Drive (via the existing GAS webhook).
  // Mandatory at ADD time, optional on existing legacy rows. All three null
  // means "no receipt on file yet"; all three set means we can render a
  // thumbnail link and clean up the file when the row is deleted.
  receiptUrl: text("receipt_url"),
  receiptFileId: text("receipt_file_id"),
  receiptMime: text("receipt_mime"),
  added: timestamp("added", { withTimezone: false }).notNull().defaultNow(),
});

export const expenseCategories = pgTable("expense_categories", {
  name: text("name").primaryKey(),
  color: text("color"),
});

// Shared household state that's NOT per-row — currently rent allocations and
// recurring (fixed + variable) bills. Previously these lived in each user's
// localStorage which meant a new device or a second housemate saw a blank
// monthly breakdown. Single row per key, value is opaque JSON to the server.
export const householdSettings = pgTable("household_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
});

export const sharedAccounts = pgTable("shared_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  fields: jsonb("fields").$type<SharedAccountFieldJson[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
});

export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
export type CategoryRow = typeof categories.$inferSelect;
export type GroceryRow = typeof groceryItems.$inferSelect;
export type NewGroceryRow = typeof groceryItems.$inferInsert;
export type RecipeRow = typeof recipes.$inferSelect;
export type NewRecipeRow = typeof recipes.$inferInsert;
export type FavoriteRow = typeof favoriteRecipes.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;
export type NewExpenseRow = typeof expenses.$inferInsert;
export type ExpenseCategoryRow = typeof expenseCategories.$inferSelect;
export type SharedAccountRow = typeof sharedAccounts.$inferSelect;
export type NewSharedAccountRow = typeof sharedAccounts.$inferInsert;
