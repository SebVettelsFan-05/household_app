"use client";

import { useEffect } from "react";
import ReceiptImage from "@/components/ReceiptImage";

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
        <ReceiptImage
          src={src}
          alt={alt}
          fallback={
            <p className="receipt-lightbox-missing">
              This receipt image could not be loaded.
            </p>
          }
        />
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
