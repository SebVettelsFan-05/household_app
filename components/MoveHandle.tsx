"use client";

import type { ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { MoveTarget } from "@/lib/useRecipeMoves";

type Props = {
  /** The recipe row this handle picks up. */
  id: string;
  /** Where that row sits now, so a keyboard move knows where it started. */
  slot: MoveTarget;
  label: string;
  className: string;
  /** A tap (no drag) picks the card up and waits for a day to be tapped. */
  onPick: () => void;
  disabled?: boolean;
  children: ReactNode;
};

/**
 * The grab handle on a day card: drag it, or tap it and then tap a day.
 *
 * Only the handle is draggable, never the whole card, so tapping a card to
 * edit it and scrolling the list with a finger both still work.
 */
export default function MoveHandle({
  id,
  slot,
  label,
  className,
  onPick,
  disabled,
  children,
}: Props) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id,
    data: slot,
    disabled,
  });

  return (
    <button
      type="button"
      ref={setNodeRef}
      className={className}
      disabled={disabled}
      {...attributes}
      {...listeners}
      aria-label={label}
      title={label}
      onClick={onPick}
      onKeyDown={(e) => {
        const keyDown = listeners?.onKeyDown as
          | ((event: React.KeyboardEvent) => void)
          | undefined;
        keyDown?.(e);
        // Space and Enter belong to the keyboard sensor now; without this the
        // button would also fire its click and pick the card up twice.
        if (e.key === " " || e.key === "Enter") e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
