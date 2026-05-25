/**
 * Barcode reader abstraction.
 *
 * Two implementations behind one interface:
 *
 *   1. `BarcodeDetector` (built into Chrome/Android, Safari 17+). Native,
 *      zero-cost, no library load.
 *   2. `@zxing/browser` fallback for older Safari and anywhere
 *      `BarcodeDetector` isn't available. ~150 KB gzipped, lazy-imported so
 *      browsers that have the native API never download it.
 *
 * Both expose `start(video, onResult)` → returns a `stop()` function. The
 * caller is responsible for getUserMedia and feeding the resulting stream
 * into the `<video>` element.
 */

export type BarcodeHit = {
  // The raw decoded text (UPC/EAN digits, usually).
  value: string;
  // The detected symbology (e.g. "ean_13", "upc_a", "code_128") when known.
  format: string;
};

export type BarcodeStopFn = () => void;

export type BarcodeReader = {
  start: (
    video: HTMLVideoElement,
    onResult: (hit: BarcodeHit) => void
  ) => Promise<BarcodeStopFn>;
};

// Whatever detector we end up using, restrict it to the formats actually
// found on packaged groceries. Reduces false positives (QR codes,
// shipping labels, etc.).
const GROCERY_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "itf",
] as const;

declare global {
  // Minimal type for the BarcodeDetector — TypeScript's lib.dom doesn't ship
  // one yet because the spec is still in WICG. Defined locally so we don't
  // need a separate @types dep.
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: readonly string[] }): BarcodeDetectorInstance;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
  interface BarcodeDetectorInstance {
    detect: (image: HTMLVideoElement) => Promise<
      Array<{ rawValue: string; format: string }>
    >;
  }
}

export function isNativeBarcodeSupported(): boolean {
  return typeof window !== "undefined" && typeof window.BarcodeDetector === "function";
}

// Minimal type for the browser's requestVideoFrameCallback API. Lets us
// drive detection synchronously with each new video frame instead of polling
// on a timer — way faster lock-on and zero wasted work between frames.
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Reader backed by the browser-native BarcodeDetector. Drives detection off
 * `requestVideoFrameCallback` when available (fires immediately when a new
 * frame is decoded, typically 30+ fps), falling back to a tight 100 ms
 * setTimeout on older Safari. Either path is dramatically faster than the
 * previous 250 ms poll — barcodes lock on in well under a second once focus
 * settles. Native BarcodeDetector handles rotated barcodes already, so no
 * orientation special-casing is needed here.
 */
function nativeReader(): BarcodeReader {
  return {
    async start(video, onResult) {
      if (typeof window === "undefined" || !window.BarcodeDetector) {
        throw new Error("BarcodeDetector is unavailable");
      }
      const detector = new window.BarcodeDetector({
        formats: GROCERY_FORMATS,
      });

      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let frameHandle: number | null = null;
      let detecting = false;

      const v = video as VideoWithFrameCallback;
      const useFrameCb = typeof v.requestVideoFrameCallback === "function";

      async function tick() {
        if (stopped) return;
        if (detecting || video.readyState < 2) {
          schedule();
          return;
        }
        detecting = true;
        try {
          const hits = await detector.detect(video);
          if (!stopped && hits.length > 0) {
            onResult({ value: hits[0].rawValue, format: hits[0].format });
            // Caller decides whether to stop; we keep polling otherwise.
          }
        } catch {
          // Per-frame failures (decode noise) — try next frame.
        } finally {
          detecting = false;
          schedule();
        }
      }

      function schedule() {
        if (stopped) return;
        if (useFrameCb) {
          frameHandle = v.requestVideoFrameCallback!(() => {
            void tick();
          });
        } else {
          timer = setTimeout(tick, 100);
        }
      }

      schedule();

      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        if (frameHandle !== null && v.cancelVideoFrameCallback) {
          try {
            v.cancelVideoFrameCallback(frameHandle);
          } catch {
            /* idempotent */
          }
        }
      };
    },
  };
}

/**
 * Lazy-loaded ZXing reader. Only imported when the native detector isn't
 * available — older Safari, Firefox, etc. We pass `TRY_HARDER` so it
 * attempts rotated barcode reads instead of giving up on vertical/diagonal
 * orientations.
 */
function zxingReader(): BarcodeReader {
  return {
    async start(video, onResult) {
      // Both pieces come from the same @zxing/browser package surface in v0.2.
      const browserMod = (await import("@zxing/browser")) as unknown as {
        BrowserMultiFormatReader: new (
          hints?: Map<number, unknown>
        ) => {
          decodeFromVideoElement: (
            video: HTMLVideoElement,
            cb: (
              result:
                | {
                    getText: () => string;
                    getBarcodeFormat: () => string | number;
                  }
                | undefined
                | null
            ) => void
          ) => Promise<{ stop: () => void }>;
        };
      };
      // DecodeHintType.TRY_HARDER === 3 in the upstream enum; we hard-code
      // it to avoid pulling in @zxing/library's types separately.
      const TRY_HARDER = 3;
      const hints = new Map<number, unknown>();
      hints.set(TRY_HARDER, true);

      const reader = new browserMod.BrowserMultiFormatReader(hints);
      const controls = await reader.decodeFromVideoElement(video, (result) => {
        if (!result) return;
        onResult({
          value: result.getText(),
          format: String(result.getBarcodeFormat()),
        });
      });
      return () => {
        try {
          controls.stop();
        } catch {
          /* idempotent stop */
        }
      };
    },
  };
}

/** Returns the best available reader for the current environment. */
export function getBarcodeReader(): BarcodeReader {
  if (isNativeBarcodeSupported()) return nativeReader();
  return zxingReader();
}
