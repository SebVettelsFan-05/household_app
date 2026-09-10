import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocationsFromStored,
  legacyAllocations,
  normalizeAllocations,
  sharedCents,
} from "./allocations";
import { computeSettlement, splitCents } from "./settlement";
import { BUYERS } from "./types";

const M = BUYERS;
const ctx = { members: M, mealGroup: ["Arthur", "Eli", "Minh"] };

test("splitCents is exact and deterministic", () => {
  const s = splitCents(1000, ["a", "b", "c"]);
  assert.deepEqual([...s.values()], [334, 333, 333]);
  assert.equal([...s.values()].reduce((x, y) => x + y, 0), 1000);
  assert.deepEqual([...splitCents(5, ["a", "b"]).values()], [3, 2]);
  assert.equal(splitCents(100, []).size, 0);
});

test("normalizeAllocations resolves presets and rejects bad sums", () => {
  const out = normalizeAllocations(
    [
      { kind: "meals", amountCents: 9000 },
      { kind: "house", amountCents: 3000 },
      { kind: "personal", amountCents: 2000, splitAmong: ["Arthur"] },
    ],
    14000,
    ctx
  );
  assert.deepEqual(out[0].splitAmong, ["Arthur", "Eli", "Minh"]);
  assert.deepEqual(out[1].splitAmong, [...M]);
  assert.deepEqual(out[2].splitAmong, []);
  assert.throws(
    () => normalizeAllocations([{ kind: "house", amountCents: 100 }], 200, ctx),
    /add up to 1\.00/
  );
  assert.throws(
    () => normalizeAllocations([{ kind: "custom", amountCents: 100 }], 100, ctx),
    /at least one person/
  );
  assert.throws(
    () => normalizeAllocations([{ kind: "custom", amountCents: 100, splitAmong: ["Zed"] }], 100, ctx),
    /Unknown household member/
  );
  // Empty meal group means everyone, everywhere in the app.
  assert.deepEqual(
    normalizeAllocations([{ kind: "meals", amountCents: 100 }], 100, { members: M, mealGroup: [] })[0]
      .splitAmong,
    [...M]
  );
  assert.throws(() => normalizeAllocations([], 100, ctx), /at least one/i);
});

test("explicit splitAmong is kept (edit preserves snapshots) and roster-ordered", () => {
  const out = normalizeAllocations(
    [{ kind: "meals", amountCents: 100, splitAmong: ["Minh", "Daniel", "Minh"] }],
    100,
    ctx
  );
  assert.deepEqual(out[0].splitAmong, ["Daniel", "Minh"]);
});

test("a departed name on an edited row round-trips when allowed", () => {
  const raw = [{ kind: "house", amountCents: 100, splitAmong: ["Kwame", "Arthur"] }];
  assert.throws(() => normalizeAllocations(raw, 100, ctx), /Unknown household member: Kwame/);
  const out = normalizeAllocations(raw, 100, { ...ctx, allowed: ["Kwame"] });
  assert.deepEqual(out[0].splitAmong, ["Arthur", "Kwame"]);
});

test("stored allocations fall back to legacy when missing or inconsistent", () => {
  assert.deepEqual(allocationsFromStored(null, 500), legacyAllocations(500));
  assert.deepEqual(
    allocationsFromStored([{ kind: "house", amountCents: 100, splitAmong: [...M] }], 500),
    legacyAllocations(500)
  );
  // A departed member's name stays on the snapshot.
  const ok = allocationsFromStored(
    [{ kind: "custom", amountCents: 500, splitAmong: ["Eli", "Kwame", "Eli"] }],
    500
  );
  assert.deepEqual(ok[0].splitAmong, ["Eli", "Kwame"]);
  assert.deepEqual(
    allocationsFromStored([{ kind: "custom", amountCents: 500, splitAmong: [] }], 500),
    legacyAllocations(500)
  );
  assert.equal(sharedCents([{ kind: "personal", amountCents: 5, splitAmong: [] }, ...ok]), 500);
});

test("worked example: three diners shop, house items on the receipt", () => {
  const s = computeSettlement({
    members: M,
    expenses: [
      {
        paidBy: "Arthur",
        amountCents: 12000,
        allocations: [
          { kind: "meals", amountCents: 9000, splitAmong: ["Arthur", "Eli", "Minh"] },
          { kind: "house", amountCents: 3000, splitAmong: [...M] },
        ],
      },
    ],
    bills: [],
    rent: {},
  });
  const by = Object.fromEntries(s.lines.map((l) => [l.name, l]));
  assert.equal(by.Arthur.paid, 12000);
  assert.equal(by.Arthur.share, 3600);
  assert.equal(by.Eli.share, 3600);
  assert.equal(by.Daniel.share, 600);
  assert.equal(by.Daniel.meals, 0);
  assert.equal(by.Ibrahim.paid, 0);
  assert.equal(s.grand, 12000);
  const shares = s.lines.reduce((x, l) => x + l.share, 0);
  const paid = s.lines.reduce((x, l) => x + l.paid, 0);
  assert.equal(shares, paid);
});

test("personal lines are excluded and the payer is not credited for them", () => {
  const s = computeSettlement({
    members: M,
    expenses: [
      {
        paidBy: "Minh",
        amountCents: 14000,
        allocations: [
          { kind: "meals", amountCents: 9000, splitAmong: ["Arthur", "Eli", "Minh"] },
          { kind: "house", amountCents: 3000, splitAmong: [...M] },
          { kind: "personal", amountCents: 2000, splitAmong: [] },
        ],
      },
    ],
    bills: [],
    rent: {},
  });
  const minh = s.lines.find((l) => l.name === "Minh")!;
  assert.equal(minh.paid, 12000);
  assert.equal(s.grand, 12000);
  assert.equal(s.sharedExpenses, 12000);
});

test("a non-diner who buys dinner groceries is credited but owes nothing for them", () => {
  const s = computeSettlement({
    members: M,
    expenses: [
      {
        paidBy: "Daniel",
        amountCents: 3000,
        allocations: [{ kind: "meals", amountCents: 3000, splitAmong: ["Arthur", "Eli", "Minh"] }],
      },
    ],
    bills: [],
    rent: {},
  });
  const d = s.lines.find((l) => l.name === "Daniel")!;
  assert.equal(d.paid, 3000);
  assert.equal(d.share, 0);
});

test("bills, paidBy credit, rent, and cent exactness across the joint account", () => {
  const s = computeSettlement({
    members: M,
    expenses: [
      {
        paidBy: "Eli",
        amountCents: 1001,
        allocations: [{ kind: "house", amountCents: 1001, splitAmong: [...M] }],
      },
    ],
    bills: [
      { cents: 8999, paidBy: "Arthur" }, // internet convention
      { cents: 12345 }, // paid from the joint account
    ],
    rent: { Arthur: 80000, Daniel: 80000, Eli: 70000, Ibrahim: 70000, Minh: 70000 },
  });
  const shares = s.lines.reduce((x, l) => x + l.share, 0);
  const paid = s.lines.reduce((x, l) => x + l.paid, 0);
  // Shares exceed fronted money by exactly what the joint account collects.
  assert.equal(shares - paid, 12345 + 370000);
  assert.equal(s.grand, 1001 + 8999 + 12345 + 370000);
  assert.equal(shares, s.grand);
  const arthur = s.lines.find((l) => l.name === "Arthur")!;
  assert.equal(arthur.paid, 8999);
  assert.equal(arthur.rent, 80000);
  assert.equal(arthur.house + arthur.meals + arthur.bills + arthur.rent, arthur.share);
});

test("a name that left the roster still settles for that month", () => {
  const s = computeSettlement({
    members: M,
    expenses: [
      {
        paidBy: "Kwame",
        amountCents: 20000,
        allocations: [{ kind: "house", amountCents: 20000, splitAmong: ["Arthur", "Kwame"] }],
      },
    ],
    bills: [{ cents: 500 }],
    rent: {},
  });
  const kwame = s.lines.find((l) => l.name === "Kwame")!;
  assert.equal(kwame.paid, 20000);
  assert.equal(kwame.share, 10000);
  assert.equal(kwame.bills, 0);
  assert.equal(s.lines.find((l) => l.name === "Arthur")!.house, 10000);
  assert.equal(s.lines.length, 6);
  assert.equal(s.grand, 20500);
});

test("legacy rows settle exactly like the old five-way split", () => {
  const s = computeSettlement({
    members: M,
    expenses: [{ paidBy: "Ibrahim", amountCents: 5000, allocations: legacyAllocations(5000) }],
    bills: [],
    rent: {},
  });
  for (const l of s.lines) assert.equal(l.share, 1000);
});
