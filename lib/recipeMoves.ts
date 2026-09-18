/**
 * Moving a dinner from one day to another, decided in memory.
 *
 * Dragging a card onto another day is one gesture with two meanings: the day
 * you drop on is either free (a plain move) or already taken (a swap — the
 * two cards trade days, so a cook travels with the dinner they signed up for
 * and a "no meal" marker lands on the day that was vacated).
 *
 * The plan is pure so the slot arithmetic can be tested without a database,
 * and so nothing is written until the whole move is known to be legal.
 */

import { nextWeekStart, thisWeekStart } from "./dates";
import { NotFoundError, ValidationError } from "./errors";

/** The columns a move is allowed to change. */
export type RecipeSlot = { weekStart: string; day: number };

/** What the planner reads off a recipe row; `Recipe` satisfies it. */
export type MovableRecipe = RecipeSlot & { id: string };

export type RecipeMovePlan = {
  /** `week_start`/`day` rewrites, to be applied in this order. */
  writes: MovableRecipe[];
  /**
   * Where the moved row came from. Replaying it through the same operation
   * reverses the move — and a swap too, because moving the row back onto its
   * old day finds the other row sitting there and swaps them again.
   */
  undo: MovableRecipe;
};

/**
 * Where a row waits out the middle of a swap. Two rows may not share a slot
 * for even one statement — the unique index on (week_start, day) is checked
 * per statement, not at commit — so the first row steps aside to a day number
 * no real day uses. Nobody ever sees it: the writes are one transaction.
 */
const PARKING_DAY = -1;

const OUT_OF_RANGE = "Recipes only move within this week and next week";

function requireMovableSlot(slot: RecipeSlot, weeks: string[]): void {
  if (
    typeof slot.day !== "number" ||
    !Number.isInteger(slot.day) ||
    slot.day < 0 ||
    slot.day > 6
  ) {
    throw new ValidationError("Day must be Sunday through Saturday (0-6)");
  }
  if (!weeks.includes(slot.weekStart)) throw new ValidationError(OUT_OF_RANGE);
}

/**
 * The ordered slot rewrites that move `id` onto `target`.
 *
 * `rows` is the set of rows the move can see (this week and next). Both the
 * row being moved and the day it is dropped on must be inside that window:
 * past weeks are read-only history. Moving a row onto the day it already
 * occupies is a no-op and plans no writes.
 */
export function planRecipeMove(
  rows: MovableRecipe[],
  id: string,
  target: RecipeSlot,
  now: Date = new Date()
): RecipeMovePlan {
  const source = rows.find((r) => r.id === id);
  if (!source) throw new NotFoundError();

  const weeks = [thisWeekStart(now), nextWeekStart(now)];
  requireMovableSlot(target, weeks);
  requireMovableSlot(source, weeks);

  const undo = { id: source.id, weekStart: source.weekStart, day: source.day };
  if (source.weekStart === target.weekStart && source.day === target.day) {
    return { writes: [], undo };
  }

  const occupant = rows.find(
    (r) =>
      r.id !== source.id &&
      r.weekStart === target.weekStart &&
      r.day === target.day
  );
  if (!occupant) {
    return {
      writes: [{ id: source.id, weekStart: target.weekStart, day: target.day }],
      undo,
    };
  }

  return {
    writes: [
      { id: source.id, weekStart: source.weekStart, day: PARKING_DAY },
      { id: occupant.id, weekStart: source.weekStart, day: source.day },
      { id: source.id, weekStart: target.weekStart, day: target.day },
    ],
    undo,
  };
}
