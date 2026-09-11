// Read-only rehearsal probe against a restored copy of the live DB served
// by the NEW code (see docs/BACKUP_RESTORE.md). Prints row counts to compare
// against the dump, checks that every legacy row reads back sanely, and
// reports how far settlement shares move vs the old five-way formula for
// every month on record.
//
//   npx tsx scripts/local/prodcopy-probe.mjs [http://localhost:3200]
import { computeSettlement } from "../../lib/settlement.ts";
import { BUYERS } from "../../lib/types.ts";

const BASE = process.argv[2] || "http://localhost:3200";
let cookie = "";
async function get(path) {
  const res = await fetch(BASE + path, { headers: { cookie } });
  const c = res.headers.get("set-cookie");
  if (c) cookie = c.split(";")[0];
  const j = await res.json();
  if (!res.ok || j.ok === false) throw new Error(`${path} -> ${res.status} ${j.error || ""}`);
  return j;
}
const login = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "dev" }) });
cookie = login.headers.get("set-cookie").split(";")[0];

const problems = [];
const items = (await get("/api/items")).items;
const grocery = (await get("/api/grocery")).grocery;
const recipes = (await get("/api/recipes")).recipes;
const archive = (await get("/api/recipes/archive")).recipes;
const favorites = (await get("/api/favorites")).favorites;
const expenses = (await get("/api/expenses")).expenses;
const accounts = (await get("/api/shared-accounts")).accounts;
const counts = { items: items.length, grocery: grocery.length, recipes: recipes.length + archive.length, favorites: favorites.length, expenses: expenses.length, accounts: accounts.length };
console.log("counts after migration (compare with the dump):", counts);

for (const e of expenses) {
  const sum = e.allocations.reduce((s, a) => s + a.amountCents, 0);
  if (sum !== e.amountCents) problems.push(`expense ${e.id} allocations sum ${sum} != ${e.amountCents}`);
  if (!(e.allocations.length === 1 && e.allocations[0].kind === "house" && e.allocations[0].splitAmong.length === BUYERS.length)) problems.push(`expense ${e.id} did not read as legacy house line`);
  if (!BUYERS.includes(e.paidBy)) problems.push(`expense ${e.id} paidBy "${e.paidBy}" is not a member (row stays readable but cannot be edited until fixed)`);
}
for (const r of [...recipes, ...archive]) {
  if (r.day < 0 || r.day > 6) problems.push(`recipe ${r.id} day ${r.day}`);
  if (r.noMeal) problems.push(`recipe ${r.id} unexpectedly noMeal`);
  if (r.servings !== 0 || r.portions !== 0) problems.push(`recipe ${r.id} servings/portions not 0`);
}
for (const g of grocery) if (g.pool !== "house") problems.push(`grocery ${g.id} pool ${g.pool}`);
for (const i of items) if (i.owner !== "") problems.push(`item ${i.id} owner ${i.owner}`);

// Settlement drift per month: new cent-exact model vs the old Math.round(total/N).
const byMonth = new Map();
for (const e of expenses) {
  const m = (e.occurredOn || e.added).slice(0, 7);
  if (!byMonth.has(m)) byMonth.set(m, []);
  byMonth.get(m).push(e);
}
console.log("month     receipts   total     max |new-old| share (cents)");
for (const [m, list] of [...byMonth.entries()].sort()) {
  const s = computeSettlement({ members: BUYERS, expenses: list.map((e) => ({ paidBy: e.paidBy, amountCents: e.amountCents, allocations: e.allocations })), bills: [], rent: {} });
  const total = list.reduce((x, e) => x + e.amountCents, 0);
  const oldShare = Math.round(total / BUYERS.length);
  const maxDiff = Math.max(...s.lines.map((l) => Math.abs(l.share - oldShare)));
  const paidOld = new Map(BUYERS.map((b) => [b, 0]));
  for (const e of list) if (paidOld.has(e.paidBy)) paidOld.set(e.paidBy, paidOld.get(e.paidBy) + e.amountCents);
  const paidDiff = Math.max(...s.lines.filter((l) => BUYERS.includes(l.name)).map((l) => Math.abs(l.paid - paidOld.get(l.name))));
  console.log(`${m}   ${String(list.length).padStart(3)}   ${(total / 100).toFixed(2).padStart(9)}   share ${maxDiff}   paid ${paidDiff}`);
}
console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "no problems: every legacy row reads back as before");
