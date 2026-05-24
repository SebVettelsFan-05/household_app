import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { categories as categoriesTable, items as itemsTable } from "@/db/schema";
import { DEFAULT_CATEGORIES } from "@/lib/normalize";

export const dynamic = "force-dynamic";

// Idempotent table creation — avoids needing to run drizzle-kit push separately.
async function ensureTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      expiry DATE,
      added TIMESTAMP NOT NULL DEFAULT NOW(),
      category TEXT NOT NULL DEFAULT 'Other'
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY
    )
  `);
}

/**
 * One-shot import from the existing Google Sheet into Postgres. Safe to hit
 * multiple times — refuses to run if the items table already has rows, so it
 * can't accidentally double-import or overwrite later state.
 *
 * Exposed as both GET and POST so you can just click the URL in a browser
 * the first time. After it succeeds once, leave it alone — the app reads and
 * writes Postgres directly from then on.
 */
async function runSeed() {
  const gasUrl = process.env.GAS_API_URL;
  if (!gasUrl) {
    return {
      ok: false as const,
      error: "GAS_API_URL is not set; nothing to import from.",
    };
  }

  await ensureTables();

  const existing = await db.select({ id: itemsTable.id }).from(itemsTable).limit(1);
  if (existing.length > 0) {
    return {
      ok: false as const,
      error: "Database already contains items. Refusing to overwrite.",
    };
  }

  const [itemsRes, catsRes] = await Promise.all([
    fetch(`${gasUrl}?action=list`, { cache: "no-store", redirect: "follow" }),
    fetch(`${gasUrl}?action=listCategories`, {
      cache: "no-store",
      redirect: "follow",
    }),
  ]);
  const itemsData = (await itemsRes.json()) as
    | {
        ok: true;
        items: {
          id: string;
          name: string;
          quantity: number;
          expiry: string;
          added: string;
          category: string;
        }[];
      }
    | { ok: false; error: string };
  if (!itemsData.ok) {
    return { ok: false as const, error: "Sheet read failed: " + itemsData.error };
  }
  const catsData = (await catsRes.json().catch(() => null)) as
    | { ok: true; categories: string[] }
    | { ok: false; error: string }
    | null;
  const cats =
    catsData && catsData.ok ? catsData.categories : DEFAULT_CATEGORIES.slice();

  // Seed categories first so item.category FK assumptions hold conceptually.
  if (cats.length > 0) {
    await db
      .insert(categoriesTable)
      .values(cats.map((name) => ({ name })))
      .onConflictDoNothing();
  }

  // Seed items. Preserve the existing UUIDs so the sheet mirror stays
  // referentially consistent with what the user already saw.
  if (itemsData.items.length > 0) {
    const rows = itemsData.items.map((it) => ({
      id: it.id,
      name: it.name,
      quantity: it.quantity,
      expiry: it.expiry || null,
      added: it.added ? new Date(it.added + "T00:00:00") : new Date(),
      category: it.category || "Other",
    }));
    await db.insert(itemsTable).values(rows);
  }

  return {
    ok: true as const,
    itemsImported: itemsData.items.length,
    categoriesImported: cats.length,
  };
}

export async function GET() {
  const result = await runSeed();
  return NextResponse.json(result);
}

export async function POST() {
  const result = await runSeed();
  return NextResponse.json(result);
}
