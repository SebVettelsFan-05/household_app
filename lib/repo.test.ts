import assert from "node:assert/strict";
import test from "node:test";

import {
  isPastMonth,
  monthOf,
  PAST_MONTH_LOCKED_MESSAGE,
  planMoveDone,
  runWritesAtomically,
  validateOccurredOn,
} from "./repo";
import type { MoveDoneGroceryRow, MoveDoneInventoryRow } from "./repo";
import { isValidationError } from "./errors";
import type { Db } from "@/db/client";
import type { BatchItem } from "drizzle-orm/batch";
import { todayYmd } from "./dates";

const CATS = ["Produce", "Dairy", "Other"];

let seq = 0;
function done(
  over: Partial<MoveDoneGroceryRow> & { name: string; quantity: number }
): MoveDoneGroceryRow {
  seq += 1;
  return {
    id: `g${seq}`,
    category: "Other",
    categoryReviewed: false,
    ...over,
  };
}

function inv(
  over: Partial<MoveDoneInventoryRow> & { name: string; quantity: number }
): MoveDoneInventoryRow {
  seq += 1;
  return {
    id: `i${seq}`,
    category: "Other",
    categoryReviewed: false,
    ...over,
  };
}

test("a done row with no inventory match becomes one insert", () => {
  const plan = planMoveDone(
    [done({ name: "Milk", quantity: 2, category: "Dairy" })],
    [],
    CATS
  );
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.inserts, [
    { name: "Milk", quantity: 2, category: "Dairy", categoryReviewed: false },
  ]);
  assert.equal(plan.deleteIds.length, 1);
});

test("a done row merges into the matching inventory row", () => {
  const row = inv({ name: "milk", quantity: 3, category: "Dairy" });
  const plan = planMoveDone(
    [done({ name: "Milk", quantity: 2, category: "Dairy" })],
    [row],
    CATS
  );
  assert.deepEqual(plan.inserts, []);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, row.id);
  assert.equal(plan.updates[0].quantity, 5);
});

test("two done rows with the same name fold into a single insert", () => {
  const plan = planMoveDone(
    [
      done({ name: "Eggs", quantity: 6 }),
      done({ name: "eggs", quantity: 6 }),
    ],
    [],
    CATS
  );
  assert.deepEqual(plan.inserts, [
    { name: "Eggs", quantity: 12, category: "Other", categoryReviewed: false },
  ]);
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.deleteIds.length, 2);
});

test("every done row is deleted, including one too broken to move", () => {
  const rows = [
    done({ name: "   ", quantity: 1 }),
    done({ name: "Rice", quantity: 1 }),
  ];
  const plan = planMoveDone(rows, [], CATS);
  assert.deepEqual(plan.inserts.map((i) => i.name), ["Rice"]);
  assert.deepEqual(plan.deleteIds, rows.map((r) => r.id));
});

test("a reviewed inventory category survives the move", () => {
  const row = inv({
    name: "Spinach",
    quantity: 1,
    category: "Produce",
    categoryReviewed: true,
  });
  const plan = planMoveDone(
    [done({ name: "Spinach", quantity: 1, category: "Other" })],
    [row],
    CATS
  );
  assert.equal(plan.updates[0].quantity, 2);
  // No category key at all: the stored one is left exactly as it was.
  assert.equal("category" in plan.updates[0], false);
});

test("a reviewed grocery category overwrites an unreviewed inventory one", () => {
  const row = inv({ name: "Spinach", quantity: 1, category: "Other" });
  const plan = planMoveDone(
    [
      done({
        name: "Spinach",
        quantity: 1,
        category: "Produce",
        categoryReviewed: true,
      }),
    ],
    [row],
    CATS
  );
  assert.equal(plan.updates[0].category, "Produce");
  assert.equal(plan.updates[0].categoryReviewed, true);
});

test("a grocery category that is no longer a real category is not carried over", () => {
  const row = inv({ name: "Spinach", quantity: 1, category: "Produce" });
  const plan = planMoveDone(
    [
      done({
        name: "Spinach",
        quantity: 1,
        category: "Deleted Category",
        categoryReviewed: true,
      }),
    ],
    [row],
    CATS
  );
  assert.equal("category" in plan.updates[0], false);
});

test("an inventory row nothing merges into is left out of the plan", () => {
  const plan = planMoveDone(
    [done({ name: "Milk", quantity: 1 })],
    [inv({ name: "Bread", quantity: 1 })],
    CATS
  );
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.inserts.length, 1);
});

test("a merged quantity past int4 is a ValidationError, not a plan", () => {
  let err: unknown;
  try {
    planMoveDone(
      [done({ name: "Rice", quantity: 2_000_000_000 })],
      [inv({ name: "Rice", quantity: 2_000_000_000 })],
      CATS
    );
  } catch (e) {
    err = e;
  }
  assert.ok(isValidationError(err));
  assert.match(err.message, /would exceed the maximum/);
});

test("an overflow in one row throws before any other row is planned", () => {
  // The whole point of planning up front: the innocent row must not be
  // written while the overflowing one aborts the move.
  assert.throws(
    () =>
      planMoveDone(
        [
          done({ name: "Beans", quantity: 1 }),
          done({ name: "Rice", quantity: 2_000_000_000 }),
        ],
        [inv({ name: "Rice", quantity: 2_000_000_000 })],
        CATS
      ),
    { name: "ValidationError" }
  );
});

test("repeated done rows can overflow against each other too", () => {
  assert.throws(
    () =>
      planMoveDone(
        [
          done({ name: "Rice", quantity: 2_000_000_000 }),
          done({ name: "Rice", quantity: 2_000_000_000 }),
        ],
        [],
        CATS
      ),
    { name: "ValidationError" }
  );
});

test("a merge landing exactly on the int4 ceiling is allowed", () => {
  const plan = planMoveDone(
    [done({ name: "Rice", quantity: 2_147_483_646 })],
    [inv({ name: "Rice", quantity: 1 })],
    CATS
  );
  assert.equal(plan.updates[0].quantity, 2_147_483_647);
});

/* ---------- runWritesAtomically ---------- */

/**
 * A statement stands in for a Drizzle query: it only records anything if
 * somebody awaits it, which is how the test tells "handed to batch" apart
 * from "executed one by one".
 */
function fakeWrite(label: string, ran: string[]): BatchItem<"pg"> {
  return {
    then(resolve: (value: unknown) => void) {
      ran.push(label);
      resolve(undefined);
    },
  } as unknown as BatchItem<"pg">;
}

test("a driver with batch gets every write in one batch call", async () => {
  const ran: string[] = [];
  const batches: unknown[][] = [];
  const handles: unknown[] = [];
  const fakeDb = {
    batch(items: unknown[]) {
      batches.push(items);
      return Promise.resolve([]);
    },
    transaction() {
      throw new Error("transaction must not be opened on a batching driver");
    },
  };
  const writes = [fakeWrite("a", ran), fakeWrite("b", ran)];

  await runWritesAtomically((tx) => {
    handles.push(tx);
    return writes;
  }, fakeDb as unknown as Db);

  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], writes);
  // Nothing was awaited individually, so nothing ran outside the batch.
  assert.deepEqual(ran, []);
  // The statements have to be bound to the handle that runs them.
  assert.deepEqual(handles, [fakeDb]);
});

test("an empty write list never calls batch", async () => {
  let called = 0;
  const fakeDb = {
    batch() {
      called += 1;
      return Promise.resolve([]);
    },
  };
  await runWritesAtomically(() => [], fakeDb as unknown as Db);
  assert.equal(called, 0);
});

test("a driver without batch runs the writes inside a transaction", async () => {
  const ran: string[] = [];
  const handles: unknown[] = [];
  const tx = { id: "tx" };
  let opened = 0;
  let insideTransaction = false;
  const fakeDb = {
    async transaction(fn: (tx: unknown) => Promise<unknown>) {
      opened += 1;
      insideTransaction = true;
      const out = await fn(tx);
      insideTransaction = false;
      return out;
    },
  };

  await runWritesAtomically((handle) => {
    handles.push(handle);
    assert.equal(insideTransaction, true, "build runs inside the transaction");
    return [fakeWrite("a", ran), fakeWrite("b", ran)];
  }, fakeDb as unknown as Db);

  assert.equal(opened, 1);
  assert.deepEqual(ran, ["a", "b"]);
  // Bound to the transaction handle, not the pool, or they'd commit outside.
  assert.deepEqual(handles, [tx]);
});

/* ---------- The past-month lock ---------- */

test("a month is the first seven characters of the date", () => {
  assert.equal(monthOf("2026-09-17"), "2026-09");
  assert.equal(monthOf("2026-01-01"), "2026-01");
});

test("only a month before today's month is past", () => {
  const today = "2026-09-17";
  // Same month, either side of today: still open.
  assert.equal(isPastMonth("2026-09-01", today), false);
  assert.equal(isPastMonth("2026-09-30", today), false);
  // Previous month, and across a year boundary.
  assert.equal(isPastMonth("2026-08-31", today), true);
  assert.equal(isPastMonth("2025-12-31", today), true);
  assert.equal(isPastMonth("2026-10-01", today), false);
  // December looking back at January of the same year, and January looking
  // back at December — plain string ordering handles both.
  assert.equal(isPastMonth("2026-01-31", "2026-12-01"), true);
  assert.equal(isPastMonth("2026-12-31", "2027-01-01"), true);
  assert.equal(isPastMonth("2027-01-01", "2026-12-31"), false);
});

test("a date in a settled month is refused on the way in", () => {
  assert.throws(() => validateOccurredOn("2020-01-15"), (e: unknown) => {
    assert.ok(isValidationError(e));
    assert.equal(e.message, PAST_MONTH_LOCKED_MESSAGE);
    return true;
  });
});

test("a date in the current month is accepted", () => {
  const firstOfThisMonth = `${monthOf(todayYmd())}-01`;
  assert.equal(validateOccurredOn(firstOfThisMonth), firstOfThisMonth);
  assert.equal(validateOccurredOn(todayYmd()), todayYmd());
  // Empty means "today", which is never locked.
  assert.equal(validateOccurredOn(""), todayYmd());
});
