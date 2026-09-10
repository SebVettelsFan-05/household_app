"use client";

import { useEffect, useState } from "react";
import { parseCents } from "@/lib/money";

/**
 * A free-form money field. The draft is what the user typed, so "12." keeps
 * its dot while they are mid-number; it only becomes cents on blur or Enter,
 * and an unparseable draft snaps back to the stored value.
 */
export default function AmountInput({
  cents,
  onCommit,
  placeholder = "0.00",
  ariaLabel,
  disabled = false,
  className = "monthly-input-amount",
}: {
  cents: number | undefined;
  onCommit: (cents: number | null) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Which look the field wears; the behaviour is the same either way. */
  className?: string;
}) {
  const formatted = cents !== undefined ? (cents / 100).toFixed(2) : "";
  const [draft, setDraft] = useState<string>(formatted);

  useEffect(() => {
    setDraft(formatted);
  }, [formatted]);

  function commit() {
    if (disabled) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      onCommit(null);
      setDraft("");
      return;
    }
    const c = parseCents(trimmed);
    if (c === null) {
      setDraft(formatted);
      return;
    }
    onCommit(c);
    setDraft((c / 100).toFixed(2));
  }

  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
