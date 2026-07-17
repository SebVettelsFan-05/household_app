import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Idempotent schema bootstrap.
 *
 * Runs every CREATE/ALTER as IF NOT EXISTS so it's safe to call repeatedly.
 * Cached per process: the first caller awaits the actual DDL; everyone else
 * (within the same warm function instance) awaits the same resolved promise.
 *
 * Call this at the top of any API route that touches the DB — that way the
 * routes don't race each other on the first request to a cold deployment.
 */
let initPromise: Promise<void> | null = null;

export function ensureTables(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        expiry DATE,
        added TIMESTAMP NOT NULL DEFAULT NOW(),
        category TEXT NOT NULL DEFAULT 'Other',
        category_reviewed BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
    await db.execute(sql`
      ALTER TABLE items
      ADD COLUMN IF NOT EXISTS category_reviewed BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS categories (
        name TEXT PRIMARY KEY
      )
    `);
    await db.execute(sql`
      ALTER TABLE categories ADD COLUMN IF NOT EXISTS color TEXT
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS grocery_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'Other',
        category_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
        store TEXT,
        added_by TEXT NOT NULL,
        done BOOLEAN NOT NULL DEFAULT FALSE,
        added TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      ALTER TABLE grocery_items
      ADD COLUMN IF NOT EXISTS category_reviewed BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recipes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        week_start DATE NOT NULL,
        day INTEGER NOT NULL,
        assigned_to TEXT NOT NULL,
        name TEXT NOT NULL,
        link TEXT,
        description TEXT,
        ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS favorite_recipes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        link TEXT,
        description TEXT,
        ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS expense_categories (
        name TEXT PRIMARY KEY,
        color TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'Misc',
        store TEXT,
        paid_by TEXT NOT NULL,
        added TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS occurred_on DATE
    `);
    await db.execute(sql`
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS description TEXT
    `);
    await db.execute(sql`
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT
    `);
    await db.execute(sql`
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_file_id TEXT
    `);
    await db.execute(sql`
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_mime TEXT
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS household_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS shared_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  })().catch((err) => {
    // If the bootstrap itself failed, clear the cache so the next request
    // gets to retry — otherwise we'd permanently 500 on a transient outage.
    initPromise = null;
    throw err;
  });
  return initPromise;
}
