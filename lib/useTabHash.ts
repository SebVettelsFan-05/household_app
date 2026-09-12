"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps the shell's active tab in the URL hash (`#recipes`).
 *
 * Two things come out of that. Back moves between tabs instead of walking
 * straight out of the app, which installed as a PWA means the app closing
 * under you the first time you reach for Back. And a reload comes back to the
 * tab you were on rather than to Home.
 *
 * The shell reads the hash itself for its first tab — it only ever renders in
 * the browser — and this hook owns it from there: a tab the user picks pushes
 * an entry, and Back sets the tab from whatever entry it lands on.
 */
export function useTabHash<T extends string>(
  tab: T,
  setTab: (t: T) => void,
  fromHash: (hash: string) => T
): void {
  const setRef = useRef(setTab);
  setRef.current = setTab;
  const fromRef = useRef(fromHash);
  fromRef.current = fromHash;
  const mounted = useRef(false);

  useEffect(() => {
    function onPop() {
      setRef.current(fromRef.current(window.location.hash));
    }
    // Back pressed in the beat between the shell painting and this listener
    // existing still moved the hash, and its popstate is gone. Reading the
    // hash once here is what keeps the tab from being left behind by it.
    onPop();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    // The first run has nothing to push: the shell took its opening tab from
    // the hash, and a Back that beat the listener above is being read out of
    // the hash right now — pushing here would write that tab back.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    // Nothing to push when the hash already names this tab either: Back just
    // put the user here.
    if (fromRef.current(window.location.hash) === tab) return;
    // `hhLayer: null` because this entry belongs to a tab, not to an overlay:
    // inheriting an open layer's id would give two entries the same one.
    window.history.pushState(
      { ...window.history.state, hhLayer: null },
      "",
      `#${tab}`
    );
  }, [tab]);
}
