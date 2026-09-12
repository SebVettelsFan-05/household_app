"use client";

import { useRef, type ReactNode } from "react";
import { IconX } from "@/components/fresh/icons";
import { useEscapeLayer } from "@/lib/escapeStack";

export type SheetSize = "default" | "wide";

type Props = {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Sticky row pinned to the bottom of the sheet. */
  actions?: ReactNode;
  /** "wide" widens the desktop dialog for list-heavy content. */
  size?: SheetSize;
};

/**
 * The one sheet chrome the fresh shell uses: a bottom sheet on phones with a
 * drag handle and a rounded top, a centred dialog from 520px up.
 *
 * Dismissal goes through the backdrop element itself, which swallows the
 * click. A window-level click-away listener would let the same click also
 * activate whatever sits underneath the sheet.
 *
 * Escape and the focus trap go through the shared layer stack, so a lightbox
 * opened from inside a sheet closes alone and leaves the form standing.
 */
export default function FreshSheet({
  title,
  subtitle,
  onClose,
  children,
  actions,
  size = "default",
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useEscapeLayer(onClose, true, sheetRef);

  // The FAB sits in the same corner as a sheet's sticky action row, so
  // fresh.css hides it while a sheet is open (`.fresh:has(.fresh-sheet-bg)`).
  return (
    <div
      className="fresh-sheet-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        tabIndex={-1}
        className={`fresh-sheet${size === "wide" ? " fresh-sheet-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="fresh-sheet-grip" aria-hidden="true" />
        <div className="fresh-sheet-head">
          <div className="fresh-sheet-heading">
            <h2 className="fresh-sheet-title">{title}</h2>
            {subtitle ? (
              <span className="fresh-sheet-sub">{subtitle}</span>
            ) : null}
          </div>
          <button
            type="button"
            className="fresh-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <IconX size={20} />
          </button>
        </div>
        <div className="fresh-sheet-body">{children}</div>
        {actions ? <div className="fresh-sheet-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
