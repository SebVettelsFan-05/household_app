import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyAllocations, normalizeAllocations } from "./allocations";
import { computeSettlement, type SettlementBill, type SettlementExpense, type SettlementInput } from "./settlement";
import { BUYERS, type ExpenseAllocation } from "./types";

/**
 * The money invariants, checked against thousands of randomised months and
 * an independent exact-fraction reference. See docs/SETTLEMENT_MATH.md.
 *
 *  I1  Conservation: every shared cent is charged exactly once.
 *      sum(share) = sharedExpenses + billsTotal + rentTotal = grand.
 *  I2  Credit: a payer is credited exactly the shared part of what they
 *      fronted, once; bills flagged paidBy credit that person in full.
 *  I3  Only participants pay: a person outside a line's participants owes
 *      nothing for it (exact, not approximate).
 *  I4  Fair rounding: within a pool, no participant is more than one cent
 *      from any other; a person's total is within (pools they are in) cents
 *      of the exact fraction.
 *  I5  Personal lines are invisible to settlement.
 *  I6  Order independence: shuffling receipts changes nothing.
 *  I7  Joint account: sum(send) - sum(withdraw) equals rent plus bills
 *      nobody fronted, i.e. exactly what the joint account must pay out.
 */

// Tiny seeded PRNG (mulberry32) so a failure is reproducible.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEPARTED = ["Kwame", "Priya"];
const ROSTER = [...BUYERS, ...DEPARTED];

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)];
}
function subset(r: () => number, xs: readonly string[], min = 1): string[] {
  const out = xs.filter(() => r() < 0.5);
  while (out.length < min) {
    const x = pick(r, xs);
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

function randomMonth(seed: number): SettlementInput {
  const r = rng(seed);
  const expenses: SettlementExpense[] = [];
  const n = 1 + Math.floor(r() * 30);
  for (let i = 0; i < n; i += 1) {
    const allocations: ExpenseAllocation[] = [];
    const lines = 1 + Math.floor(r() * 3);
    for (let j = 0; j < lines; j += 1) {
      const amountCents = 1 + Math.floor(r() * 30000);
      const roll = r();
      if (roll < 0.15) allocations.push({ kind: "personal", amountCents, splitAmong: [] });
      else if (roll < 0.45) allocations.push({ kind: "house", amountCents, splitAmong: [...BUYERS] });
      else if (roll < 0.7) allocations.push({ kind: "meals", amountCents, splitAmong: subset(r, BUYERS) });
      else if (roll < 0.85) allocations.push({ kind: "custom", amountCents, splitAmong: subset(r, ROSTER) });
      else allocations.push(...legacyAllocations(amountCents));
    }
    expenses.push({
      paidBy: r() < 0.9 ? pick(r, BUYERS) : pick(r, DEPARTED),
      amountCents: allocations.reduce((s, a) => s + a.amountCents, 0),
      allocations,
    });
  }
  const bills: SettlementBill[] = [];
  const nb = Math.floor(r() * 5);
  for (let i = 0; i < nb; i += 1) {
    bills.push({ cents: 1 + Math.floor(r() * 20000), paidBy: r() < 0.4 ? pick(r, BUYERS) : undefined });
  }
  const rent: Record<string, number> = {};
  for (const m of BUYERS) if (r() < 0.8) rent[m] = Math.floor(r() * 100000);
  return { members: BUYERS, expenses, bills, rent };
}

/** Exact reference in 1/L cents, where L = lcm(1..7) covers every pool size. */
const L = 420;
function exactReference(input: SettlementInput) {
  const roster = new Set<string>(input.members);
  for (const e of input.expenses) {
    roster.add(e.paidBy);
    for (const a of e.allocations) for (const n of a.splitAmong) roster.add(n);
  }
  const share = new Map<string, number>(); // in 1/L cents, expenses only
  const poolsOf = new Map<string, Set<string>>();
  const paid = new Map<string, number>();
  let shared = 0;
  for (const name of roster) {
    share.set(name, 0);
    paid.set(name, 0);
    poolsOf.set(name, new Set());
  }
  for (const e of input.expenses) {
    for (const a of e.allocations) {
      if (a.kind === "personal") continue;
      const parts = [...roster].filter((m) => a.splitAmong.includes(m));
      const participants = parts.length > 0 ? parts : [...roster];
      shared += a.amountCents;
      paid.set(e.paidBy, paid.get(e.paidBy)! + a.amountCents);
      const key = `${a.kind === "meals" ? "m" : "h"}|${participants.join("|")}`;
      for (const p of participants) {
        share.set(p, share.get(p)! + (a.amountCents * L) / participants.length);
        poolsOf.get(p)!.add(key);
      }
    }
  }
  for (const b of input.bills) {
    if (b.cents <= 0) continue;
    if (b.paidBy && paid.has(b.paidBy)) paid.set(b.paidBy, paid.get(b.paidBy)! + b.cents);
  }
  return { roster, share, paid, poolsOf, shared };
}

test("settlement invariants hold on 2000 random months", () => {
  for (let seed = 1; seed <= 2000; seed += 1) {
    const input = randomMonth(seed);
    const s = computeSettlement(input);
    const ref = exactReference(input);
    const ctx = `seed ${seed}`;

    // I1 conservation
    const sumShare = s.lines.reduce((x, l) => x + l.share, 0);
    assert.equal(s.sharedExpenses, ref.shared, ctx);
    assert.equal(sumShare, s.grand, ctx);
    assert.equal(s.grand, s.sharedExpenses + s.billsTotal + s.rentTotal, ctx);
    const sumHouseMeals = s.lines.reduce((x, l) => x + l.house + l.meals, 0);
    assert.equal(sumHouseMeals, s.sharedExpenses, ctx);
    const sumBills = s.lines.reduce((x, l) => x + l.bills, 0);
    assert.equal(sumBills, s.billsTotal, ctx);

    // I2 credit, exact
    for (const l of s.lines) {
      assert.equal(l.paid, ref.paid.get(l.name) ?? 0, `${ctx} paid ${l.name}`);
      assert.equal(l.house + l.meals + l.bills + l.rent, l.share, ctx);
      assert.equal(l.rent, input.rent[l.name] ?? 0, ctx);
    }
    // Every roster name is settled, nobody extra.
    assert.deepEqual(new Set(s.lines.map((l) => l.name)), ref.roster, ctx);

    // I3 + I4: per person, within (#pools) cents of exact; zero pools => exactly 0
    for (const l of s.lines) {
      const exact = ref.share.get(l.name)! / L;
      const pools = ref.poolsOf.get(l.name)!.size;
      const diff = Math.abs(l.house + l.meals - exact);
      if (pools === 0) assert.equal(l.house + l.meals, 0, `${ctx} ${l.name} charged with no lines`);
      assert.ok(diff <= pools + 1e-9, `${ctx} ${l.name} off by ${diff} with ${pools} pools`);
    }

    // Bills: only current members, within a cent of equal shares.
    const memberBills = s.lines.filter((l) => (input.members as readonly string[]).includes(l.name)).map((l) => l.bills);
    const others = s.lines.filter((l) => !(input.members as readonly string[]).includes(l.name));
    for (const o of others) assert.equal(o.bills, 0, ctx);
    assert.ok(Math.max(...memberBills) - Math.min(...memberBills) <= 1, ctx);

    // I7 joint account
    const sumPaid = s.lines.reduce((x, l) => x + l.paid, 0);
    const unfronted = input.bills.filter((b) => b.cents > 0 && !b.paidBy).reduce((x, b) => x + b.cents, 0);
    assert.equal(sumShare - sumPaid, unfronted + s.rentTotal, ctx);

    // I6 order independence
    const shuffled = { ...input, expenses: [...input.expenses].reverse() };
    assert.deepEqual(computeSettlement(shuffled), s, `${ctx} order`);
  }
});

test("a participant name containing the old separator cannot collide pools", () => {
  const s = computeSettlement({
    members: BUYERS,
    expenses: [
      { paidBy: "Arthur", amountCents: 2000, allocations: [{ kind: "custom", amountCents: 2000, splitAmong: ["Arthur", "Eli"] }] },
      { paidBy: "Arthur", amountCents: 2000, allocations: [{ kind: "custom", amountCents: 2000, splitAmong: ["Arthur|Eli"] }] },
    ],
    bills: [],
    rent: {},
  });
  const by = Object.fromEntries(s.lines.map((l) => [l.name, l.share]));
  assert.equal(by.Arthur, 1000);
  assert.equal(by.Eli, 1000);
  assert.equal(by["Arthur|Eli"], 2000);
});

test("personal lines never charge or credit anyone", () => {
  const withPersonal = computeSettlement({
    members: BUYERS,
    expenses: [
      {
        paidBy: "Eli",
        amountCents: 5000,
        allocations: [
          { kind: "house", amountCents: 2000, splitAmong: [...BUYERS] },
          { kind: "personal", amountCents: 3000, splitAmong: [] },
        ],
      },
    ],
    bills: [],
    rent: {},
  });
  const without = computeSettlement({
    members: BUYERS,
    expenses: [
      { paidBy: "Eli", amountCents: 2000, allocations: [{ kind: "house", amountCents: 2000, splitAmong: [...BUYERS] }] },
    ],
    bills: [],
    rent: {},
  });
  assert.deepEqual(withPersonal, without);
});

test("a payer outside the participants is credited in full and charged nothing", () => {
  const s = computeSettlement({
    members: BUYERS,
    expenses: [
      { paidBy: "Daniel", amountCents: 999, allocations: [{ kind: "custom", amountCents: 999, splitAmong: ["Arthur", "Eli"] }] },
    ],
    bills: [],
    rent: {},
  });
  const by = Object.fromEntries(s.lines.map((l) => [l.name, l]));
  assert.equal(by.Daniel.paid, 999);
  assert.equal(by.Daniel.share, 0);
  assert.equal(by.Arthur.share + by.Eli.share, 999);
  assert.ok(Math.abs(by.Arthur.share - by.Eli.share) <= 1);
  for (const n of ["Ibrahim", "Minh"]) assert.equal(by[n].share, 0);
});

test("a shared line naming nobody the roster can place charges the whole household", () => {
  const s = computeSettlement({
    members: BUYERS,
    expenses: [{ paidBy: "Arthur", amountCents: 500, allocations: [{ kind: "custom", amountCents: 500, splitAmong: [] }] }],
    bills: [],
    rent: {},
  });
  assert.equal(s.sharedExpenses, 500);
  assert.equal(s.lines.find((l) => l.name === "Arthur")!.paid, 500);
  assert.equal(s.lines.reduce((x, l) => x + l.share, 0), 500);
});

test("normalised allocations always sum to the receipt and never invent participants", () => {
  const r = rng(7);
  const ctx = { members: BUYERS, mealGroup: ["Arthur", "Eli", "Minh"] as string[] };
  for (let i = 0; i < 500; i += 1) {
    const lines = 1 + Math.floor(r() * 4);
    const raw: Array<{ kind: "house" | "meals" | "personal" | "custom"; amountCents: number; splitAmong?: string[] }> = [];
    for (let j = 0; j < lines; j += 1) {
      const kind = pick(r, ["house", "meals", "personal", "custom"] as const);
      raw.push({
        kind,
        amountCents: 1 + Math.floor(r() * 10000),
        ...(kind === "custom" ? { splitAmong: subset(r, BUYERS) } : {}),
      });
    }
    const total = raw.reduce((s, a) => s + a.amountCents, 0);
    const out = normalizeAllocations(raw, total, ctx);
    assert.equal(out.reduce((s, a) => s + a.amountCents, 0), total);
    for (const a of out) {
      if (a.kind === "personal") assert.deepEqual(a.splitAmong, []);
      else {
        assert.ok(a.splitAmong.length > 0);
        for (const n of a.splitAmong) assert.ok((BUYERS as readonly string[]).includes(n));
        if (a.kind === "house") assert.deepEqual(a.splitAmong, [...BUYERS]);
        if (a.kind === "meals") assert.deepEqual(a.splitAmong, ctx.mealGroup);
      }
    }
    assert.throws(() => normalizeAllocations(raw, total + 1, ctx), /add up to/);
  }
});
