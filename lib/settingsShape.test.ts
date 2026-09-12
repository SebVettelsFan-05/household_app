import assert from "node:assert/strict";
import test from "node:test";

import { isValidationError } from "./errors";
import { isAllowedSettingKey, validateSettingValue } from "./settingsShape";

function rejects(key: string, value: unknown, fieldHint: string) {
  assert.throws(
    () => validateSettingValue(key, value),
    (e: unknown) => {
      assert.ok(isValidationError(e), `expected a ValidationError, got ${e}`);
      assert.ok(
        (e as Error).message.includes(fieldHint),
        `message "${(e as Error).message}" should name ${fieldHint}`
      );
      return true;
    }
  );
}

test("only the allowlisted keys are settings", () => {
  assert.equal(isAllowedSettingKey("rent_alloc"), true);
  assert.equal(isAllowedSettingKey("meal_group"), true);
  assert.equal(isAllowedSettingKey("anything_else"), false);
});

/* ---------- rent_alloc ---------- */

test("rent_alloc round-trips a well-formed value", () => {
  const value = {
    schedule: [{ from: "2026-05", alloc: { Arthur: 80000, Eli: 70000 } }],
    overrides: { "2026-07": { Arthur: 75000 } },
  };
  assert.deepEqual(validateSettingValue("rent_alloc", value), value);
});

test("rent_alloc refuses a body that is not the shape we store", () => {
  // A foreign body used to answer 200 and be rebuilt as an empty row,
  // erasing every share the household had entered.
  rejects("rent_alloc", {}, "rent_alloc.schedule is required");
  rejects("rent_alloc", { shares: { Arthur: 80000 } }, "rent_alloc.shares");
  rejects("rent_alloc", { schedule: [] }, "rent_alloc.overrides is required");
  rejects("rent_alloc", { overrides: {} }, "rent_alloc.schedule is required");
  rejects(
    "rent_alloc",
    { schedule: [], overrides: {}, somethingElse: "junk" },
    "rent_alloc.somethingElse is not a known field"
  );
  rejects("rent_alloc", [], "rent_alloc must be an object");
  rejects("rent_alloc", null, "rent_alloc must be an object");
});

test("rent_alloc rejects a share that is not a number", () => {
  rejects(
    "rent_alloc",
    { schedule: [{ from: "2026-05", alloc: { Arthur: "xxxx" } }], overrides: {} },
    "rent_alloc.schedule[0].alloc.Arthur"
  );
});

test("rent_alloc rejects a negative share", () => {
  rejects(
    "rent_alloc",
    { schedule: [{ from: "2026-05", alloc: { Arthur: -50 } }], overrides: {} },
    "cannot be negative"
  );
});

test("rent_alloc rejects a bad month key", () => {
  rejects(
    "rent_alloc",
    { schedule: [{ from: "May", alloc: {} }], overrides: {} },
    "from"
  );
  rejects(
    "rent_alloc",
    { schedule: [], overrides: { "2026-13": { Arthur: 1 } } },
    "2026-13"
  );
});

test("rent_alloc rejects a share keyed to someone outside the household", () => {
  // Settlement ignores a name it doesn't know, so an unrecognised key would
  // quietly drop that share from the month.
  rejects(
    "rent_alloc",
    { schedule: [{ from: "2026-05", alloc: { Nobody: 80000 } }], overrides: {} },
    "is not a household member"
  );
  rejects(
    "rent_alloc",
    { schedule: [], overrides: { "2026-05": { "arthur ": 80000 } } },
    "is not a household member"
  );
});

test("rent_alloc still accepts every real household member", () => {
  const value = {
    schedule: [
      {
        from: "2026-05",
        alloc: {
          Arthur: 80000,
          Daniel: 80000,
          Eli: 70000,
          Ibrahim: 70000,
          Minh: 70000,
        },
      },
    ],
    overrides: {},
  };
  assert.deepEqual(validateSettingValue("rent_alloc", value), value);
});

test("recurring_variable amounts are keyed by bill line, not by member", () => {
  const value = {
    lines: [{ id: "gas", name: "Gas" }],
    amounts: { "2026-05": { Gas: 6420, Water: 4185 } },
  };
  assert.deepEqual(validateSettingValue("recurring_variable", value), value);
});

/* ---------- recurring_fixed ---------- */

test("recurring_fixed round-trips a well-formed bill", () => {
  const value = [
    {
      id: "fixed-mainstay-internet",
      name: "Internet",
      protected: true,
      activeFrom: "2026-05",
      paidBy: "Arthur",
      schedule: [{ from: "2026-05", cents: 8999 }],
      overrides: { "2026-08": 9499 },
    },
  ];
  assert.deepEqual(validateSettingValue("recurring_fixed", value), value);
});

test("recurring_fixed rejects anything that is not an array", () => {
  // An object body would have been read as "no bills" and wiped the row.
  rejects("recurring_fixed", { id: "x" }, "recurring_fixed must be an array");
  rejects("recurring_fixed", {}, "recurring_fixed must be an array");
  rejects("recurring_fixed", null, "recurring_fixed must be an array");
  rejects("recurring_fixed", "[]", "recurring_fixed must be an array");
});

test("recurring_fixed rejects negative or fractional cents", () => {
  const bill = (cents: number) => [
    { id: "x", name: "Gas", schedule: [{ from: "2026-05", cents }], overrides: {} },
  ];
  rejects("recurring_fixed", bill(-5000), "cannot be negative");
  rejects("recurring_fixed", bill(12.5), "whole number of cents");
});

test("recurring_fixed rejects a payer who is not in the household", () => {
  rejects(
    "recurring_fixed",
    [{ id: "x", name: "Gas", paidBy: "Nobody", schedule: [], overrides: {} }],
    "paidBy"
  );
});

test("recurring_fixed rejects a missing id", () => {
  rejects(
    "recurring_fixed",
    [{ name: "Gas", schedule: [], overrides: {} }],
    "recurring_fixed[0].id"
  );
});

/* ---------- recurring_variable ---------- */

test("recurring_variable round-trips a well-formed value", () => {
  const value = {
    lines: [
      {
        id: "variable-mainstay-gas",
        name: "Gas",
        protected: true,
        activeFrom: "2026-05",
      },
    ],
    amounts: { "2026-05": { Gas: 4210 } },
  };
  assert.deepEqual(validateSettingValue("recurring_variable", value), value);
});

test("recurring_variable rejects a negative utility amount", () => {
  rejects(
    "recurring_variable",
    { lines: [], amounts: { "2026-05": { Gas: -50 } } },
    "cannot be negative"
  );
});

test("recurring_variable rejects an amount sent as text", () => {
  rejects(
    "recurring_variable",
    { lines: [], amounts: { "2026-05": { Gas: "50" } } },
    'recurring_variable.amounts["2026-05"].Gas'
  );
});

test("recurring_variable refuses a body missing either half", () => {
  rejects("recurring_variable", {}, "recurring_variable.lines is required");
  rejects(
    "recurring_variable",
    { lines: [] },
    "recurring_variable.amounts is required"
  );
  rejects(
    "recurring_variable",
    { amounts: {} },
    "recurring_variable.lines is required"
  );
  rejects(
    "recurring_variable",
    { lines: [], amounts: {}, bills: [] },
    "recurring_variable.bills is not a known field"
  );
  rejects("recurring_variable", [], "recurring_variable must be an object");
  rejects(
    "recurring_variable",
    { lines: {}, amounts: {} },
    "recurring_variable.lines must be an array"
  );
});

test("recurring_variable stores an explicitly empty pair of halves", () => {
  // Clearing the row is still allowed — it just has to be asked for.
  assert.deepEqual(
    validateSettingValue("recurring_variable", { lines: [], amounts: {} }),
    { lines: [], amounts: {} }
  );
});

/* ---------- meal_group ---------- */

test("meal_group keeps household members only, deduped", () => {
  assert.deepEqual(
    validateSettingValue("meal_group", {
      members: ["Arthur", "Arthur", "Nobody", "Eli"],
    }),
    { members: ["Arthur", "Eli"] }
  );
});

test("meal_group rejects a bare array", () => {
  rejects("meal_group", ["Arthur"], "meal_group");
});

test("meal_group rejects members that are not an array", () => {
  // Storing these as an empty list erased the group instead of refusing it.
  rejects("meal_group", { members: "Arthur" }, "meal_group.members");
  rejects("meal_group", { members: 3 }, "meal_group.members");
  rejects("meal_group", { members: { Arthur: true } }, "meal_group.members");
});

test("meal_group with no members key stays an empty group", () => {
  assert.deepEqual(validateSettingValue("meal_group", {}), { members: [] });
});

test("control bytes are stripped out of setting text", () => {
  // Postgres cannot store U+0000 in a jsonb document at all.
  const NUL = String.fromCharCode(0);
  const stored = validateSettingValue("recurring_fixed", [
    { id: "a" + NUL + "b", name: "Hy" + NUL + "dro", schedule: [], overrides: {} },
  ]) as Array<{ id: string; name: string }>;
  assert.equal(stored[0].id, "ab");
  assert.equal(stored[0].name, "Hydro");
});

test("an unknown key is refused outright", () => {
  rejects("something_else", { a: 1 }, "unknown setting key");
});
