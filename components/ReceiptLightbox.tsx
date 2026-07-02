"use client";

import { useEffect } from "react";

type Props = {
  src: string;
  alt?: string;
  originalHref?: string;
  originalLabel?: string;
  onClose: () => void;
};

/**
 * Full-screen overlay for inspecting a receipt before submit or while editing.
 * Click outside the image (or hit Escape) to dismiss.
 */
export default function ReceiptLightbox({
  src,
  alt = "Receipt",
  originalHref,
  originalLabel = "Open original",
  onClose,
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
        x
      </button>
      <div
        className="receipt-lightbox-content"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} />
        {originalHref ? (
          <a
            href={originalHref}
            target="_blank"
            rel="noopener noreferrer"
            className="receipt-lightbox-link"
          >
            {originalLabel}
          </a>
        ) : null}
      </div>
    </div>
  );
}
