"use client";

/**
 * One Escape key, one layer at a time.
 *
 * Every overlay used to add its own `window` keydown listener, so Escape on a
 * receipt lightbox opened over the add-expense sheet closed both of them and
 * threw the half-filled form away. Here the layers form a stack: mounting
 * pushes, unmounting pops, and the single window listener only ever calls the
 * handler on top.
 *
 * A layer that hands over its container element also gets the other half of
 * being modal — focus moves into it when it opens, Tab cycles inside it, and
 * focus returns to whatever opened it when it closes. Only the top layer
 * traps Tab, so a lightbox nested inside a sheet keeps the keyboard to itself
 * without the sheet underneath fighting it for focus.
 *
 * Each layer also owns one history entry, so the phone's Back button and the
 * PWA's back gesture close the top layer instead of leaving the app.
 */

import { useEffect, useRef, type RefObject } from "react";

type Layer = {
  onClose: () => void;
  container: HTMLElement | null;
  /** The history entry this layer pushed, null until the push lands. */
  historyId: number | null;
};

const layers: Layer[] = [];

let nextHistoryId = 1;

/** The layer id stamped on the history entry the browser is sitting on. */
function currentLayerId(): number | null {
  const state = window.history.state as { hhLayer?: unknown } | null;
  return typeof state?.hhLayer === "number" ? state.hhLayer : null;
}

/**
 * The entry a closing layer asked the browser to pop, until that pop lands.
 * `history.back()` is asynchronous, so a layer opened in the same commit (the
 * recipe editor a favorite opens as the Favorites sheet closes) has already
 * pushed its own entry on top by the time the pop arrives. Without this the
 * handler would read that layer as "above the landed entry" and close it the
 * moment it opened.
 */
let pendingSelfPop: number | null = null;
let popListening = false;

function onPopState() {
  // In practice the browser lands on the entry below the closed layer's (a
  // tab entry, or the layer beneath), never on the closed layer's own.
  const landed = currentLayerId();
  if (pendingSelfPop !== null) {
    const popped = pendingSelfPop;
    pendingSelfPop = null;
    // Layers that pushed after the pop was issued now sit on forward entries
    // the browser just walked away from. Give each a fresh entry, in order,
    // so Back keeps closing them one at a time.
    const stranded = layers.filter(
      (l) => l.historyId !== null && l.historyId > popped
    );
    if (stranded.length > 0) {
      for (const l of stranded) {
        l.historyId = nextHistoryId++;
        window.history.pushState(
          { ...window.history.state, hhLayer: l.historyId },
          ""
        );
      }
      return;
    }
  }
  // Back walked past the entry of every layer stacked above the one it landed
  // on, so those layers go with it — the top one first.
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    if (layers[i].historyId === landed) break;
    layers[i].onClose();
  }
  // An entry no open layer owns (a layer that closed while another was
  // opening) is not a screen the user can stand on: step past it.
  if (landed !== null && !layers.some((l) => l.historyId === landed)) {
    pendingSelfPop = landed;
    window.history.back();
  }
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0
  );
}

function onKeyDown(e: KeyboardEvent) {
  const top = layers[layers.length - 1];
  if (!top) return;

  if (e.key === "Escape") {
    e.preventDefault();
    top.onClose();
    return;
  }

  if (e.key !== "Tab" || !top.container) return;
  const root = top.container;
  const items = focusableIn(root);
  if (items.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const inside = Boolean(active && root.contains(active));
  if (e.shiftKey) {
    if (!inside || active === first || active === root) {
      e.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Hands the keyboard back to `el`.
 *
 * Deferred by a frame when `el` is not being rendered yet. An opener can be
 * hidden for exactly as long as the layer it opened is on screen — the fresh
 * shell does that to the FAB (`.fresh:has(.fresh-sheet-bg) .fresh-fab`), and
 * `focus()` on a `display: none` element is a silent no-op — so if it is not
 * rendered now, try again once the layer's own DOM has gone.
 */
function focusWhenRendered(el: HTMLElement): void {
  if (!el.isConnected) return;
  if (el.getClientRects().length > 0) {
    el.focus();
    return;
  }
  requestAnimationFrame(() => {
    if (el.isConnected && el.getClientRects().length > 0) el.focus();
  });
}

/**
 * Registers this overlay as the top layer while it is mounted and `active`.
 *
 * `container` is optional; passing it adds the focus trap and the focus
 * hand-back. The element it points at must be focusable (`tabIndex={-1}`).
 */
export function useEscapeLayer(
  onClose: () => void,
  active = true,
  container?: RefObject<HTMLElement | null>
): void {
  // Read through a ref so a new inline `onClose` on every render doesn't
  // re-push the layer and shuffle the stack order.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // The opener, remembered across React's StrictMode remount (below).
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    // The element, not the ref: React may have detached the ref by the time
    // this effect is cleaned up.
    const el = container?.current ?? null;
    // Whatever had the keyboard when this layer opened. StrictMode mounts,
    // cleans up and remounts this effect inside one task, and the first pass
    // has already pulled focus into `el` — so on the second pass the answer
    // is the container itself, which would make the hand-back a no-op. The
    // ref outlives the remount, so reuse what the first pass saw.
    const focused = document.activeElement as HTMLElement | null;
    const opener =
      el && focused && el.contains(focused) ? openerRef.current : focused;
    openerRef.current = opener;
    const layer: Layer = {
      onClose: () => closeRef.current(),
      container: el,
      historyId: null,
    };
    if (layers.length === 0) {
      window.addEventListener("keydown", onKeyDown);
    }
    // The popstate listener stays registered for the life of the page. A
    // layer that closes itself fires a pop that lands after it is gone; if
    // nobody were listening then, `pendingSelfPop` would never clear and the
    // next real Back press would be read as that stale pop and swallowed.
    if (!popListening) {
      window.addEventListener("popstate", onPopState);
      popListening = true;
    }
    layers.push(layer);
    el?.focus();

    // The entry Back consumes to close this layer. It is pushed a microtask
    // late on purpose: StrictMode mounts, cleans up and remounts this effect
    // inside one task, and an entry pushed on the first pass would have to be
    // popped again — that pop lands after the second pass has pushed its own
    // entry and would close the layer the moment it opened.
    queueMicrotask(() => {
      if (!layers.includes(layer)) return;
      layer.historyId = nextHistoryId++;
      window.history.pushState(
        { ...window.history.state, hhLayer: layer.historyId },
        ""
      );
    });

    return () => {
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
      if (layers.length === 0) {
        window.removeEventListener("keydown", onKeyDown);
      }
      // Take this layer's entry back out of the history — but only when the
      // browser is still standing on it. If Back is what closed the layer,
      // that entry is already behind us and popping again would walk off the
      // tab the user came from.
      if (layer.historyId !== null && currentLayerId() === layer.historyId) {
        pendingSelfPop = layer.historyId;
        window.history.back();
      }
      // Hand the keyboard back to whatever opened this layer. React has
      // already detached the layer by now, so asking where focus currently
      // sits answers nothing — the opener captured at push time is the only
      // thing left to go on. It is skipped when it has left the document, and
      // when a layer is still open that does not contain it: focus belongs
      // inside the top layer, so a lightbox closing over its sheet returns to
      // the thumbnail inside that sheet, but never to the page behind it.
      const below = layers[layers.length - 1];
      const reachable = below
        ? Boolean(below.container && below.container.contains(opener))
        : true;
      if (opener && reachable) focusWhenRendered(opener);
    };
    // `container` is a ref object, stable for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
