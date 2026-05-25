/**
 * Label OCR + lightweight extraction.
 *
 * Tesseract.js runs entirely in the browser (WASM worker, English language
 * model). We lazy-import it so the ~1.5 MB worker only downloads when the
 * user actually taps "Capture for expiry" — normal app use never pays the
 * cost.
 *
 * After OCR we run two extractors on the recognised text:
 *   - `extractExpiry`: looks for a date next to keywords like "best before"
 *     / "exp" / "use by", and falls back to standalone date patterns.
 *   - `extractWeight`: pulls "500 g", "1.89 L", etc. — used as a fallback
 *     when the product lookup didn't return a quantity.
 *
 * Returns suggestions, never final values: the modal shows them as
 * pre-filled candidates the user can confirm or override.
 */

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

const KEYWORD_RE =
  /\b(best[\s_-]?before|best[\s_-]?by|use[\s_-]?by|exp(?:iry|ires)?|expires?\s*on|bb|bbe|bb\/be|bbd|consume[\s_-]?by|sell[\s_-]?by)\b[:\s.]*([^\n]*)/gi;

// ISO YYYY-MM-DD or YYYY/MM/DD
const RE_ISO = /(20\d{2})[\s./-](\d{1,2})[\s./-](\d{1,2})/;
// Numeric DD/MM/YYYY or MM/DD/YYYY (we try to disambiguate by month range)
const RE_NUM = /(\d{1,2})[\s./-](\d{1,2})[\s./-](\d{2,4})/;
// "12 JUL 2026" or "Jul 12 2026" or "12-Jul-26"
const RE_TEXT_MONTH =
  /(?:(\d{1,2})[\s./-]+)?([A-Za-z]{3,9})[\s./-]+(?:(\d{1,2})[\s./-]+)?(\d{2,4})/;

export type ExtractedFields = {
  // YYYY-MM-DD or empty.
  expiry: string;
  // Grams. 0 when nothing convincing was found.
  weightGrams: number;
  // Best-guess product name from the largest legible line on the label.
  // "" when no convincing line was found.
  name: string;
  // Raw text Tesseract returned, useful for debugging when extraction fails.
  rawText: string;
};

// Tesseract.js's data shape varies slightly across versions; defensive casts
// let us read lines/bboxes without pulling in the library's type surface.
type OcrLine = {
  text?: string;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
};

/**
 * Lazily imports tesseract.js, OCRs the supplied image, and runs the
 * extractors. Returns immediately with empty fields when nothing parseable
 * is found — the UI shows whatever did match and leaves the rest editable.
 */
export async function recognizeLabel(
  source: HTMLCanvasElement | HTMLImageElement | Blob
): Promise<ExtractedFields> {
  const { recognize } = await import("tesseract.js");
  const recognizeArg =
    source instanceof Blob ? (source as Blob) : (source as HTMLCanvasElement);
  const result = await recognize(recognizeArg, "eng");
  const data = result.data as { text?: string; lines?: OcrLine[] } | undefined;
  const text = data?.text || "";
  const lines = Array.isArray(data?.lines) ? (data!.lines as OcrLine[]) : [];

  return {
    expiry: extractExpiry(text) || "",
    weightGrams: extractWeight(text) || 0,
    name: extractProductName(lines, text),
    rawText: text,
  };
}

/* ---------- Product name extraction ---------- */

// Lines that almost certainly aren't a product name. Keeps nutrition facts,
// ingredient lists, codes, and boilerplate out of the running.
const SKIP_LINE_RE =
  /^(ingredients?|nutrition|net wt|net weight|distributed|made in|product of|best before|exp|use by|sell by|keep|store at|barcode|warning|contains|caution|see (back|side)|allergen|allergens|do not|refrigerate|http|www\.|©|®)\b/i;

/**
 * Picks the line most likely to be the product name from Tesseract's
 * per-line output. Heuristic: largest font (tallest bbox), after filtering
 * out obvious non-name lines.
 *
 * Falls back to the first plausible-looking line in `rawText` when the
 * lines array isn't populated.
 */
export function extractProductName(lines: OcrLine[], rawText = ""): string {
  const ranked = lines
    .map((l) => ({
      text: collapseWhitespace(l.text || ""),
      height: bboxHeight(l.bbox),
    }))
    .filter(({ text }) => isPlausibleName(text))
    .sort((a, b) => b.height - a.height);

  if (ranked.length > 0) return ranked[0].text;

  for (const candidate of rawText.split(/\r?\n/)) {
    const cleaned = collapseWhitespace(candidate);
    if (isPlausibleName(cleaned)) return cleaned;
  }
  return "";
}

function bboxHeight(b: OcrLine["bbox"]): number {
  if (!b) return 0;
  return Math.max(0, (b.y1 ?? 0) - (b.y0 ?? 0));
}

function isPlausibleName(text: string): boolean {
  if (!text) return false;
  if (text.length < 3 || text.length > 60) return false;
  if (SKIP_LINE_RE.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  const digitCount = (text.match(/\d/g) || []).length;
  if (digitCount / text.length > 0.4) return false;
  return true;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/* ---------- Date extraction ---------- */

export function extractExpiry(text: string): string | null {
  // 1. Look near explicit keywords first — most reliable.
  KEYWORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEYWORD_RE.exec(text)) !== null) {
    const candidate = parseDate(m[2] || "");
    if (candidate) return candidate;
  }

  // 2. Then any date pattern in the text. First match wins, but we sort
  // by "looks like a sensible future-ish date" so a "manufactured" date
  // doesn't get picked up as expiry. We pick the latest in-range date,
  // assuming expiry > MFG > printed date.
  const candidates: string[] = [];
  for (const re of [RE_ISO, RE_NUM, RE_TEXT_MONTH]) {
    const g = new RegExp(re.source, re.flags + "g");
    let mm: RegExpExecArray | null;
    while ((mm = g.exec(text)) !== null) {
      const d = parseDate(mm[0]);
      if (d) candidates.push(d);
    }
  }
  if (candidates.length === 0) return null;

  // Prefer the *latest* candidate — manufacturers usually print MFG date
  // before BB/EXP, so when there are two, the bigger one tends to be the
  // expiry. Tie-break by giving up.
  candidates.sort();
  return candidates[candidates.length - 1];
}

function parseDate(blob: string): string | null {
  if (!blob) return null;
  const trimmed = blob.trim();

  // Try ISO first — unambiguous.
  let m = trimmed.match(RE_ISO);
  if (m) {
    const y = clampYear(Number(m[1]));
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (validYmd(y, mo, d)) return fmt(y, mo, d);
  }

  // Numeric: try to disambiguate. If either field > 12 it locks the order.
  m = trimmed.match(RE_NUM);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = clampYear(Number(m[3]));
    let day = 0;
    let mo = 0;
    if (a > 12 && b <= 12) {
      day = a;
      mo = b;
    } else if (b > 12 && a <= 12) {
      mo = a;
      day = b;
    } else {
      // Truly ambiguous (both ≤ 12). Default to DD/MM/YYYY because
      // Canadian/European packaging uses it more often than US MM/DD.
      day = a;
      mo = b;
    }
    if (validYmd(y, mo, day)) return fmt(y, mo, day);
  }

  // Text month: "12 Jul 2026", "Jul 12 2026", "Jul 2026" etc.
  m = trimmed.match(RE_TEXT_MONTH);
  if (m) {
    const monthName = m[2].toLowerCase();
    const mo = MONTH_NAMES[monthName];
    if (mo) {
      const day = Number(m[1] || m[3] || "1");
      const y = clampYear(Number(m[4]));
      if (validYmd(y, mo, day)) return fmt(y, mo, day);
    }
  }

  return null;
}

function clampYear(n: number): number {
  if (!n) return 0;
  if (n < 100) return 2000 + n; // "26" → 2026
  if (n < 1000) return 0; // 3-digit garbage
  return n;
}

function validYmd(y: number, m: number, d: number): boolean {
  if (!y || y < 2000 || y > 2099) return false;
  if (!m || m < 1 || m > 12) return false;
  if (!d || d < 1 || d > 31) return false;
  // Reject clearly-in-the-past dates (likely MFG, not expiry). Allow a
  // small grace window so today-dated items still come through.
  const now = new Date();
  const candidate = new Date(y, m - 1, d);
  const grace = new Date(now);
  grace.setDate(grace.getDate() - 30);
  return candidate >= grace;
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/* ---------- Weight extraction ---------- */

const WEIGHT_RE =
  /(\d+(?:[.,]\d+)?)\s*(kg|kgs|g|grams?|gr|oz|ozs|ounces?|lb|lbs|pounds?|ml|l|liters?|litres?|fl\.?\s*oz)/gi;

const TO_GRAMS: Record<string, { grams: number }> = {
  g: { grams: 1 }, gr: { grams: 1 }, gram: { grams: 1 }, grams: { grams: 1 },
  kg: { grams: 1000 }, kgs: { grams: 1000 },
  oz: { grams: 28.35 }, ozs: { grams: 28.35 }, ounce: { grams: 28.35 }, ounces: { grams: 28.35 },
  lb: { grams: 453.59 }, lbs: { grams: 453.59 }, pound: { grams: 453.59 }, pounds: { grams: 453.59 },
  ml: { grams: 1 }, l: { grams: 1000 }, liter: { grams: 1000 }, liters: { grams: 1000 },
  litre: { grams: 1000 }, litres: { grams: 1000 },
  "fl oz": { grams: 30 }, "fl.oz": { grams: 30 }, "floz": { grams: 30 },
};

export function extractWeight(text: string): number {
  WEIGHT_RE.lastIndex = 0;
  let best = 0;
  let m: RegExpExecArray | null;
  while ((m = WEIGHT_RE.exec(text)) !== null) {
    const value = parseFloat(m[1].replace(",", "."));
    const unit = m[2].toLowerCase().replace(/\s+/g, "").replace(".", "");
    const lookup = TO_GRAMS[unit] || TO_GRAMS[unit.replace(/s$/, "")];
    if (!lookup) continue;
    const grams = Math.round(value * lookup.grams);
    // Net weight is almost always the *largest* number with a unit on the
    // label — calorie counts and serving sizes are smaller.
    if (grams > best) best = grams;
  }
  return best;
}
