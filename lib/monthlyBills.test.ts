import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amountForMonth,
  billNameConflict,
  dedupeFixed,
  retiredFixedNamed,
  emptyVariable,
  mergeProtected,
  normalizeVariableState,
  rentForMonth,
  setBillAmount,
  setRentAlloc,
  settlementBills,
  stopVariableFromMonth,
  type FixedRecurring,
  type RentState,
  type VariableRecurring,
  type VariableState,
} from "./monthlyBills";

function bill(schedule: Array<{ from: string; cents: number }>): FixedRecurring {
  return { id: "fixed-test", name: "Test", schedule, overrides: {} };
}

test("editing a scheduled month keeps the entries after it", () => {
  const before = bill([
    { from: "2026-05", cents: 100_00 },
    { from: "2026-10", cents: 140_00 },
  ]);
  const after = setBillAmount(before, "2026-09", "2026-09", 120_00);

  assert.deepEqual(after.schedule, [
    { from: "2026-05", cents: 100_00 },
    { from: "2026-09", cents: 120_00 },
    { from: "2026-10", cents: 140_00 },
  ]);
  assert.equal(amountForMonth(after, "2026-08"), 100_00);
  assert.equal(amountForMonth(after, "2026-09"), 120_00);
  // The October increase is still there and still says what it said.
  assert.equal(amountForMonth(after, "2026-10"), 140_00);
  assert.equal(amountForMonth(after, "2026-11"), 140_00);
});

test("editing a month that already has an entry replaces it, once", () => {
  const after = setBillAmount(
    bill([
      { from: "2026-05", cents: 100_00 },
      { from: "2026-09", cents: 110_00 },
      { from: "2026-10", cents: 140_00 },
    ]),
    "2026-09",
    "2026-09",
    120_00
  );
  assert.deepEqual(after.schedule, [
    { from: "2026-05", cents: 100_00 },
    { from: "2026-09", cents: 120_00 },
    { from: "2026-10", cents: 140_00 },
  ]);
});

test("an out-of-order schedule comes back sorted", () => {
  const after = setBillAmount(
    bill([
      { from: "2026-10", cents: 140_00 },
      { from: "2026-05", cents: 100_00 },
    ]),
    "2026-09",
    "2026-09",
    120_00
  );
  assert.deepEqual(
    after.schedule.map((s) => s.from),
    ["2026-05", "2026-09", "2026-10"]
  );
});

test("a past-month bill edit still goes to overrides only", () => {
  const before = bill([{ from: "2026-05", cents: 100_00 }]);
  const after = setBillAmount(before, "2026-08", "2026-09", 90_00);
  assert.deepEqual(after.schedule, before.schedule);
  assert.deepEqual(after.overrides, { "2026-08": 90_00 });
});

function rent(schedule: RentState["schedule"]): RentState {
  return { schedule, overrides: {} };
}

test("editing a scheduled rent month keeps the allocations after it", () => {
  const may = { Arthur: 700_00, Eli: 700_00 };
  const sep = { Arthur: 750_00, Eli: 750_00 };
  const oct = { Arthur: 800_00, Eli: 800_00 };

  const after = setRentAlloc(
    rent([
      { from: "2026-05", alloc: may },
      { from: "2026-10", alloc: oct },
    ]),
    "2026-09",
    "2026-09",
    sep
  );

  assert.deepEqual(after.schedule, [
    { from: "2026-05", alloc: may },
    { from: "2026-09", alloc: sep },
    { from: "2026-10", alloc: oct },
  ]);
  assert.deepEqual(rentForMonth(after, "2026-08"), may);
  assert.deepEqual(rentForMonth(after, "2026-09"), sep);
  // October's raise survived the September edit.
  assert.deepEqual(rentForMonth(after, "2026-10"), oct);
  assert.deepEqual(rentForMonth(after, "2026-11"), oct);
});

test("a past-month rent edit still goes to overrides only", () => {
  const before = rent([{ from: "2026-05", alloc: { Arthur: 700_00 } }]);
  const after = setRentAlloc(before, "2026-08", "2026-09", { Arthur: 650_00 });
  assert.deepEqual(after.schedule, before.schedule);
  assert.deepEqual(after.overrides, { "2026-08": { Arthur: 650_00 } });
});

/* ---------- duplicate names across months ---------- */

function parking(from: string, cents: number): FixedRecurring {
  return {
    id: `fixed-${from}-parking`,
    name: "Parking",
    activeFrom: from,
    schedule: [{ from, cents }],
    overrides: {},
  };
}

test("a fixed bill added twice in different months is charged once", () => {
  // The bug: "Parking" added in October, then again in September, showed two
  // rows from October on and billed the household for both.
  const merged = mergeProtected([parking("2026-10", 50_00), parking("2026-09", 50_00)]);
  const rows = merged.filter((r) => r.name === "Parking");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].activeFrom, "2026-09");
  assert.equal(amountForMonth(rows[0], "2026-09"), 50_00);
  assert.equal(amountForMonth(rows[0], "2026-10"), 50_00);
  assert.deepEqual(
    settlementBills(merged, emptyVariable(), "2026-10").map((b) => b.cents),
    [50_00]
  );
});

test("collapsing duplicates keeps both schedules and the longer life", () => {
  const merged = dedupeFixed([
    { ...parking("2026-10", 60_00), inactiveFrom: "2026-12" },
    parking("2026-09", 50_00),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].schedule, [
    { from: "2026-09", cents: 50_00 },
    { from: "2026-10", cents: 60_00 },
  ]);
  // One row was still running, so the merged bill still runs.
  assert.equal(merged[0].inactiveFrom, undefined);
  // Case differences are the same bill.
  assert.equal(
    dedupeFixed([parking("2026-09", 50_00), { ...parking("2026-10", 50_00), name: "parking" }])
      .length,
    1
  );
});

test("a name already used in either list is refused, naming what has it", () => {
  const fixed = [parking("2026-10", 50_00)];
  const variable: VariableState = {
    lines: [{ id: "variable-hydro", name: "Hydro", activeFrom: "2026-08" }],
    amounts: {},
  };
  // A bill that starts next month is invisible on September's editor.
  assert.equal(
    billNameConflict("parking", fixed, variable, "2026-09"),
    "Parking is already a fixed bill, from October 2026"
  );
  assert.equal(
    billNameConflict("HYDRO", fixed, variable, "2026-09"),
    "Hydro is already a variable utility, from August 2026"
  );
  assert.equal(billNameConflict("Storage", fixed, variable, "2026-09"), null);
});

test("a bill stopped before this month can be added back under its name", () => {
  const stopped = { ...parking("2026-05", 50_00), inactiveFrom: "2026-08" };
  const variable: VariableState = {
    lines: [{ id: "variable-hydro", name: "Hydro", activeFrom: "2026-06", inactiveFrom: "2026-09" }],
    amounts: {},
  };
  // Retired as of September: no conflict, and it is the one to reactivate.
  assert.equal(billNameConflict("Parking", [stopped], variable, "2026-09"), null);
  assert.equal(retiredFixedNamed("parking", [stopped], "2026-09")?.id, stopped.id);
  assert.equal(billNameConflict("Hydro", [stopped], variable, "2026-09"), null);
  // Still running in July: still a conflict.
  assert.match(billNameConflict("Parking", [stopped], variable, "2026-07") ?? "", /already a fixed bill/);
  assert.equal(retiredFixedNamed("parking", [stopped], "2026-07"), undefined);
});

/* ---------- stopping a variable utility ---------- */

const hydro: VariableRecurring = {
  id: "variable-hydro",
  name: "Hydro",
  activeFrom: "2026-07",
};

test("stopping a utility with history retires it and drops this month on", () => {
  const stopped = stopVariableFromMonth(
    {
      lines: [hydro],
      amounts: {
        "2026-08": { Hydro: 40_00 },
        "2026-09": { Hydro: 45_00 },
        "2026-10": { Hydro: 50_00, Gas: 20_00 },
      },
    },
    hydro.id,
    "2026-09"
  );
  assert.equal(stopped.lines[0].inactiveFrom, "2026-09");
  assert.deepEqual(stopped.amounts, {
    "2026-08": { Hydro: 40_00 },
    "2026-10": { Gas: 20_00 },
  });
  // And it is no longer billed from September on, in any month. October still
  // bills the Gas that shared its bucket.
  const normalized = normalizeVariableState(stopped);
  assert.deepEqual(settlementBills([], normalized, "2026-09"), []);
  assert.deepEqual(
    settlementBills([], normalized, "2026-10").map((b) => b.cents),
    [20_00]
  );
  assert.deepEqual(settlementBills([], normalized, "2026-11"), []);
  assert.deepEqual(
    settlementBills([], normalized, "2026-08").map((b) => b.cents),
    [40_00]
  );
});

test("stopping a utility with nothing recorded earlier deletes it outright", () => {
  const stopped = stopVariableFromMonth(
    { lines: [hydro], amounts: { "2026-09": { Hydro: 45_00 } } },
    hydro.id,
    "2026-09"
  );
  assert.deepEqual(stopped.lines, []);
  assert.deepEqual(stopped.amounts, {});
  // The bug: the line came straight back from its leftover amounts, active
  // from the first month the app knows about.
  assert.deepEqual(
    normalizeVariableState(stopped).lines.filter((l) => !l.protected),
    []
  );
});

test("a line rebuilt from stray amounts starts at the first month with one", () => {
  const rebuilt = normalizeVariableState({
    lines: [],
    amounts: { "2026-10": { Hydro: 50_00 }, "2026-08": { Hydro: 40_00 } },
  });
  const line = rebuilt.lines.find((l) => l.name === "Hydro");
  assert.ok(line);
  assert.equal(line.activeFrom, "2026-08");
  assert.equal(line.inactiveFrom, undefined);
  // Nothing before August, when the utility first appeared.
  assert.deepEqual(settlementBills([], rebuilt, "2026-07"), []);
  assert.deepEqual(
    settlementBills([], rebuilt, "2026-08").map((b) => b.cents),
    [40_00]
  );
});

test("a retired line is never revived by amounts left in later months", () => {
  const state = normalizeVariableState({
    lines: [{ ...hydro, inactiveFrom: "2026-09" }],
    amounts: { "2026-08": { Hydro: 40_00 }, "2026-10": { Hydro: 50_00 } },
  });
  assert.equal(state.lines.filter((l) => l.name === "Hydro").length, 1);
  assert.equal(state.lines.find((l) => l.name === "Hydro")?.inactiveFrom, "2026-09");
  assert.deepEqual(settlementBills([], state, "2026-10"), []);
});
