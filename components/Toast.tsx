"use client";

import { useEffect, useState } from "react";

export type ToastMessage = { id: number; text: string };

type Props = { message: ToastMessage | null };

export default function Toast({ message }: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!message) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 2400);
    return () => clearTimeout(t);
  }, [message]);

  return (
    <div className={`toast${show ? " show" : ""}`}>{message?.text ?? ""}</div>
  );
}
