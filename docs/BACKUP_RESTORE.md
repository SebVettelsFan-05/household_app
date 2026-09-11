# Backing up the live database and rehearsing a merge

The Neon database behind the deployed app is the household's only copy of
its data. Before merging anything that touches the schema, take a dump and
run the new code against a restored copy. Everything here is read-only
against production; nothing writes to Neon.

## 1. Back up

```
npm run backup:prod
```

Writes `backups/prod-<stamp>.dump` (custom format, for `pg_restore`) and
`backups/prod-<stamp>.sql` (plain INSERTs you can read). The folder is
gitignored. Docker Desktop must be running: the script uses `pg_dump` from
a `postgres:17` container because Neon runs Postgres 17 and an older
client refuses to connect.

Neon also keeps its own point-in-time history for the project, so a bad
deploy can be rolled back from the Neon console independently of this
file. The local dump is the copy you control.

## 2. Restore into a scratch Postgres

```
docker run -d --name household-prodcopy-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=dev -e POSTGRES_DB=prodcopy -p 5434:5432 postgres:17-alpine
docker cp backups/prod-<stamp>.dump household-prodcopy-pg:/tmp/prod.dump
docker exec household-prodcopy-pg pg_restore -U dev -d prodcopy --no-owner --no-privileges /tmp/prod.dump
```

(In Git Bash prefix the last command with `MSYS_NO_PATHCONV=1` so the
`/tmp` path is not rewritten.) Check the row counts match the dump:

```
docker exec household-prodcopy-pg psql -U dev -d prodcopy -c "select 'expenses', count(*) from expenses union all select 'items', count(*) from items union all select 'recipes', count(*) from recipes"
```

## 3. Serve the new code against the copy

With the normal local stack running (`npm run dev:local`, which provides
the Apps Script stub on :3999), start a second app on :3200 pointed at the
copy:

```
DATABASE_URL=postgresql://dev:dev@localhost:5434/prodcopy GAS_API_URL=http://localhost:3999 AUTH_SECRET=local-dev-secret-not-for-production-0123456789 VAULT_SECRET=local-dev-vault-secret-not-for-production-0123 HOUSE_PASSWORD=dev npx next dev -p 3200
```

The first request runs `ensureTables()`, which applies the additive
columns to the copy exactly as it will to production on the first request
after deploy.

## 4. Probe

```
npx tsx scripts/local/prodcopy-probe.mjs http://localhost:3200
```

It logs in, reads every list endpoint, and reports: row counts (compare
with step 2), whether every legacy expense reads back as one "everyone"
line that sums to its amount, whether every payer is still a household
member, that no recipe carries an out-of-range day, and per month how far
the new settlement shares move from the old five-way formula. Expect
"no problems" and share drift of at most 1 cent. Do not run the Playwright
suites against the copy: their fixtures delete rows.

Open http://localhost:3200 as well and click through both looks with the
real data before merging.

## 5. Tear down

```
docker rm -f household-prodcopy-pg
```

## What the merge does to production

- Schema: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` only, on the first
  request. Nothing is dropped, renamed or rewritten.
- Existing expenses have no allocations stored; the code reads them as a
  single "everyone" line, so their settlement is the old five-way split.
- Existing recipes keep their days; the week now runs to Saturday, so
  nothing moves.
- The Apps Script mirror keeps working with the old script; new columns
  appear only after `apps-script/Code.gs` is re-pasted into the project.
- Rehearsal on 2026-09-11 against a copy with 425 rows: all counts equal,
  no problems reported, past-month share drift at most 1 cent.
