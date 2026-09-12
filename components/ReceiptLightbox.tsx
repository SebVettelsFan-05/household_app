"use client";

import { useRef } from "react";
import ReceiptImage from "@/components/ReceiptImage";
import { useEscapeLayer } from "@/lib/escapeStack";

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
 *
 * The lightbox is usually opened from inside a form, so Escape goes through
 * the shared layer stack: it closes the lightbox and nothing else.
 */
export default function ReceiptLightbox({
  src,
  alt = "Receipt",
  originalHref,
  originalLabel = "Open original",
  onClose,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEscapeLayer(onClose, true, boxRef);

  return (
    <div
      className="receipt-lightbox"
      ref={boxRef}
      tabIndex={-1}
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
