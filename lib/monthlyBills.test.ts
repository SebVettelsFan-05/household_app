import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amountForMonth,
  rentForMonth,
  setBillAmount,
  setRentAlloc,
  type FixedRecurring,
  type RentState,
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
