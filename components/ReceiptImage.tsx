"use client";

import { useState, type ImgHTMLAttributes, type ReactNode } from "react";

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  /** Shown in the image's place once the browser gives up on loading it. */
  fallback: ReactNode;
};

/**
 * A receipt image that degrades to words instead of a broken-image icon.
 *
 * Receipts are served from a Drive thumbnail URL, and plenty of them never
 * render: a stub backend in local dev, a revoked share, a PDF with no
 * preview. Until the image fails this renders exactly the `<img>` the caller
 * asked for, so the markup is unchanged in the normal case.
 */
export default function ReceiptImage({ fallback, ...img }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed || !img.src) return <>{fallback}</>;

  // eslint-disable-next-line @next/next/no-img-element
  return <img {...img} alt={img.alt ?? ""} onError={() => setFailed(true)} />;
}
