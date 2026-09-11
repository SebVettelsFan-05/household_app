// Dump the LIVE Neon database to ./backups (gitignored). Read-only against
// production: pg_dump only ever issues SELECTs.
//
//   npm run backup:prod
//
// Uses pg_dump from a postgres:17 container so the client matches the
// server major version (Neon runs Postgres 17; a 16 client refuses).
// Writes two files with the same stamp: a custom-format .dump for
// pg_restore and a plain .sql with INSERT statements you can read.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = fs.readFileSync(path.join(root, ".env.local"), "utf8");
const m = env.match(/^DATABASE_URL=(.+)$/m);
if (!m) throw new Error(".env.local has no DATABASE_URL");
const url = m[1].trim().replace(/^"|"$/g, "");
if (/localhost|127\.0\.0\.1/.test(url)) throw new Error("DATABASE_URL points at localhost; nothing to back up");

const dir = path.join(root, "backups");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/T(\d{4})\d{2}\.\d+Z$/, "-$1");
const base = path.join(dir, `prod-${stamp}`);

function dump(args, outFile) {
  const r = spawnSync(
    "docker",
    ["run", "--rm", "postgres:17-alpine", "pg_dump", url, "--no-owner", "--no-privileges", ...args],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error(`pg_dump failed: ${r.stderr.toString()}`);
  }
  fs.writeFileSync(outFile, r.stdout);
  return r.stdout.length;
}

const custom = dump(["-Fc"], `${base}.dump`);
const plain = dump(["--inserts"], `${base}.sql`);
const inserts = (fs.readFileSync(`${base}.sql`, "utf8").match(/^INSERT INTO/gm) || []).length;
console.log(`wrote ${path.relative(root, base)}.dump (${custom} bytes) and .sql (${plain} bytes, ${inserts} rows)`);
console.log("restore into a scratch Postgres 17 with: docker exec -i <container> pg_restore -U <user> -d <db> --no-owner --no-privileges < backups/<file>.dump");
