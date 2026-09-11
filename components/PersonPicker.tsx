"use client";

import { IconCheck } from "@/components/fresh/icons";
import { Avatar, personColor } from "@/components/fresh/people";
import { useUiMode } from "@/components/UiModeProvider";
import { BUYERS } from "@/lib/types";

/**
 * The "which housemate" control, in both looks. Classic keeps the plain
 * `<select>` it has always had, right down to the field wrapper and the
 * option list. Fresh draws one chip per person with their disc, which is how
 * a name is written everywhere else in that shell.
 *
 * Both render the same `.field` wrapper so a picker dropped into a two-up
 * `.field-row` lays out identically either way.
 */

type Props = {
  /** Id of the classic `<select>`; also seeds the fresh group's label id. */
  id: string;
  label: string;
  value: string;
  onChange: (name: string) => void;
  /** What an unset value reads as ("Pick a name…", "Shared"). */
  emptyLabel: string;
  /** True when the empty value is a real answer rather than a prompt. */
  emptyIsChoice?: boolean;
  people?: readonly string[];
  disabled?: boolean;
};

export default function PersonPicker({
  id,
  label,
  value,
  onChange,
  emptyLabel,
  emptyIsChoice = false,
  people = BUYERS,
  disabled,
}: Props) {
  const mode = useUiMode();

  if (mode === "classic") {
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          className="select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="" disabled={!emptyIsChoice}>
            {emptyLabel}
          </option>
          {people.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="field">
      <label id={`${id}-label`}>{label}</label>
      <div className="fresh-chips" role="group" aria-labelledby={`${id}-label`}>
        {emptyIsChoice ? (
          <button
            type="button"
            className={`fresh-chip${value === "" ? " active" : ""}`}
            aria-pressed={value === ""}
            onClick={() => onChange("")}
            disabled={disabled}
          >
            {emptyLabel}
          </button>
        ) : null}
        {people.map((b) => (
          <PersonChip
            key={b}
            name={b}
            active={value === b}
            disabled={disabled}
            onClick={() => onChange(b)}
          />
        ))}
      </div>
    </div>
  );
}

/** One disc-plus-name chip, filled in the person's own colour when picked. */
export function PersonChip({
  name,
  active,
  disabled,
  onClick,
}: {
  name: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`fresh-chip fresh-chip-person${active ? " active" : ""}`}
      style={
        active
          ? { background: personColor(name), borderColor: personColor(name) }
          : undefined
      }
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      <Avatar name={name} size={22} />
      {name}
    </button>
  );
}

/**
 * A multi-select roster (who shares dinners, who a custom split covers).
 * Classic keeps its checkbox labels; fresh uses the same person chips with a
 * check mark on the ones that are in.
 */
export function PersonCheckList({
  people,
  selected,
  onToggle,
  disabled,
  className,
  itemClassName,
  ariaLabel,
}: {
  people: readonly string[];
  selected: readonly string[];
  onToggle: (name: string) => void;
  disabled?: boolean;
  /** Classic wrapper class (`settings-people`, `alloc-members`). */
  className: string;
  /** Classic per-person label class (`settings-person`, `alloc-member`). */
  itemClassName: string;
  ariaLabel: string;
}) {
  const mode = useUiMode();

  if (mode === "classic") {
    return (
      <div className={className}>
        {people.map((p) => (
          <label className={itemClassName} key={p}>
            <input
              type="checkbox"
              checked={selected.includes(p)}
              onChange={() => onToggle(p)}
              disabled={disabled}
            />
            <span>{p}</span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="fresh-chips" role="group" aria-label={ariaLabel}>
      {people.map((p) => {
        const on = selected.includes(p);
        return (
          <button
            key={p}
            type="button"
            className={`fresh-chip fresh-chip-person${on ? " active" : ""}`}
            style={
              on
                ? { background: personColor(p), borderColor: personColor(p) }
                : undefined
            }
            aria-pressed={on}
            onClick={() => onToggle(p)}
            disabled={disabled}
          >
            <Avatar name={p} size={22} />
            {p}
            {on ? <IconCheck size={16} /> : null}
          </button>
        );
      })}
    </div>
  );
}
