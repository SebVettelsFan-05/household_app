"use client";

import { useEffect, useState } from "react";
import { PersonCheckList } from "@/components/PersonPicker";
import { fmtMoney, parseCents } from "@/lib/money";
import type { AllocationKind, ExpenseAllocation } from "@/lib/types";

/**
 * Receipt splitter shared by the add form and the edit modal.
 *
 * A receipt is one or more allocation lines (see docs/SHARED_KITCHEN.md).
 * The common case is a single line for the whole total, so a lone line
 * follows the receipt amount automatically until the user splits it.
 *
 * `splitAmong` is only sent to the server for lines whose snapshot must be
 * preserved — see `allocationsForSubmit`.
 */

export type EditableAllocation = {
  // "" until the user picks one. Same "no silent default" rule as Paid by.
  kind: AllocationKind | "";
  // null while the amount field is empty or mid-typing ("12.").
  amountCents: number | null;
  splitAmong: string[];
  // A lone line mirrors the receipt total until the user types an amount or
  // splits the receipt.
  tracksTotal: boolean;
  // Set once the user re-picks the kind of a line seeded from a saved
  // expense: its stored snapshot no longer describes what the line means.
  kindChanged: boolean;
};

const KIND_CHIPS: { kind: AllocationKind; label: string }[] = [
  { kind: "house", label: "Everyone" },
  { kind: "meals", label: "Meals" },
  { kind: "personal", label: "Personal" },
  { kind: "custom", label: "Custom" },
];

/** A blank line for a brand new receipt. */
export function blankAllocation(): EditableAllocation {
  return {
    kind: "",
    amountCents: null,
    splitAmong: [],
    tracksTotal: true,
    kindChanged: true,
  };
}

/** Seeds the editor from a saved expense, keeping each line's snapshot. */
export function seedAllocations(
  allocations: readonly ExpenseAllocation[]
): EditableAllocation[] {
  if (allocations.length === 0) return [blankAllocation()];
  return allocations.map((a) => ({
    kind: a.kind,
    amountCents: a.amountCents,
    splitAmong: [...a.splitAmong],
    // A single line rescales with the receipt total; multiple lines keep
    // their amounts and the remainder tells the user what is left over.
    tracksTotal: allocations.length === 1,
    kindChanged: false,
  }));
}

/** Cents still unaccounted for. Negative means the lines overshoot. */
export function allocationsRemainder(
  lines: readonly EditableAllocation[],
  totalCents: number
): number {
  return (
    totalCents - lines.reduce((s, l) => s + (l.amountCents ?? 0), 0)
  );
}

/**
 * Shape for the API. `splitAmong` is omitted on house/meals lines so the
 * server snapshots the current roster / meal group. On an edit the stored
 * snapshot is sent back instead, unless the user re-picked that line's kind.
 */
export function allocationsForSubmit(
  lines: readonly EditableAllocation[],
  opts: { keepSnapshots: boolean }
): Array<{
  kind: AllocationKind;
  amountCents: number;
  splitAmong?: string[];
}> {
  return lines.map((l) => {
    const kind = l.kind as AllocationKind;
    const amountCents = l.amountCents ?? 0;
    if (kind === "personal") return { kind, amountCents, splitAmong: [] };
    if (kind === "custom") {
      return { kind, amountCents, splitAmong: [...l.splitAmong] };
    }
    if (opts.keepSnapshots && !l.kindChanged && l.splitAmong.length > 0) {
      return { kind, amountCents, splitAmong: [...l.splitAmong] };
    }
    return { kind, amountCents };
  });
}

/**
 * The people a line's checklist offers: the household roster, plus any name
 * already on the line that the roster no longer has. A receipt settled with
 * a housemate who has since moved out keeps naming them, and the server
 * keeps such a snapshot on edit, so the editor has to show them too.
 */
export function splitPeople(
  splitAmong: readonly string[],
  members: readonly string[]
): string[] {
  return [...members, ...splitAmong.filter((n) => !members.includes(n))];
}

/**
 * The line's new `splitAmong` after tapping `name`. A departed name stays on
 * the line while other people are toggled — it can only come off by being
 * tapped itself, never as a side effect of editing somebody else.
 */
export function toggleSplitMember(
  splitAmong: readonly string[],
  name: string,
  members: readonly string[]
): string[] {
  if (splitAmong.includes(name)) return splitAmong.filter((m) => m !== name);
  return splitPeople(splitAmong, members).filter(
    (m) => m === name || splitAmong.includes(m)
  );
}

type Props = {
  totalCents: number;
  value: EditableAllocation[];
  onChange: (next: EditableAllocation[]) => void;
  members: readonly string[];
  mealGroup: readonly string[];
  disabled?: boolean;
};

function centsToText(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2);
}

function AmountField({
  cents,
  onCommit,
  disabled,
  ariaLabel,
}: {
  cents: number | null;
  onCommit: (cents: number | null) => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  const [text, setText] = useState(() => centsToText(cents));
  const [focused, setFocused] = useState(false);

  // While the field has focus the user's keystrokes own it ("12." parses to
  // null and must not wipe what they typed). Otherwise mirror the value.
  useEffect(() => {
    if (!focused) setText(centsToText(cents));
  }, [cents, focused]);

  return (
    <div className="alloc-amount">
      <span className="alloc-amount-sign">$</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(centsToText(cents));
        }}
        onChange={(e) => {
          setText(e.target.value);
          onCommit(parseCents(e.target.value));
        }}
      />
    </div>
  );
}

export default function AllocationEditor({
  totalCents,
  value,
  onChange,
  members,
  mealGroup,
  disabled = false,
}: Props) {
  // Repeat entry is usually the same kind of trip, so the last kind picked
  // pre-selects the next receipt's single line.
  const [lastKind, setLastKind] = useState<AllocationKind | "">("");

  useEffect(() => {
    if (value.length !== 1) return;
    const line = value[0];
    const kind = line.kind === "" && lastKind !== "" ? lastKind : line.kind;
    // A blank receipt total leaves the field blank rather than showing $0.00.
    const amountCents = line.tracksTotal
      ? totalCents > 0
        ? totalCents
        : null
      : line.amountCents;
    if (kind === line.kind && amountCents === line.amountCents) return;
    onChange([{ ...line, kind, amountCents }]);
  }, [value, lastKind, totalCents, onChange]);

  function patch(index: number, next: Partial<EditableAllocation>) {
    onChange(value.map((l, i) => (i === index ? { ...l, ...next } : l)));
  }

  function pickKind(index: number, kind: AllocationKind) {
    setLastKind(kind);
    // Tapping the chip that is already active is a no-op. Anything else
    // would drop the stored participant snapshot and let the server
    // re-resolve it against today's meal group, rewriting settled history.
    if (value[index].kind === kind) return;
    patch(index, {
      kind,
      kindChanged: true,
      splitAmong: kind === "custom" ? value[index].splitAmong : [],
    });
  }

  function toggleMember(index: number, name: string) {
    patch(index, {
      splitAmong: toggleSplitMember(value[index].splitAmong, name, members),
    });
  }

  function addLine() {
    onChange([
      ...value.map((l) => ({ ...l, tracksTotal: false })),
      { ...blankAllocation(), tracksTotal: false },
    ]);
  }

  function removeLine(index: number) {
    if (value.length <= 1) return;
    onChange(value.filter((_, i) => i !== index));
  }

  const remainder = allocationsRemainder(value, totalCents);

  return (
    <div className="alloc-editor">
      {value.map((line, i) => (
        <div className="alloc-line" key={i}>
          <div className="alloc-line-head">
            <div className="alloc-chips">
              {KIND_CHIPS.map((chip) => (
                <button
                  key={chip.kind}
                  type="button"
                  className={`alloc-chip${line.kind === chip.kind ? " active" : ""}`}
                  onClick={() => pickKind(i, chip.kind)}
                  disabled={disabled}
                  aria-pressed={line.kind === chip.kind}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <div className="alloc-line-amount">
              <AmountField
                cents={line.amountCents}
                onCommit={(cents) =>
                  patch(i, { amountCents: cents, tracksTotal: false })
                }
                disabled={disabled}
                ariaLabel={`Amount for split line ${i + 1}`}
              />
              {value.length > 1 ? (
                <button
                  type="button"
                  className="alloc-remove"
                  onClick={() => removeLine(i)}
                  disabled={disabled}
                  aria-label={`Remove split line ${i + 1}`}
                  title="Remove this line"
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>

          {line.kind === "meals" ? (
            <p className="alloc-note">
              {(line.splitAmong.length > 0 ? line.splitAmong : mealGroup).join(", ")}
            </p>
          ) : null}

          {line.kind === "personal" ? (
            <p className="alloc-note">Kept off the split entirely.</p>
          ) : null}

          {line.kind === "custom" ? (
            <PersonCheckList
              people={splitPeople(line.splitAmong, members)}
              selected={line.splitAmong}
              onToggle={(m) => toggleMember(i, m)}
              disabled={disabled}
              className="alloc-members"
              itemClassName="alloc-member"
              ariaLabel={`Who split line ${i + 1} covers`}
            />
          ) : null}
        </div>
      ))}

      <div className="alloc-footer">
        <button
          type="button"
          className="alloc-split"
          onClick={addLine}
          disabled={disabled}
        >
          + Split receipt
        </button>
        <span
          className={`alloc-remainder${remainder !== 0 ? " warn" : ""}`}
          role="status"
        >
          Unallocated {fmtMoney(remainder)}
        </span>
      </div>
    </div>
  );
}
