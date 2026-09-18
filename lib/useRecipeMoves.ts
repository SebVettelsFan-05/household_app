"use client";

import { useEffect, useRef, useState } from "react";
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Active,
  type ClientRect,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { moveRecipe, type MoveTarget } from "@/lib/client";
import { shortDayLabel } from "@/lib/dates";
import type { Recipe } from "@/lib/types";
import type { ToastAction } from "@/components/Toast";

export type { MoveTarget };

/**
 * Moving a dinner to another day, shared by both shells.
 *
 * One gesture, two ways to reach it: tap the grab handle and then tap a day
 * (`pickUp` / `dropOn`), or drag the handle onto one (dnd-kit, `moveTo` from
 * the drag end). Both post the same thing, and the server decides whether the
 * landing day is free (a move) or taken (a swap) — see `docs/SHARED_KITCHEN.md`.
 *
 * The list is updated optimistically under the same rule the server uses, so
 * the card is already on its new day by the time the request goes out, and
 * rolls back to exactly what was on screen if the server refuses.
 */

/** Droppable ids. Day rows and strip cells cover the same slot, so they differ. */
export function slotDropId(weekStart: string, day: number): string {
  return `slot:${weekStart}:${day}`;
}
/** The strip is drawn twice (phone above the list, column inside a week). */
export function stripDropId(
  variant: string,
  weekStart: string,
  day: number
): string {
  return `strip:${variant}:${weekStart}:${day}`;
}

/** What a card says it is, in a sentence: a dish name, or the marker. */
export function dishLabel(recipe: Recipe): string {
  return recipe.noMeal ? "the no-meal day" : recipe.name || "this dinner";
}

/**
 * The list as it will look once the server has moved `id` onto `target`:
 * an empty day takes the row, a taken one trades days with it. A marker is
 * a row like any other, so it rides along on the swap.
 */
export function applyMove(
  recipes: Recipe[],
  id: string,
  target: MoveTarget
): Recipe[] {
  const moved = recipes.find((r) => r.id === id);
  if (!moved) return recipes;
  const other = recipes.find(
    (r) =>
      r.id !== id && r.weekStart === target.weekStart && r.day === target.day
  );
  return recipes.map((r) => {
    if (r.id === id) return { ...r, weekStart: target.weekStart, day: target.day };
    if (other && r.id === other.id) {
      return { ...r, weekStart: moved.weekStart, day: moved.day };
    }
    return r;
  });
}

/**
 * Pointer drags start after 6px so a click still reads as a click; touch
 * drags need a 200ms hold and abort if the finger travels 8px first, which
 * is what keeps a scroll from turning into a drag.
 *
 * `MouseSensor`, not `PointerSensor`: a pointerdown fires before a touchstart,
 * so a PointerSensor would always win on a phone and the touch delay above
 * would never apply — every scroll that began on a handle would pick the card
 * up. Mouse and touch therefore get one sensor each.
 */
export function useMoveSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: moveCoordinateGetter })
  );
}

/** Day rows, as opposed to the week strip covering the same days. */
const SLOT_PREFIX = "slot:";

type Center = { x: number; y: number };

function centerOf(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): Center {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * A pointer has to be over a day for it to count.
 *
 * A keyboard drag has no pointer, so it is measured from a day rather than
 * from pixels: the day the card has been stepped onto, or the day it came
 * from before any arrow key. Measuring the drag overlay instead would read
 * as whichever day its corner happened to be nearest, which on a wide
 * screen can be next week's column.
 */
export const moveCollisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates) return pointerWithin(args);
  const slots = args.droppableContainers.filter((c) =>
    String(c.id).startsWith(SLOT_PREFIX)
  );
  return closestCenter({
    ...args,
    droppableContainers: slots,
    collisionRect: keyboardRect(args.active, args.collisionRect, args.droppableRects),
  });
};

/** True when `rect` has been landed exactly on `on` by a keyboard step. */
function centeredOn(rect: ClientRect, on: ClientRect): boolean {
  const a = centerOf(rect);
  const b = centerOf(on);
  return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
}

/** The day a keyboard drag counts as being over. */
function keyboardRect(
  active: Active,
  collisionRect: ClientRect,
  rects: Map<UniqueIdentifier, ClientRect>
): ClientRect {
  for (const [id, rect] of rects) {
    if (!String(id).startsWith(SLOT_PREFIX) || !rect) continue;
    if (centeredOn(collisionRect, rect)) return rect;
  }
  const start = active.data.current as MoveTarget | undefined;
  const from = start
    ? rects.get(slotDropId(start.weekStart, start.day))
    : undefined;
  return from ?? collisionRect;
}

/**
 * Arrow keys step from day to day rather than by a fixed number of pixels:
 * the default getter moves 25px a press, which takes four presses to cross
 * one row and stops meaning anything once the two weeks sit side by side.
 * Only the day rows are candidates — the week strip covers the same days and
 * would otherwise double every step.
 */
export const moveCoordinateGetter: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates }
) => {
  const axis =
    event.code === "ArrowDown" || event.code === "ArrowUp"
      ? "y"
      : event.code === "ArrowRight" || event.code === "ArrowLeft"
        ? "x"
        : null;
  if (!axis || !context.collisionRect) return;
  const sign = event.code === "ArrowDown" || event.code === "ArrowRight" ? 1 : -1;

  // Steps are counted from the day the card is over — its own day on the
  // first press — not from the handle it was picked up by, which sits in a
  // corner of that day and would make the first step land back on it.
  const start = context.active?.data.current as MoveTarget | undefined;
  const over = context.over?.id;
  const anchorId =
    over != null && String(over).startsWith(SLOT_PREFIX)
      ? over
      : start
        ? slotDropId(start.weekStart, start.day)
        : undefined;
  const anchorRect =
    (anchorId != null ? context.droppableRects.get(anchorId) : null) ??
    context.collisionRect;
  const from = centerOf(anchorRect);

  let best: Center | null = null;
  let bestCost = Infinity;
  for (const [id, rect] of context.droppableRects) {
    if (!String(id).startsWith(SLOT_PREFIX) || !rect) continue;
    if (id === anchorId) continue;
    const container = context.droppableContainers.get(id);
    if (!container || container.disabled) continue;
    const to = centerOf(rect);
    const along = (to[axis] - from[axis]) * sign;
    if (along <= 1) continue;
    const across = Math.abs(axis === "y" ? to.x - from.x : to.y - from.y);
    // Crossing to the other week costs four times the distance, so a step
    // down stays in this week's column while there are days left in it.
    const cost = along + across * 4;
    if (cost < bestCost) {
      bestCost = cost;
      best = to;
    }
  }
  if (!best) return;
  // The coordinates dnd-kit tracks belong to the card being dragged, so the
  // step is applied to where that card is now.
  const here = centerOf(context.collisionRect);
  return {
    x: currentCoordinates.x + (best.x - here.x),
    y: currentCoordinates.y + (best.y - here.y),
  };
};

export function useRecipeMoves({
  recipes,
  onRecipesChange,
  onToast,
}: {
  recipes: Recipe[];
  onRecipesChange: (next: Recipe[]) => void;
  /** The shell's one toast slot; an action turns it into the Undo toast. */
  onToast: (msg: string, action?: ToastAction) => void;
}) {
  const [movingId, setMovingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  // The guard has to be readable inside the same tick a second drop lands in,
  // which the state above is not.
  const busyRef = useRef(false);
  // The Undo button is held by the shell's toast, so the callback it carries
  // outlives the render that built it: it has to read the list as it is now,
  // not as it was before the move it is undoing.
  const recipesRef = useRef(recipes);
  recipesRef.current = recipes;

  const moving = recipes.find((r) => r.id === movingId) ?? null;
  // A row that was deleted (or moved away by somebody else) under a pending
  // pick-up leaves the moving state pointing at nothing.
  if (movingId && !moving) setMovingId(null);

  // Escape drops a pending tap-to-move. dnd-kit's own sensors handle Escape
  // during a drag; this is for the tap path, where nothing is dragging.
  useEffect(() => {
    if (!movingId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMovingId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [movingId]);

  async function runMove(id: string, target: MoveTarget, offerUndo: boolean) {
    if (busyRef.current) return;
    const before = recipesRef.current;
    const row = before.find((r) => r.id === id);
    if (!row) return;
    // Dropping a card on the day it already occupies is not a move.
    if (row.weekStart === target.weekStart && row.day === target.day) return;

    busyRef.current = true;
    setBusy(true);
    onRecipesChange(applyMove(before, id, target));
    try {
      const res = await moveRecipe(id, target);
      onRecipesChange(res.recipes);
      if (offerUndo) {
        const slot = res.undo;
        onToast(
          `Moved ${dishLabel(row)} to ${shortDayLabel(target.weekStart, target.day)}`,
          {
            label: "Undo",
            onClick: () =>
              void runMove(
                slot.id,
                { weekStart: slot.weekStart, day: slot.day },
                false
              ),
          }
        );
      } else {
        onToast("Move undone");
      }
    } catch (err) {
      onRecipesChange(before);
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return {
    /** The row waiting for a day, whether it was tapped or is being dragged. */
    moving,
    busy,
    /**
     * True while a pointer or the keyboard is actually dragging. The tap
     * hint is hidden then: it would appear under the pointer mid-drag and
     * push the day it is aimed at down the page.
     */
    dragging,
    pickUp(id: string) {
      if (busyRef.current) return;
      setMovingId(id);
    },
    startDrag(id: string) {
      setMovingId(id);
      setDragging(true);
    },
    cancel() {
      setMovingId(null);
      setDragging(false);
    },
    /** Lands the row that was picked up. */
    dropOn(target: MoveTarget) {
      const id = movingId;
      setMovingId(null);
      setDragging(false);
      if (id) void runMove(id, target, true);
    },
    /** Lands a named row: the end of a drag, which carries its own id. */
    moveTo(id: string, target: MoveTarget) {
      setMovingId(null);
      setDragging(false);
      void runMove(id, target, true);
    },
  };
}
