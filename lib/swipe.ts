/**
 * The decisions behind swipe-to-delete, kept apart from the component that
 * draws it so they can be read and tested on their own.
 *
 * One number describes the whole gesture: `offset`, how far the row has been
 * pulled to the left of where it rests, in CSS pixels. 0 is shut, positive
 * means the red layer behind it is showing. Nothing here knows about pointers
 * or the DOM.
 */

/** How much of the red layer a row shows once it rests open. */
export const REVEAL_WIDTH = 64;

/** The round delete button centred in that strip. */
export const DELETE_BUTTON_SIZE = 44;

/** Gap either side of the button inside the revealed strip. */
const BUTTON_INSET = (REVEAL_WIDTH - DELETE_BUTTON_SIZE) / 2;

/**
 * Travel before the gesture commits to an axis. Under this the finger has
 * done nothing yet, so neither we nor the page reacts.
 */
export const AXIS_LOCK_PX = 10;

/** Released under this much travel, the row snaps shut again. */
export const SNAP_OPEN_PX = 28;

/** Released at or past the delete threshold, the row is deleted. */
export const DELETE_FRACTION = 0.45;
export const DELETE_MIN_PX = 140;
export const DELETE_MAX_PX = 220;

/** Scrolling the page this far closes an open row. */
export const SCROLL_CLOSE_PX = 24;

/**
 * How far a row has to travel before releasing it deletes: a share of the
 * row, so it feels the same on a phone and on a desktop, but clamped at both
 * ends so it is never a flick and never half a wide screen.
 */
export function deleteThreshold(rowWidth: number): number {
  const share = rowWidth * DELETE_FRACTION;
  return Math.min(DELETE_MAX_PX, Math.max(DELETE_MIN_PX, share));
}

/**
 * The furthest a row can be pulled. One reveal width past the delete
 * threshold: far enough that the threshold is always reachable (even on a row
 * narrower than the minimum), short enough that the row never leaves.
 */
export function maxOffset(rowWidth: number): number {
  return deleteThreshold(rowWidth) + REVEAL_WIDTH;
}

/** Keeps a raw offset inside the travel the row allows. */
export function clampOffset(raw: number, rowWidth: number): number {
  return Math.min(maxOffset(rowWidth), Math.max(0, raw));
}

export type Axis = "pending" | "horizontal" | "abandon";

/**
 * Whether this touch is a swipe yet. Nothing happens inside the lock
 * distance; past it, the larger of the two travels wins outright, so a drag
 * that is mostly down the page is handed back to the browser to scroll with
 * and never comes back to us for that touch.
 */
export function axisDecision(dx: number, dy: number): Axis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < AXIS_LOCK_PX) return "pending";
  return ax > ay ? "horizontal" : "abandon";
}

export type Release = "closed" | "open" | "delete";

/** What letting go at `offset` does. */
export function releaseOutcome(offset: number, rowWidth: number): Release {
  if (offset >= deleteThreshold(rowWidth)) return "delete";
  if (offset >= SNAP_OPEN_PX) return "open";
  return "closed";
}

/** True while letting go would delete, which is what the red state shows. */
export function isArmed(offset: number, rowWidth: number): boolean {
  return offset >= deleteThreshold(rowWidth);
}

/**
 * Where the round button sits, measured from the row's right edge.
 *
 * At rest it is centred in the revealed strip. Once the row has travelled
 * further than that strip the button rides with the row's trailing edge,
 * staying `BUTTON_INSET` to the right of it, so pulling harder visibly drags
 * the button along instead of stranding it.
 */
export function buttonRight(offset: number): number {
  return Math.max(BUTTON_INSET, offset - REVEAL_WIDTH + BUTTON_INSET);
}
