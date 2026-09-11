"use client";

import { useEffect, useState } from "react";
import { msUntilNextLocalMidnight } from "@/lib/dates";

/**
 * "Now", re-read at every household-timezone midnight and whenever the tab
 * regains visibility. Anything that derives "this week" or "tonight" from
 * the clock must use this rather than `new Date()` at render, or it goes
 * stale on a phone that was left open across Friday 00:00 and then writes
 * into a week that has already rolled into the archive.
 */
export function useHouseholdToday(): Date {
  const [today, setToday] = useState<Date>(() => new Date());

  useEffect(() => {
    const delay = msUntilNextLocalMidnight(today);
    const t = window.setTimeout(() => setToday(new Date()), delay);
    return () => window.clearTimeout(t);
  }, [today]);

  // Mobile and laptops aggressively suspend background tabs - the midnight
  // setTimeout above silently fails to fire across a sleep. Re-read the
  // clock whenever the tab regains visibility so a user opening the app
  // Sunday morning sees the rolled-over week even if their phone had been
  // asleep through the actual boundary.
  useEffect(() => {
    function refreshIfVisible() {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        setToday(new Date());
      }
    }
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
  }, []);

  return today;
}
