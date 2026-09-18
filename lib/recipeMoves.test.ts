import assert from "node:assert/strict";
import test from "node:test";

import { planRecipeMove } from "./recipeMoves";
import type { MovableRecipe } from "./recipeMoves";
import { NotFoundError, ValidationError } from "./errors";
import { nextWeekStart, thisWeekStart } from "./dates";

// Fixed clock so "this week" and "next week" don't move under the tests.
const NOW = new Date("2026-09-18T16:00:00Z");
const THIS = thisWeekStart(NOW);
const NEXT = nextWeekStart(NOW);
const PAST = thisWeekStart(new Date(NOW.getTime() - 7 * 86_400_000));

// "No meal" markers are ordinary rows as far as the planner is concerned —
// only the ids below say which is which, and that is the point: a marker
// moves and swaps under exactly the same rules as a dinner.
function row(id: string, weekStart: string, day: number): MovableRecipe {
  return { id, weekStart, day };
}

function plan(rows: MovableRecipe[], id: string, weekStart: string, day: number) {
  return planRecipeMove(rows, id, { weekStart, day }, NOW);
}

/**
 * Replays the writes the way Postgres will, asserting after every single one
 * that no two rows share a slot: the unique index on (week_start, day) is
 * checked per statement, so a plan that is only correct at the end would be
 * rejected halfway through.
 */
function apply(rows: MovableRecipe[], writes: MovableRecipe[]): MovableRecipe[] {
  const next = rows.map((r) => ({ ...r }));
  for (const write of writes) {
    const target = next.find((r) => r.id === write.id);
    assert.ok(target, `write names a row that does not exist: ${write.id}`);
    target.weekStart = write.weekStart;
    target.day = write.day;
    const slots = next.map((r) => `${r.weekStart}#${r.day}`);
    assert.equal(
      new Set(slots).size,
      slots.length,
      `two rows shared a slot after writing ${write.id}`
    );
  }
  return next;
}

function slotOf(rows: MovableRecipe[], id: string) {
  const found = rows.find((r) => r.id === id);
  assert.ok(found, `no row ${id}`);
  return { weekStart: found.weekStart, day: found.day };
}

test("moving onto an empty day is a single write", () => {
  const rows = [row("a", THIS, 2)];
  const result = plan(rows, "a", THIS, 4);
  assert.deepEqual(result.writes, [{ id: "a", weekStart: THIS, day: 4 }]);
  assert.deepEqual(result.undo, { id: "a", weekStart: THIS, day: 2 });
  assert.deepEqual(slotOf(apply(rows, result.writes), "a"), {
    weekStart: THIS,
    day: 4,
  });
});

test("moving onto a taken day swaps the two rows via the parking slot", () => {
  const rows = [row("a", THIS, 2), row("b", THIS, 5)];
  const result = plan(rows, "a", THIS, 5);
  assert.deepEqual(result.writes, [
    { id: "a", weekStart: THIS, day: -1 },
    { id: "b", weekStart: THIS, day: 2 },
    { id: "a", weekStart: THIS, day: 5 },
  ]);
  const after = apply(rows, result.writes);
  assert.deepEqual(slotOf(after, "a"), { weekStart: THIS, day: 5 });
  assert.deepEqual(slotOf(after, "b"), { weekStart: THIS, day: 2 });
});

test("a dinner dropped on a marker sends the marker to the vacated day", () => {
  const rows = [row("dinner", THIS, 3), row("marker", THIS, 1)];
  const after = apply(rows, plan(rows, "dinner", THIS, 1).writes);
  assert.deepEqual(slotOf(after, "dinner"), { weekStart: THIS, day: 1 });
  assert.deepEqual(slotOf(after, "marker"), { weekStart: THIS, day: 3 });
});

test("a marker moves onto an empty day like any other row", () => {
  const rows = [row("marker", THIS, 1)];
  const result = plan(rows, "marker", THIS, 6);
  assert.deepEqual(result.writes, [{ id: "marker", weekStart: THIS, day: 6 }]);
});

test("a marker dropped on a dinner swaps with it", () => {
  const rows = [row("marker", THIS, 1), row("dinner", THIS, 4)];
  const after = apply(rows, plan(rows, "marker", THIS, 4).writes);
  assert.deepEqual(slotOf(after, "marker"), { weekStart: THIS, day: 4 });
  assert.deepEqual(slotOf(after, "dinner"), { weekStart: THIS, day: 1 });
});

test("a row moves from this week into next week", () => {
  const rows = [row("a", THIS, 6)];
  const result = plan(rows, "a", NEXT, 0);
  assert.deepEqual(result.writes, [{ id: "a", weekStart: NEXT, day: 0 }]);
  assert.deepEqual(result.undo, { id: "a", weekStart: THIS, day: 6 });
});

test("a row moves from next week back into this week", () => {
  const rows = [row("a", NEXT, 0)];
  const result = plan(rows, "a", THIS, 6);
  assert.deepEqual(result.writes, [{ id: "a", weekStart: THIS, day: 6 }]);
  assert.deepEqual(result.undo, { id: "a", weekStart: NEXT, day: 0 });
});

test("a cross-week swap parks in the source week", () => {
  const rows = [row("a", THIS, 2), row("b", NEXT, 2)];
  const result = plan(rows, "a", NEXT, 2);
  assert.deepEqual(result.writes, [
    { id: "a", weekStart: THIS, day: -1 },
    { id: "b", weekStart: THIS, day: 2 },
    { id: "a", weekStart: NEXT, day: 2 },
  ]);
  const after = apply(rows, result.writes);
  assert.deepEqual(slotOf(after, "a"), { weekStart: NEXT, day: 2 });
  assert.deepEqual(slotOf(after, "b"), { weekStart: THIS, day: 2 });
});

test("moving a row onto the day it already occupies writes nothing", () => {
  const rows = [row("a", THIS, 3), row("b", THIS, 4)];
  const result = plan(rows, "a", THIS, 3);
  assert.deepEqual(result.writes, []);
  assert.deepEqual(result.undo, { id: "a", weekStart: THIS, day: 3 });
});

test("replaying the undo slot reverses a plain move", () => {
  const rows = [row("a", THIS, 2)];
  const first = plan(rows, "a", NEXT, 5);
  const moved = apply(rows, first.writes);
  const back = plan(moved, first.undo.id, first.undo.weekStart, first.undo.day);
  assert.deepEqual(apply(moved, back.writes), rows);
});

test("replaying the undo slot reverses a swap", () => {
  const rows = [row("a", THIS, 2), row("b", THIS, 5)];
  const first = plan(rows, "a", THIS, 5);
  const swapped = apply(rows, first.writes);
  const back = plan(swapped, first.undo.id, first.undo.weekStart, first.undo.day);
  assert.deepEqual(apply(swapped, back.writes), rows);
});

test("a source in a past week is rejected", () => {
  const rows = [row("old", PAST, 3)];
  assert.throws(() => plan(rows, "old", THIS, 3), ValidationError);
});

test("a target in a past week is rejected", () => {
  const rows = [row("a", THIS, 3)];
  assert.throws(() => plan(rows, "a", PAST, 3), ValidationError);
});

test("a target two weeks out is rejected", () => {
  const rows = [row("a", THIS, 3)];
  const later = nextWeekStart(new Date(NOW.getTime() + 7 * 86_400_000));
  assert.throws(() => plan(rows, "a", later, 3), ValidationError);
});

test("an unknown id is not found", () => {
  assert.throws(() => plan([row("a", THIS, 3)], "nope", THIS, 4), NotFoundError);
});

test("a day outside Sunday through Saturday is rejected", () => {
  const rows = [row("a", THIS, 3)];
  for (const day of [-1, 7, 1.5, Number.NaN]) {
    assert.throws(() => plan(rows, "a", THIS, day), ValidationError);
  }
});

test("a malformed target week is rejected before anything else", () => {
  const rows = [row("a", THIS, 3)];
  assert.throws(() => plan(rows, "a", "not-a-date", 3), ValidationError);
});
