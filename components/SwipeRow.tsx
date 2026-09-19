"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconTrash } from "@/components/fresh/icons";
import {
  REVEAL_WIDTH,
  SCROLL_CLOSE_PX,
  type Axis,
  axisDecision,
  buttonRight,
  clampOffset,
  isArmed,
  releaseOutcome,
} from "@/lib/swipe";
import { useEscapeLayer } from "@/lib/escapeStack";

type Props = {
  /** This row's id, which is how the list knows which row is open. */
  id: string;
  /** The one row the list currently has open, or null. */
  openId: string | null;
  /** Must be stable (a `useState` setter): the scroll watcher depends on it. */
  onOpenChange: (id: string | null) => void;
  /** Reads as a sentence on the button: "Delete Milk". */
  label: string;
  onDelete: () => void;
  children: React.ReactNode;
};

/**
 * A list row you can swipe left to delete, used by both looks.
 *
 * Two layers: a red one that stays put, holding the round delete button, and
 * the row itself on top, translated left under the finger. The decisions
 * (when a drag counts as a swipe, where it snaps, when it deletes) all live
 * in `lib/swipe.ts`.
 *
 * Nothing here depends on a transition or a keyframe — animations are off on
 * the owner's machines. The row follows the pointer through a transform
 * written once per frame, and snapping open or shut is a jump.
 */
export default function SwipeRow({
  id,
  openId,
  onOpenChange,
  label,
  onDelete,
  children,
}: Props) {
  const open = openId === id;
  const rootRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);

  // Only two things about the gesture are worth a render: whether the row is
  // moving (which turns off text selection and clips the overhang) and
  // whether letting go would delete (the red state).
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);

  // Everything else changes per pointer move and is read back inside the
  // window listeners, so it lives in a ref rather than in state.
  const g = useRef({
    pointerId: null as number | null,
    startX: 0,
    startY: 0,
    startOffset: 0,
    axis: "pending" as Axis,
    offset: 0,
    width: 0,
    frame: 0,
  });
  /** The click that follows a swipe belongs to the swipe, not to the row. */
  const suppressClick = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const listeners = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
  } | null>(null);

  function paint(offset: number) {
    const front = frontRef.current;
    if (front) front.style.transform = `translateX(${-offset}px)`;
    rootRef.current?.style.setProperty(
      "--swipe-btn-right",
      `${buttonRight(offset)}px`
    );
  }

  // Re-assert the transform after every render, so a list refresh landing
  // mid-gesture cannot snap the row back under the finger, and a row closed
  // by another row opening lands shut without anyone telling it to paint.
  useLayoutEffect(() => {
    if (g.current.axis !== "horizontal") {
      g.current.offset = open ? REVEAL_WIDTH : 0;
    }
    paint(g.current.offset);
  });

  // Escape and the phone's Back button shut the open row through the shared
  // layer stack, never a keydown listener of its own: with a sheet open over
  // the list, one Escape must close the sheet and nothing else.
  useEscapeLayer(() => onOpenChange(null), open);

  // A scroll long enough to read as the user moving on shuts it too.
  // Deliberately not a window click listener: a click that dismisses must
  // never also press what is underneath it.
  useEffect(() => {
    if (!open) return;
    const from = window.scrollY;
    function onScroll() {
      if (Math.abs(window.scrollY - from) > SCROLL_CLOSE_PX) onOpenChange(null);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open, onOpenChange]);

  // A row can be unmounted mid-gesture by a list refresh or by its own
  // delete; its window listeners have to go with it.
  useEffect(() => detach, []);

  function detach() {
    const s = g.current;
    if (s.frame) {
      cancelAnimationFrame(s.frame);
      s.frame = 0;
    }
    const front = frontRef.current;
    if (front && s.pointerId !== null && front.hasPointerCapture(s.pointerId)) {
      front.releasePointerCapture(s.pointerId);
    }
    s.pointerId = null;
    s.axis = "pending";
    const l = listeners.current;
    if (l) {
      listeners.current = null;
      window.removeEventListener("pointermove", l.move);
      window.removeEventListener("pointerup", l.up);
      window.removeEventListener("pointercancel", l.cancel);
    }
  }

  function reset() {
    detach();
    setDragging(false);
    setArmed(false);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // A second finger while one is already swiping is not a second swipe.
    if (g.current.pointerId !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    // A tap that never became a swipe must not eat the click behind it.
    suppressClick.current = false;
    const offset = openRef.current ? REVEAL_WIDTH : 0;
    g.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffset: offset,
      axis: "pending",
      offset,
      width: root.getBoundingClientRect().width,
      frame: 0,
    };
    const l = {
      move: (ev: PointerEvent) => onMove(ev),
      up: (ev: PointerEvent) => onUp(ev),
      cancel: (ev: PointerEvent) => {
        if (ev.pointerId === g.current.pointerId) reset();
      },
    };
    listeners.current = l;
    // On window rather than on the row: a fast drag leaves the row behind
    // before the gesture has locked and taken the pointer.
    window.addEventListener("pointermove", l.move);
    window.addEventListener("pointerup", l.up);
    window.addEventListener("pointercancel", l.cancel);
  }

  function onMove(e: PointerEvent) {
    const s = g.current;
    if (e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;

    if (s.axis === "pending") {
      const decision = axisDecision(dx, dy);
      if (decision === "pending") return;
      if (decision === "abandon") {
        // Mostly down the page: hand this touch back and let it scroll.
        reset();
        return;
      }
      s.axis = "horizontal";
      setDragging(true);
      frontRef.current?.setPointerCapture(e.pointerId);
      // Starting a swipe anywhere shuts whatever row was open.
      if (!openRef.current) onOpenChange(null);
    }

    // Stops a mouse drag from selecting the row's text on the way past.
    if (e.cancelable) e.preventDefault();

    const next = clampOffset(s.startOffset - dx, s.width);
    if (next !== s.offset) {
      s.offset = next;
      if (!s.frame) {
        s.frame = requestAnimationFrame(() => {
          g.current.frame = 0;
          paint(g.current.offset);
        });
      }
    }
    const nowArmed = isArmed(s.offset, s.width);
    setArmed((was) => (was === nowArmed ? was : nowArmed));
  }

  function onUp(e: PointerEvent) {
    const s = g.current;
    if (e.pointerId !== s.pointerId) return;
    const swiped = s.axis === "horizontal";
    const offset = s.offset;
    const width = s.width;
    reset();
    if (!swiped) return;

    // Whatever click the browser sends after this pointerup is part of the
    // swipe: it must not open the edit sheet or tick the checkbox.
    suppressClick.current = true;
    const outcome = releaseOutcome(offset, width);
    if (outcome === "delete") {
      onOpenChange(null);
      onDelete();
      return;
    }
    onOpenChange(outcome === "open" ? id : null);
    g.current.offset = outcome === "open" ? REVEAL_WIDTH : 0;
    paint(g.current.offset);
  }

  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Tapping an open row shuts it, and so does tapping any other row while
    // one is open. Either way that tap does nothing else.
    if (openIdRef.current !== null) {
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(null);
    }
  }

  function onDeleteClick(e: React.MouseEvent<HTMLButtonElement>) {
    // Pressed from the keyboard, the button is about to vanish with the focus
    // on it; hand the focus to the neighbouring row so the list keeps its
    // place. (A pointer press has no focus position worth keeping.)
    if (e.detail === 0) {
      const root = rootRef.current;
      const neighbour = (root?.nextElementSibling ?? root?.previousElementSibling) as
        | HTMLElement
        | null
        | undefined;
      neighbour
        ?.querySelector<HTMLElement>(".swipe-front button, .swipe-front [tabindex]")
        ?.focus();
    }
    onOpenChange(null);
    onDelete();
  }

  return (
    <div
      ref={rootRef}
      className={`swipe-row${open || dragging ? " is-active" : ""}${
        dragging ? " is-swiping" : ""
      }${armed ? " is-armed" : ""}`}
    >
      {/* Closed, the button is not on the page as far as the keyboard and a
          screen reader are concerned: `inert` also stops a stray tap on the
          strip reaching it. */}
      <div className="swipe-back" inert={!open} aria-hidden={open ? undefined : true}>
        <button
          type="button"
          className="swipe-delete"
          aria-label={label}
          tabIndex={open ? 0 : -1}
          onClick={onDeleteClick}
        >
          <IconTrash size={20} />
        </button>
      </div>
      <div
        ref={frontRef}
        className="swipe-front"
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
