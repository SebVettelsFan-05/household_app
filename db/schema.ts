import {
  boolean,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(),
  // Stored as DATE (no time component) — matches the original sheet behavior.
  expiry: date("expiry"),
  // Timestamp (not date) so same-day inserts keep their relative order.
  added: timestamp("added", { withTimezone: false }).notNull().defaultNow(),
  category: text("category").notNull().default("Other"),
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
  // Nullable — store is optional.
  store: text("store"),
  // Required — one of the household members.
  addedBy: text("added_by").notNull(),
  done: boolean("done").notNull().default(false),
  added: timestamp("added", { withTimezone: false }).notNull().defaultNow(),
});

export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
export type CategoryRow = typeof categories.$inferSelect;
export type GroceryRow = typeof groceryItems.$inferSelect;
export type NewGroceryRow = typeof groceryItems.$inferInsert;
