"use client";

import FreshSheet, { type SheetSize } from "@/components/fresh/FreshSheet";
import { useUiMode } from "@/components/UiModeProvider";
import type { ReactNode } from "react";

type Props = {
  /** Sheet title in fresh, and the classic <h2> unless `classicTitle` is set. */
  title: string;
  /**
   * Classic heading content when it isn't plain text (an emoji glyph in
   * front of the words). `null` renders no heading at all.
   */
  classicTitle?: ReactNode | null;
  subtitle?: ReactNode;
  /** "wide" is `modal-wide` in classic and a wider dialog in fresh. */
  size?: SheetSize;
  /** Extra class on the classic `.modal` box (`archive-modal`, `scan-modal`). */
  classicClass?: string;
  /** Buttons for the classic `.modal-actions` row / the fresh sticky row. */
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
};

/**
 * The chrome every modal in the app wears. In classic it is exactly the
 * markup each modal used to write by hand — the `.modal-bg` catch layer that
 * swallows the dismissing click, the `.modal` box, an `<h2>` (or the
 * `.modal-header` pair when there is a subtitle) and the `.modal-actions`
 * row. In fresh it is the bottom sheet / centred dialog.
 *
 * Keeping both shapes here is what lets the fresh shell restyle every menu
 * in the app while the classic look reverses to precisely what it was.
 */
export default function ModalFrame({
  title,
  classicTitle,
  subtitle,
  size = "default",
  classicClass,
  actions,
  onClose,
  children,
}: Props) {
  const mode = useUiMode();

  if (mode === "fresh") {
    return (
      <FreshSheet
        title={title}
        subtitle={subtitle}
        size={size}
        onClose={onClose}
        actions={actions}
      >
        {children}
      </FreshSheet>
    );
  }

  const heading = classicTitle === undefined ? title : classicTitle;
  const boxClass = ["modal", size === "wide" ? "modal-wide" : "", classicClass]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={boxClass}>
        {subtitle ? (
          <div className="modal-header">
            <h2>{heading}</h2>
            <span className="modal-sub">{subtitle}</span>
          </div>
        ) : heading === null ? null : (
          <h2>{heading}</h2>
        )}
        {children}
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
