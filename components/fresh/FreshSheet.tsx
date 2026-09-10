"use client";

import { useEffect, type ReactNode } from "react";
import { IconX } from "@/components/fresh/icons";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Sticky row pinned to the bottom of the sheet. */
  actions?: ReactNode;
};

/**
 * The one sheet chrome the fresh shell uses: a bottom sheet on phones with a
 * drag handle and a rounded top, a centred dialog from 520px up.
 *
 * Dismissal goes through the backdrop element itself, which swallows the
 * click. A window-level click-away listener would let the same click also
 * activate whatever sits underneath the sheet.
 */
export default function FreshSheet({
  title,
  onClose,
  children,
  actions,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fresh-sheet-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="fresh-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="fresh-sheet-grip" aria-hidden="true" />
        <div className="fresh-sheet-head">
          <h2 className="fresh-sheet-title">{title}</h2>
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
