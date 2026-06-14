"use client";

import { useState } from "react";

type Props = {
  onRefresh: () => Promise<void>;
  onError?: (msg: string) => void;
};

/**
 * Header refresh button — re-pulls everything from the backend on demand
 * for when another housemate's edits haven't landed yet. Spinner replaces
 * the glyph while busy; disabled during the in-flight refetch so spam
 * clicks don't fan out a stack of duplicate requests. Any thrown error
 * from onRefresh surfaces via onError — silent failure on a manual
 * refresh leaves the user wondering whether it worked.
 */
export default function RefreshButton({ onRefresh, onError }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      await onRefresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      onError?.(msg || "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="refresh-btn"
      onClick={handleClick}
      disabled={busy}
      aria-label="Refresh data"
      aria-busy={busy}
      title="Refresh data"
    >
      {busy ? <span className="refresh-btn-spin" aria-hidden="true" /> : "↻"}
      {/* Screen-reader announcement so non-sighted users know the action
          started. The polite live region replays on text change. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {busy ? "Refreshing data" : ""}
      </span>
    </button>
  );
}
