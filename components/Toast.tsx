"use client";

import { useEffect, useState } from "react";

export type ToastMessage = { id: number; text: string };

/** A button carried inside a toast, e.g. the Undo offered after a move. */
export type ToastAction = { label: string; onClick: () => void };

/** How long a toast carrying an action stays up: long enough to reach it. */
export const TOAST_ACTION_MS = 6000;
const TOAST_MS = 2400;

type Props = {
  message: ToastMessage | null;
  /**
   * An optional button inside the toast ("Undo"). Without it the toast is
   * exactly what it always was: one line of text, no pointer events.
   */
  action?: ToastAction;
};

export default function Toast({ message, action }: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!message) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), action ? TOAST_ACTION_MS : TOAST_MS);
    return () => clearTimeout(t);
    // Only a new message restarts the timer; `action` is a fresh object on
    // every render and would keep the toast up forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!action) {
    return (
      <div className={`toast${show ? " show" : ""}`}>{message?.text ?? ""}</div>
    );
  }

  return (
    <div className={`toast toast-action${show ? " show" : ""}`}>
      <span>{message?.text ?? ""}</span>
      <button type="button" className="toast-action-btn" onClick={action.onClick}>
        {action.label}
      </button>
    </div>
  );
}
