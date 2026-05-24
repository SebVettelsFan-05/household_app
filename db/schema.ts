import {
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
});

export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
export type CategoryRow = typeof categories.$inferSelect;
