// Local, isolated dev environment. Never touches the production Neon DB.
//
//   npm run dev:local            -> Postgres in Docker + GAS stub + next dev on :3100
//   npm run dev:local -- --reset -> same, but drops and recreates the local schema first
//
// Everything the app needs is injected as process env here, which takes
// precedence over .env.local, so the production DATABASE_URL in .env.local
// is never used by this process tree.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reset = process.argv.includes("--reset");

export const LOCAL_ENV = {
  DATABASE_URL: "postgresql://dev:dev@localhost:5433/household_dev",
  GAS_API_URL: "http://localhost:3999",
  AUTH_SECRET: "local-dev-secret-not-for-production-0123456789",
  VAULT_SECRET: "local-dev-vault-secret-not-for-production-0123",
  HOUSE_PASSWORD: "dev",
  PORT: "3100",
  NEXT_PUBLIC_HOUSEHOLD_TIME_ZONE: "America/Toronto",
};

const CONTAINER = "household-dev-pg";

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32", ...opts });
}

export function ensurePostgres() {
  const running = sh("docker", ["ps", "-q", "-f", `name=^${CONTAINER}$`]).stdout.trim();
  if (running) return;
  const exists = sh("docker", ["ps", "-aq", "-f", `name=^${CONTAINER}$`]).stdout.trim();
  if (exists) {
    sh("docker", ["start", CONTAINER], { stdio: "inherit" });
  } else {
    sh(
      "docker",
      [
        "run", "-d", "--name", CONTAINER,
        "-e", "POSTGRES_PASSWORD=dev", "-e", "POSTGRES_USER=dev", "-e", "POSTGRES_DB=household_dev",
        "-p", "5433:5432", "postgres:16-alpine",
      ],
      { stdio: "inherit" }
    );
  }
  // Wait for the server to accept connections.
  for (let i = 0; i < 40; i += 1) {
    const r = sh("docker", ["exec", CONTAINER, "pg_isready", "-U", "dev", "-d", "household_dev"]);
    if (r.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error("local postgres did not become ready");
}

export function resetSchema() {
  const r = sh("docker", [
    "exec", CONTAINER, "psql", "-U", "dev", "-d", "household_dev", "-c",
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
  ]);
  if (r.status !== 0) throw new Error(`schema reset failed: ${r.stderr}`);
  console.log("[dev:local] schema reset");
}

export function startStub() {
  return spawn(process.execPath, [path.join(root, "scripts/local/gas-stub.mjs"), "3999"], {
    stdio: "inherit",
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensurePostgres();
  if (reset) resetSchema();
  const stub = startStub();
  const next = spawn("npx", ["next", "dev", "-p", LOCAL_ENV.PORT], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...LOCAL_ENV },
  });
  const stop = () => {
    stub.kill();
    next.kill();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  next.on("exit", (code) => {
    stub.kill();
    process.exit(code ?? 0);
  });
}
