import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Lazy connection: build-time route collection imports this module without
// DATABASE_URL set. Throwing at import would break `next build`. Throw on
// first actual query instead.
let _sql: NeonQueryFunction<false, false> | null = null;
let _db: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add the Neon integration in Vercel (Storage → Marketplace), then redeploy."
    );
  }
  _sql = neon(url);
  _db = drizzle({ client: _sql, schema });
  return _db;
}

// Proxy that forwards all Drizzle methods to the lazily-built db.
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop) {
    const target = getDb();
    const value = (target as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  },
});

export { schema };
