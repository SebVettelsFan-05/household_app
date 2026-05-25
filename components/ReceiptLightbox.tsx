"use client";

import { useEffect } from "react";

type Props = {
  src: string;
  alt?: string;
  onClose: () => void;
};

/**
 * Full-screen overlay for inspecting a receipt before submit or while editing.
 * Click anywhere (or hit Escape) to dismiss.
 */
export default function ReceiptLightbox({ src, alt = "Receipt", onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="receipt-lightbox"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="receipt-lightbox-close"
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
