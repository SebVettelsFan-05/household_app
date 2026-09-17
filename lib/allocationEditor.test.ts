import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocationsForSubmit,
  allocationsRemainder,
  blankAllocation,
  seedAllocations,
  splitPeople,
  toggleSplitMember,
} from "../components/AllocationEditor";
import type { ExpenseAllocation } from "./types";

const saved: ExpenseAllocation[] = [
  { kind: "meals", amountCents: 9000, splitAmong: ["Arthur", "Eli", "Minh"] },
  { kind: "house", amountCents: 3000, splitAmong: ["Arthur", "Daniel", "Eli", "Ibrahim", "Minh"] },
  { kind: "personal", amountCents: 2000, splitAmong: [] },
];

test("editing sends every untouched line's snapshot back unchanged", () => {
  const lines = seedAllocations(saved);
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => !l.kindChanged && !l.tracksTotal));
  const out = allocationsForSubmit(lines, { keepSnapshots: true });
  assert.deepEqual(out, [
    { kind: "meals", amountCents: 9000, splitAmong: ["Arthur", "Eli", "Minh"] },
    { kind: "house", amountCents: 3000, splitAmong: ["Arthur", "Daniel", "Eli", "Ibrahim", "Minh"] },
    { kind: "personal", amountCents: 2000, splitAmong: [] },
  ]);
});

test("re-picking a line's kind drops its snapshot so the server re-resolves it", () => {
  const lines = seedAllocations(saved);
  lines[0] = { ...lines[0], kind: "house", kindChanged: true, splitAmong: [] };
  const out = allocationsForSubmit(lines, { keepSnapshots: true });
  assert.deepEqual(out[0], { kind: "house", amountCents: 9000 });
  assert.deepEqual(out[1].splitAmong, saved[1].splitAmong);
});

test("a fresh add never sends snapshots for house or meals, always for custom", () => {
  const lines = [
    { ...blankAllocation(), kind: "meals" as const, amountCents: 100 },
    { ...blankAllocation(), kind: "custom" as const, amountCents: 50, splitAmong: ["Eli"] },
  ];
  const out = allocationsForSubmit(lines, { keepSnapshots: false });
  assert.deepEqual(out, [
    { kind: "meals", amountCents: 100 },
    { kind: "custom", amountCents: 50, splitAmong: ["Eli"] },
  ]);
});

test("the remainder is what the receipt still has unallocated", () => {
  const lines = seedAllocations(saved);
  assert.equal(allocationsRemainder(lines, 14000), 0);
  assert.equal(allocationsRemainder(lines, 15000), 1000);
  assert.equal(allocationsRemainder(lines, 13000), -1000);
  lines[2] = { ...lines[2], amountCents: null };
  assert.equal(allocationsRemainder(lines, 14000), 2000);
});

test("a single saved line tracks the receipt total on edit", () => {
  const lines = seedAllocations([saved[1]]);
  assert.equal(lines[0].tracksTotal, true);
  assert.equal(seedAllocations([]).length, 1);
  assert.equal(seedAllocations([])[0].kind, "");
});

/* ---------- names the roster no longer has ---------- */

const MEMBERS = ["Arthur", "Daniel", "Eli", "Ibrahim", "Minh"];

test("a departed name on a custom line is shown and kept while others toggle", () => {
  const line = ["Eli", "Jordan"];
  // Jordan moved out: still on the line, still offered, still checked.
  assert.deepEqual(splitPeople(line, MEMBERS), [...MEMBERS, "Jordan"]);

  // Adding somebody else must not quietly drop them.
  const added = toggleSplitMember(line, "Minh", MEMBERS);
  assert.deepEqual(added, ["Eli", "Minh", "Jordan"]);
  // Nor must removing somebody else.
  assert.deepEqual(toggleSplitMember(added, "Eli", MEMBERS), ["Minh", "Jordan"]);
});

test("a departed name comes off only when it is the one tapped", () => {
  assert.deepEqual(toggleSplitMember(["Eli", "Jordan"], "Jordan", MEMBERS), ["Eli"]);
});

test("a line with nobody departed offers the roster, in roster order", () => {
  assert.deepEqual(splitPeople([], MEMBERS), MEMBERS);
  assert.deepEqual(toggleSplitMember(["Minh"], "Arthur", MEMBERS), ["Arthur", "Minh"]);
});
