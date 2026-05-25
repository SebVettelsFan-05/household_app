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

/** Reader that uses the browser-native BarcodeDetector. Polls every 250ms. */
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

      async function tick() {
        if (stopped) return;
        if (video.readyState >= 2) {
          try {
            const hits = await detector.detect(video);
            if (hits.length > 0) {
              onResult({ value: hits[0].rawValue, format: hits[0].format });
              return; // caller decides whether to stop; we keep polling otherwise
            }
          } catch {
            // Per-frame failures (e.g. decode noise) are fine to swallow —
            // we'll just try the next frame.
          }
        }
        timer = setTimeout(tick, 250);
      }
      tick();

      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    },
  };
}

/**
 * Lazy-loaded ZXing reader. Only imported when the native detector isn't
 * available. Keeps the bundle lean on Chrome/Android where most users land.
 */
function zxingReader(): BarcodeReader {
  return {
    async start(video, onResult) {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();

      // Use the existing video element + its already-attached stream rather
      // than letting ZXing acquire its own. The modal owns the lifecycle.
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
