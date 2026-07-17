"use client";

import { useEffect, useRef, useState } from "react";
import { lookupProductByBarcode, type ProductScan } from "@/lib/client";
import { getBarcodeReader } from "@/lib/scanBarcode";
import { recognizeLabel } from "@/lib/scanExpiry";
import { normalizeName } from "@/lib/normalize";

export type ScanResult = {
  name: string;
  category: string;
  quantityGrams: number;
  // YYYY-MM-DD or empty.
  expiry: string;
};

type Props = {
  // Whether the destination form actually uses the expiry field (only the
  // inventory form does; grocery items don't expire). Lets us hide the
  // "Capture for expiry" step on grocery.
  withExpiry: boolean;
  onConfirm: (result: ScanResult) => void;
  onClose: () => void;
};

type Stage =
  | { kind: "initializing" }
  | { kind: "scanning" }
  | { kind: "product"; product: ProductScan | null; barcode: string }
  | { kind: "ocr-running"; product: ProductScan | null }
  | {
      kind: "review";
      product: ProductScan | null;
      ocr: {
        expiry: string;
        weightGrams: number;
        name: string;
        rawText: string;
      };
    }
  | { kind: "error"; message: string };

export default function ScanLabelModal({
  withExpiry,
  onConfirm,
  onClose,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopBarcodeRef = useRef<(() => void) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "initializing" });

  // Mount: open the camera and start polling for barcodes.
  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices) {
        setStage({
          kind: "error",
          message: "This browser doesn't support camera access.",
        });
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            // 720p is a sweet spot: enough detail for barcodes / label text
            // without slowing down per-frame detection.
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        // Best-effort: ask the camera to keep refocusing continuously. Most
        // phone browsers honor this; the rest silently ignore. Without it,
        // close-up labels can stay blurry for the first second or two and
        // BarcodeDetector can't read what it can't see.
        try {
          const track = stream.getVideoTracks()[0];
          if (track && "applyConstraints" in track) {
            await track
              .applyConstraints({
                advanced: [
                  { focusMode: "continuous" } as MediaTrackConstraintSet,
                ],
              })
              .catch(() => {});
          }
        } catch {
          /* unsupported — fine */
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});

        setStage({ kind: "scanning" });

        const reader = getBarcodeReader();
        const stop = await reader.start(video, (hit) => {
          if (cancelled) return;
          // Freeze the preview at the moment of detection by pausing —
          // gives the user a beat to see the match.
          video.pause();
          stop();
          stopBarcodeRef.current = null;
          handleBarcode(hit.value);
        });
        stopBarcodeRef.current = stop;
      } catch (err) {
        setStage({
          kind: "error",
          message:
            err instanceof DOMException && err.name === "NotAllowedError"
              ? "Camera permission was denied. Allow it in your browser settings or type the item manually."
              : "Couldn't open the camera: " +
                (err instanceof Error ? err.message : String(err)),
        });
      }
    }

    start();

    return () => {
      cancelled = true;
      stopBarcodeRef.current?.();
      stopBarcodeRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleBarcode(barcode: string) {
    try {
      const product = await lookupProductByBarcode(barcode);
      setStage({ kind: "product", product, barcode });
    } catch {
      setStage({ kind: "product", product: null, barcode });
    }
  }

  /**
   * Grab the current video frame into a canvas, OCR it, and stash the
   * extracted fields. Used both after a barcode hit (for expiry / weight)
   * and from the manual "Capture label" button before any barcode match —
   * useful for Costco-style private-label items that aren't in OFF.
   */
  async function captureForOcr() {
    const video = videoRef.current;
    if (!video) return;
    // Stop the barcode polling if it's still running (manual capture path).
    stopBarcodeRef.current?.();
    stopBarcodeRef.current = null;

    const product = stage.kind === "product" ? stage.product : null;
    setStage({ kind: "ocr-running", product });

    try {
      // Resume the stream momentarily so the latest frame is fresh. We
      // already paused it on barcode detection.
      await video.play().catch(() => {});
      // Tiny settle to give autofocus a beat.
      await new Promise((r) => setTimeout(r, 250));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Couldn't allocate canvas context");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      video.pause();

      const ocr = await recognizeLabel(canvas);
      setStage({ kind: "review", product, ocr });
    } catch (err) {
      setStage({
        kind: "error",
        message:
          "Couldn't read the label: " +
          (err instanceof Error ? err.message : String(err)),
      });
    }
  }

  /**
   * Skips OCR entirely. Used either when the user doesn't care about
   * expiry (grocery flow), or when the product lookup gave us everything.
   */
  function skipOcr() {
    const product = stage.kind === "product" ? stage.product : null;
    setStage({
      kind: "review",
      product,
      ocr: { expiry: "", weightGrams: 0, name: "", rawText: "" },
    });
  }

  function confirm(fields: ScanResult) {
    onConfirm(fields);
    onClose();
  }

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal scan-modal">
        <div className="scan-camera-wrap">
          <video
            ref={videoRef}
            className="scan-camera"
            playsInline
            muted
            autoPlay
          />
          {stage.kind === "scanning" ? (
            <div className="scan-overlay">
              <div className="scan-reticle" />
              <div className="scan-status">Looking for a barcode…</div>
            </div>
          ) : null}
          {stage.kind === "ocr-running" ? (
            <div className="scan-overlay">
              <div className="scan-status">
                <span className="spinner" /> Reading the label…
              </div>
            </div>
          ) : null}
        </div>

        {stage.kind === "scanning" ? (
          <div className="scan-section">
            <p className="scan-hint" style={{ marginBottom: 4 }}>
              No barcode? Frame the product name (biggest text on the
              label) and tap below. We&apos;ll read it plus weight + expiry
              if visible.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={captureForOcr}
            >
              📸 Capture label (skip barcode)
            </button>
          </div>
        ) : null}

        {stage.kind === "error" ? (
          <div className="scan-section">
            <p className="scan-error">{stage.message}</p>
          </div>
        ) : null}

        {stage.kind === "product" ? (
          <ProductPanel
            product={stage.product}
            barcode={stage.barcode}
            withExpiry={withExpiry}
            onCapture={captureForOcr}
            onSkip={skipOcr}
          />
        ) : null}

        {stage.kind === "review" ? (
          <ReviewPanel
            product={stage.product}
            ocr={stage.ocr}
            withExpiry={withExpiry}
            onConfirm={confirm}
          />
        ) : null}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Sub-panels ---------- */

function ProductPanel({
  product,
  barcode,
  withExpiry,
  onCapture,
  onSkip,
}: {
  product: ProductScan | null;
  barcode: string;
  withExpiry: boolean;
  onCapture: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="scan-section">
      {product ? (
        <>
          <div className="scan-product-name">
            {product.brand ? `${product.brand} — ` : ""}
            {product.name || "Unnamed product"}
          </div>
          <div className="scan-product-meta">
            {product.quantityGrams > 0 ? (
              <span>{product.quantityGrams} g</span>
            ) : null}
            {product.category ? <span>{product.category}</span> : null}
            <span className="scan-barcode">#{barcode}</span>
          </div>
        </>
      ) : (
        <>
          <div className="scan-product-name">Barcode read</div>
          <div className="scan-product-meta">
            <span className="scan-barcode">#{barcode}</span>
            <span>Not in the database — fill in manually.</span>
          </div>
        </>
      )}

      <div className="scan-actions">
        {withExpiry ? (
          <button type="button" className="btn-accent" onClick={onCapture}>
            Capture for expiry date
          </button>
        ) : null}
        <button type="button" className="btn-secondary" onClick={onSkip}>
          {withExpiry ? "Skip" : "Use these"}
        </button>
      </div>
    </div>
  );
}

function ReviewPanel({
  product,
  ocr,
  withExpiry,
  onConfirm,
}: {
  product: ProductScan | null;
  ocr: { expiry: string; weightGrams: number; name: string; rawText: string };
  withExpiry: boolean;
  onConfirm: (result: ScanResult) => void;
}) {
  // Prefer product-lookup data; fall back to whatever OCR pulled off the
  // label (this is the manual-capture path for items not in the database).
  const lookupName = product
    ? [product.brand, product.name].filter(Boolean).join(" ").trim()
    : "";
  const initialName = lookupName || ocr.name || "";
  const [name, setName] = useState(initialName);
  const [quantity, setQuantity] = useState<string>(
    String(product?.quantityGrams || ocr.weightGrams || 0)
  );
  const [expiry, setExpiry] = useState(ocr.expiry);
  const [category, setCategory] = useState(product?.category || "");

  const ocrFoundSomething =
    Boolean(ocr.name) || Boolean(ocr.weightGrams) || Boolean(ocr.expiry);
  const ocrFoundNothing = Boolean(ocr.rawText) && !ocrFoundSomething;

  return (
    <div className="scan-section">
      <div className="field">
        <label htmlFor="scan-name">Name</label>
        <input
          id="scan-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What is it?"
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="scan-qty">Quantity (g)</label>
          <input
            id="scan-qty"
            type="number"
            inputMode="numeric"
            min={0}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        {withExpiry ? (
          <div className="field">
            <label htmlFor="scan-exp">Expiry</label>
            <input
              id="scan-exp"
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </div>
        ) : null}
      </div>
      {ocrFoundNothing ? (
        <p className="scan-hint">
          Couldn&apos;t read much off the label — fill these in manually.
        </p>
      ) : ocr.rawText && !ocr.expiry && withExpiry && !lookupName ? (
        <p className="scan-hint">
          Date wasn&apos;t legible — set the expiry manually if needed.
        </p>
      ) : null}
      <button
        type="button"
        className="btn-primary"
        onClick={() =>
          onConfirm({
            name: name.trim(),
            // The lookup category belongs to the original product name. If
            // the user corrected OCR/name text here, let the destination form
            // classify that edited name instead of attaching stale evidence.
            category:
              normalizeName(name) === normalizeName(initialName)
                ? category
                : "",
            quantityGrams: Math.max(0, Math.round(Number(quantity) || 0)),
            expiry: withExpiry ? expiry : "",
          })
        }
        disabled={!name.trim()}
      >
        Use these
      </button>
    </div>
  );
}
