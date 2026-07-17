/**
 * One-shot import from the Google Sheet into Postgres.
 *
 * Run with:   npm run seed-from-sheet
 *
 * Refuses to run if the items table already has rows, so it's safe to invoke
 * by accident. Reads via the existing Apps Script /exec endpoint, so the
 * Sheet's IDs are preserved.
 */
import { db } from "../db/client";
import { categories as categoriesTable, items as itemsTable } from "../db/schema";
import { DEFAULT_CATEGORIES } from "../lib/normalize";

async function main() {
  const gasUrl = process.env.GAS_API_URL;
  if (!gasUrl) {
    console.error("GAS_API_URL not set in .env.local");
    process.exit(1);
  }

  const existing = await db.select({ id: itemsTable.id }).from(itemsTable).limit(1);
  if (existing.length > 0) {
    console.error(
      "Database already has items — refusing to overwrite. Wipe the tables first if you really want to re-import."
    );
    process.exit(1);
  }

  console.log("Fetching from Google Sheet via Apps Script…");
  const [itemsRes, catsRes] = await Promise.all([
    fetch(`${gasUrl}?action=list`, { redirect: "follow" }),
    fetch(`${gasUrl}?action=listCategories`, { redirect: "follow" }),
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
          categoryReviewed?: boolean;
        }[];
      }
    | { ok: false; error: string };
  if (!itemsData.ok) {
    console.error("Sheet read failed:", itemsData.error);
    process.exit(1);
  }

  const catsData = (await catsRes.json().catch(() => null)) as
    | { ok: true; categories: string[] }
    | { ok: false; error: string }
    | null;
  const cats =
    catsData && catsData.ok ? catsData.categories : DEFAULT_CATEGORIES.slice();

  console.log(
    `Importing ${itemsData.items.length} items and ${cats.length} categories…`
  );

  if (cats.length > 0) {
    await db
      .insert(categoriesTable)
      .values(cats.map((name) => ({ name })))
      .onConflictDoNothing();
  }

  if (itemsData.items.length > 0) {
    const rows = itemsData.items.map((it) => ({
      id: it.id,
      name: it.name,
      quantity: it.quantity,
      expiry: it.expiry || null,
      added: it.added ? new Date(it.added + "T00:00:00") : new Date(),
      category: it.category || "Other",
      categoryReviewed: it.categoryReviewed === true,
    }));
    await db.insert(itemsTable).values(rows);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
