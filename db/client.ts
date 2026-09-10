import { neon } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Two drivers, one Drizzle surface.
 *
 *   - Production / Vercel: Neon's HTTP driver (`neon-http`). Stateless,
 *     ideal for serverless, and what the live DB has always used.
 *   - Local dev + smoke tests: plain `node-postgres` against a throwaway
 *     Postgres (Docker), selected automatically when DATABASE_URL points at
 *     localhost. This is what keeps the live household DB out of test runs.
 *
 * Both databases extend the same `PgDatabase` base, so every query in
 * `lib/repo.ts` type-checks against the union. The one neon-only API is
 * `db.batch()`; callers feature-detect it (see `bulkAddGroceryRepo`).
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let _db: Db | null = null;

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add the Neon integration in Vercel (Storage → Marketplace), then redeploy."
    );
  }
  if (isLocalUrl(url)) {
    const pool = new Pool({ connectionString: url });
    _db = drizzlePg({ client: pool, schema }) as unknown as Db;
  } else {
    _db = drizzleNeon({ client: neon(url), schema }) as unknown as Db;
  }
  return _db;
}

// Proxy that forwards all Drizzle methods to the lazily-built db. Lazy so
// build-time route collection (which imports this module without
// DATABASE_URL) doesn't throw.
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const target = getDb();
    const value = (target as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  },
});

export { schema };
