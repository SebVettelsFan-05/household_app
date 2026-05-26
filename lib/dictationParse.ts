/**
 * Free-text inventory dictation parser.
 *
 * The user dictates into a textarea using their phone's keyboard mic and we
 * try to break the blob into discrete inventory items. The anchor is the
 * product name — weight and expiry can appear before or after it in any
 * order. Multiple items are separated by commas, periods, semicolons, or
 * connector words ("and", "then", "next", "also").
 *
 * Examples that should parse:
 *
 *   "chicken breast 500 grams expires June 12, onions one kilogram,
 *    yogurt 750 grams best before May 30"
 *
 *   "two pounds ground beef, 1 kg potatoes exp 2026-06-01"
 *
 *   "tomatoes, three onions, half kilo carrots best before next month"
 *
 * Returned rows carry the cleaned name + grams + expiry plus a list of
 * warnings ("weight not found", "date wasn't legible") so the UI can flag
 * rows that need attention before submit.
 */

import { titleCaseName } from "./normalize";

export type DictationItem = {
  name: string;
  quantityGrams: number; // 0 when we couldn't make out a weight
  expiry: string; // YYYY-MM-DD or empty
  raw: string;
  warnings: string[];
};

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000,
  half: 0.5, quarter: 0.25,
};

const UNIT_TO_GRAMS: Record<string, number> = {
  g: 1, gm: 1, gram: 1, grams: 1,
  kg: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.59, lbs: 453.59, pound: 453.59, pounds: 453.59,
  ml: 1, milliliter: 1, milliliters: 1, millilitre: 1, millilitres: 1,
  l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000,
};

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const EXPIRY_KEYWORDS =
  /\b(?:expires?\s*(?:on)?|expiry|exp\.?|best\s*before|best\s*by|use\s*by|bb|bbd|consume\s*by|good\s*until|until)\b/gi;

export function parseDictation(text: string): DictationItem[] {
  const normalized = preprocess(text);
  if (!normalized) return [];
  const chunks = splitIntoChunks(normalized);
  return chunks.map(parseChunk).filter((item) => item.name.length > 0);
}

/* ---------- pre-processing ---------- */

function preprocess(text: string): string {
  return text
    // Normalize fancy punctuation phones love to insert.
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // Collapse whitespace.
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits dictation into one chunk per item. Phone dictation is messy on both
 * axes — punctuation gets dropped, item boundaries get blurred — so we use a
 * two-pass split:
 *
 *   1. Primary split on punctuation + connector words ("and", "then", etc.).
 *      This catches the cases where the user did pause / the OS did insert a
 *      comma. "and a half" / "and a quarter" are protected so weight phrases
 *      don't get torn in half.
 *
 *   2. Within each primary chunk, anchor on weight tokens so a chunk with
 *      multiple weights gets one item per weight. The name attaches to
 *      whichever side of the weight has content: "chicken 500g" → name on
 *      the left; "500g chicken" → name on the right. This avoids the bug
 *      where weight-first dictation ("500g chicken, 1kg onions") attributed
 *      "chicken" to the wrong weight.
 */
function splitIntoChunks(text: string): string[] {
  const primary = primarySplit(text);
  const chunks: string[] = [];
  for (const p of primary) {
    for (const c of weightSplit(p)) chunks.push(c);
  }
  return chunks;
}

function primarySplit(text: string): string[] {
  const protectedText = text.replace(
    /\band\s+(a\s+half|a\s+quarter|half|quarter)\b/gi,
    "_and_$1"
  );
  return protectedText
    .split(/[,.;\n]|\s+(?:and|then|next|also|plus)\s+/i)
    .map((s) => s.replace(/_and_/g, "and ").trim())
    .filter(Boolean);
}

/**
 * Splits a single primary chunk into one item per detected weight. With no
 * weight we keep the chunk intact (the user gets a "no weight detected"
 * warning and can fix it in the modal).
 */
function weightSplit(text: string): string[] {
  const weights: { start: number; end: number }[] = [];
  const re = new RegExp(WEIGHT_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    weights.push({ start: m.index, end: m.index + m[0].length });
  }
  if (weights.length === 0) {
    const t = text.trim();
    return t ? [t] : [];
  }

  const chunks: string[] = [];
  let cursor = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    const leftRaw = text.slice(cursor, w.start);
    let chunkEnd: number;
    if (hasMeaningfulText(leftRaw)) {
      // Name comes before the weight — close the chunk after the weight,
      // pulling in any trailing expiry that belongs with this item.
      chunkEnd = absorbTrailingExpiry(text, w.end);
    } else {
      // No name on the left (start of text, or only stopwords like "of"/"a").
      // The name is whatever sits between this weight and the next one.
      chunkEnd = i + 1 < weights.length ? weights[i + 1].start : text.length;
    }
    const chunk = text.slice(cursor, chunkEnd).trim();
    if (chunk) chunks.push(chunk);
    cursor = chunkEnd;
  }
  const trailing = text.slice(cursor).trim();
  if (trailing) chunks.push(trailing);
  return chunks;
}

const NAME_STOPWORDS_RE = /\b(?:and|then|next|also|plus|with|of|for|a|an|the)\b/gi;

/** True when `text` contains any token that isn't just connector/stopword fluff. */
function hasMeaningfulText(text: string): boolean {
  return text.replace(NAME_STOPWORDS_RE, "").replace(/\s+/g, "").length > 0;
}

/**
 * Looks at the text right after a weight match. If it starts with an
 * expiry keyword + date, absorb both. If it starts with a bare date
 * pattern (no keyword), absorb just the date. Returns the new end index.
 */
function absorbTrailingExpiry(text: string, weightEnd: number): number {
  const tail = text.slice(weightEnd);
  // Keyword-led expiry: "exp June 12", "best before May 30", etc.
  const kw = tail.match(
    /^\s*(?:expires?(?:\s*on)?|expiry|exp\.?|best\s*before|best\s*by|use\s*by|bb|bbd|consume\s*by|good\s*until)[:\s.]*([^\n]+?)(?=\s+[A-Za-z]{3,}|\s*$)/i
  );
  if (kw) {
    // Look ahead for the first date within the captured tail.
    const dateInTail = findFirstDate(kw[0]);
    if (dateInTail.matched) {
      const matchedEnd = kw[0].indexOf(dateInTail.matched) + dateInTail.matched.length;
      return weightEnd + matchedEnd;
    }
    // Keyword without a parseable date — absorb the keyword itself.
    return weightEnd + kw[0].length;
  }
  // Bare date: look for one within the first ~30 chars of the tail, but
  // only if it's followed by what looks like a new item (whitespace + a
  // word starting with a letter) or end of string. This avoids stealing a
  // date that's actually part of the next item's name.
  const trimmedTail = tail.match(/^\s*/);
  const ws = trimmedTail ? trimmedTail[0].length : 0;
  const candidate = tail.slice(ws, ws + 40);
  const dateMatch = findFirstDate(candidate);
  if (dateMatch.matched && candidate.indexOf(dateMatch.matched) === 0) {
    return weightEnd + ws + dateMatch.matched.length;
  }
  return weightEnd;
}

/* ---------- per-chunk parsing ---------- */

function parseChunk(raw: string): DictationItem {
  const warnings: string[] = [];
  let working = raw;

  // 1. Pull off the expiry first. Keyword + date OR just a date.
  const expiry = extractExpiry(working);
  if (expiry.matched) {
    working = working.replace(expiry.matched, " ");
  } else {
    const fallback = extractStandaloneDate(working);
    if (fallback.matched) {
      working = working.replace(fallback.matched, " ");
      expiry.value = fallback.value;
    }
  }
  if (!expiry.value) warnings.push("no expiry date detected");

  // 2. Pull off the weight.
  const weight = extractWeight(working);
  if (weight.matched) {
    working = working.replace(weight.matched, " ");
  }
  if (!weight.grams) warnings.push("no weight detected");

  // 3. Whatever's left is the name.
  const name = cleanName(working);

  return {
    name,
    quantityGrams: weight.grams,
    expiry: expiry.value,
    raw: raw.trim(),
    warnings: name ? warnings : warnings.concat("no product name found"),
  };
}

function cleanName(text: string): string {
  let cleaned = text
    .replace(/\s+/g, " ")
    .replace(/^\s*[-:•]\s*/, "")
    .replace(/[-:•]\s*$/, "")
    .trim();
  // Strip leading connectors / articles that survive cross-item splits and
  // weight extraction, e.g. "and onions" → "onions", "of beef" → "beef",
  // "a chicken" → "chicken".
  cleaned = cleaned.replace(
    /^(?:and|then|next|also|plus|with|of|for|an?|the)\s+/i,
    ""
  );
  // Drop trailing prep tails that crept in past chunk splitting
  // ("garlic finely chopped" → "garlic"). Lifted from parseIngredient's
  // modifier list; not worth importing the whole thing here.
  cleaned = cleaned.replace(
    /\s+(?:finely|coarsely|thinly|thickly|roughly|freshly|fresh)\s+(?:chopped|diced|sliced|grated|minced|ground|crumbled).*$/i,
    ""
  );
  cleaned = cleaned.replace(/\s+(?:chopped|diced|sliced|grated|minced|crumbled)$/i, "");
  if (!cleaned) return "";
  return titleCaseName(cleaned);
}

/* ---------- expiry extraction ---------- */

function extractExpiry(text: string): { matched: string; value: string } {
  EXPIRY_KEYWORDS.lastIndex = 0;
  const kw = EXPIRY_KEYWORDS.exec(text);
  if (!kw) return { matched: "", value: "" };
  // Look at the text from the keyword onward for a date.
  const tail = text.slice(kw.index);
  const date = findFirstDate(tail);
  if (!date.matched) return { matched: "", value: "" };
  // Combine the keyword and the date so they're both stripped together.
  const start = kw.index;
  const end = start + tail.indexOf(date.matched) + date.matched.length;
  return { matched: text.slice(start, end), value: date.value };
}

function extractStandaloneDate(text: string): {
  matched: string;
  value: string;
} {
  return findFirstDate(text);
}

const RE_ISO_DATE = /(20\d{2})[\s./-](\d{1,2})[\s./-](\d{1,2})/;
const RE_NUMERIC_DATE = /(\d{1,2})[\s./-](\d{1,2})(?:[\s./-](\d{2,4}))?/;
const RE_MONTH_DAY =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{2,4}))?/i;
const RE_DAY_MONTH =
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?(?:[,\s]+(\d{2,4}))?/i;

function findFirstDate(text: string): { matched: string; value: string } {
  // Walk in priority order: ISO is unambiguous, then "Month day", then
  // "day Month", then bare numeric. The first hit wins.
  let m: RegExpExecArray | null;

  if ((m = RE_ISO_DATE.exec(text))) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (validYmd(y, mo, d)) return { matched: m[0], value: fmt(y, mo, d) };
  }

  if ((m = RE_MONTH_DAY.exec(text))) {
    const mo = MONTH_NAMES[m[1].toLowerCase()];
    const d = Number(m[2]);
    const y = pickYear(m[3], mo);
    if (validYmd(y, mo, d)) return { matched: m[0], value: fmt(y, mo, d) };
  }

  if ((m = RE_DAY_MONTH.exec(text))) {
    const d = Number(m[1]);
    const mo = MONTH_NAMES[m[2].toLowerCase()];
    const y = pickYear(m[3], mo);
    if (validYmd(y, mo, d)) return { matched: m[0], value: fmt(y, mo, d) };
  }

  if ((m = RE_NUMERIC_DATE.exec(text))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = pickYear(m[3], Math.min(a, b));
    let day = 0;
    let mo = 0;
    if (a > 12 && b <= 12) { day = a; mo = b; }
    else if (b > 12 && a <= 12) { mo = a; day = b; }
    else { day = a; mo = b; } // default DD/MM (Canadian convention)
    if (validYmd(y, mo, day)) return { matched: m[0], value: fmt(y, mo, day) };
  }

  return { matched: "", value: "" };
}

function pickYear(yearStr: string | undefined, month: number): number {
  if (yearStr) {
    let y = Number(yearStr);
    if (y < 100) y += 2000;
    return y;
  }
  // No year supplied — assume the user means an upcoming occurrence.
  const now = new Date();
  const candidate = now.getFullYear();
  if (month >= now.getMonth() + 1) return candidate;
  return candidate + 1;
}

function validYmd(y: number, m: number, d: number): boolean {
  if (!y || y < 2000 || y > 2099) return false;
  if (!m || m < 1 || m > 12) return false;
  if (!d || d < 1 || d > 31) return false;
  return true;
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/* ---------- weight extraction ---------- */

const WEIGHT_RE = new RegExp(
  // Numeric quantity: digits with optional fraction/decimal/word fragments,
  // OR a word number (optionally prefixed by "a"/"an" — "a half pound"),
  // OR the bare indefinite article (so "a kilo" parses as 1 kilo).
  String.raw`((?:\d+(?:[.,]\d+)?(?:\s*(?:and|&)\s*(?:a\s+)?(?:half|quarter))?` +
    String.raw`|\b(?:an?\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|` +
    String.raw`thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|` +
    String.raw`thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|half|quarter)` +
    String.raw`(?:\s+(?:and\s+)?(?:a\s+)?(?:half|quarter|hundred|thousand))?` +
    String.raw`|\ban?\b))` +
    // Optional "of" and/or "a" between the quantity and the unit
    // ("half a kilo", "a quarter of a pound", "two of pounds").
    String.raw`\s*(?:of\s+)?(?:a\s+)?` +
    // Unit. Trailing \b guards single-letter "g"/"l" from matching inside
    // words like "all" or "egg".
    String.raw`(grams?|gm|kgs?|kilo(?:gram)?s?|ounces?|oz|pounds?|lbs?|` +
    String.raw`mls?|milli(?:liter|litre)s?|liters?|litres?|l|g)\b`,
  "i"
);

function extractWeight(text: string): { matched: string; grams: number } {
  WEIGHT_RE.lastIndex = 0;
  const m = WEIGHT_RE.exec(text);
  if (!m) return { matched: "", grams: 0 };
  const qty = parseQuantity(m[1]);
  if (!qty) return { matched: "", grams: 0 };
  const unitKey = m[2].toLowerCase().replace(/\s+/g, "");
  const grams = UNIT_TO_GRAMS[unitKey] ?? lookupUnitFuzzy(unitKey);
  if (!grams) return { matched: "", grams: 0 };
  return { matched: m[0], grams: Math.max(1, Math.round(qty * grams)) };
}

function lookupUnitFuzzy(unit: string): number {
  // Stem common variations ("kilograms" → "kilogram", "litres" → "litre").
  if (unit.endsWith("s")) {
    const stem = unit.slice(0, -1);
    if (UNIT_TO_GRAMS[stem]) return UNIT_TO_GRAMS[stem];
  }
  return 0;
}

/**
 * Parses "500", "1.5", "1 1/2", "one and a half", "half", "two hundred",
 * "two and a half". Returns 0 if nothing makes sense.
 */
function parseQuantity(raw: string): number {
  const text = raw.toLowerCase().trim();
  if (!text) return 0;

  // "a" / "an" → 1. Handled here (rather than in WORD_NUMBERS) so the token
  // is treated as "1" in isolation but still ignored as filler inside
  // compound phrases like "one and a half".
  if (text === "a" || text === "an") return 1;

  // Pure numeric (with optional fraction-ish bits like "1 1/2").
  const numericMatch = text.match(/^(\d+(?:[.,]\d+)?)(?:\s+(\d+)\/(\d+))?$/);
  if (numericMatch) {
    let value = parseFloat(numericMatch[1].replace(",", "."));
    if (numericMatch[2] && numericMatch[3]) {
      value += Number(numericMatch[2]) / Number(numericMatch[3]);
    }
    return Number.isFinite(value) ? value : 0;
  }

  // Decimal then "and a half" / "and a quarter".
  const decimalPlusFraction = text.match(
    /^(\d+(?:[.,]\d+)?)\s*(?:and|&)\s*(?:a\s+)?(half|quarter)$/
  );
  if (decimalPlusFraction) {
    const base = parseFloat(decimalPlusFraction[1].replace(",", "."));
    const extra = WORD_NUMBERS[decimalPlusFraction[2]] || 0;
    return Number.isFinite(base) ? base + extra : 0;
  }

  // Word-number chains: "two hundred", "one and a half", "two and a half".
  const tokens = text.split(/\s+/);
  let total = 0;
  let current = 0;
  let fraction = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "and" || t === "of" || t === "a" || t === "an" || t === "&") continue;
    const n = WORD_NUMBERS[t];
    if (n === undefined) return 0;
    if (n === 0.5 || n === 0.25) {
      fraction += n;
    } else if (n === 100 || n === 1000) {
      current = Math.max(current, 1) * n;
    } else {
      current += n;
    }
  }
  total = current + fraction;
  return total > 0 ? total : 0;
}
