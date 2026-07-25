/**
 * Splits free-text recipe ingredient strings into the shape the app stores.
 *
 * Input examples:
 *   "2 tbsp olive oil"          → { name: "olive oil", quantity: 30, ... }
 *   "500g chicken thighs"       → { name: "chicken thighs", quantity: 500, ... }
 *   "1 1/2 cup flour"           → { name: "flour", quantity: 191, ... }  (flour density)
 *   "1 (14 oz) can black beans" → { name: "black beans", quantity: 397, ... }
 *   "3 large eggs"              → { name: "eggs", quantity: 165, ... }   (per-item weight)
 *   "For the sauce:"            → { name: "", isSectionHeader: true }
 *
 * Volume → grams conversions use a per-ingredient density table for common
 * staples (flour, sugar, butter, oil, …) and water density otherwise; count
 * lines use typical per-item weights for common produce/eggs. Everything
 * derived that way is flagged `approximate` so the UI can nudge the user to
 * double-check. When we genuinely can't tell, we return `quantity: 0` — a
 * deliberate "fill me in" signal rather than a confident lie.
 */

import { parseIngredient as libParse } from "parse-ingredient";
import { collapseWhitespace, decodeHtmlEntities } from "./htmlText";
import { normalizeName } from "./normalize";

/**
 * Quality / preparation modifiers we strip from the start of an ingredient
 * name so close variants merge with existing inventory. The list is
 * deliberately conservative:
 *
 *   - We only strip *quality* / shelf-marketing prefixes ("lean",
 *     "reduced-sodium") and obvious noise.
 *   - We DO NOT strip type markers like "ground", "red", "frozen", "whole"
 *     — those are how the user distinguishes "ground beef" from "beef", or
 *     "red onion" from "white onion".
 *
 * Match is case-insensitive at word boundaries. The fixed-point loop in
 * `cleanIngredientName` strips one prefix at a time, so chains like
 * "Extra lean organic chicken" → "chicken" work without bespoke ordering.
 */
const QUALITY_MODIFIERS = [
  // sodium
  "reduced-sodium", "reduced sodium",
  "low-sodium", "low sodium",
  "no-salt-added", "no salt added",
  "no-salt", "no salt",
  "low-salt", "low salt",
  "unsalted",
  "salt-free", "salt free",
  // sugar
  "no-sugar-added", "no sugar added",
  "sugar-free", "sugar free",
  "unsweetened",
  "low-sugar", "low sugar",
  "reduced-sugar", "reduced sugar",
  // fat
  "low-fat", "low fat",
  "full-fat", "full fat",
  "fat-free", "fat free",
  "reduced-fat", "reduced fat",
  "nonfat", "non-fat",
  "low-cholesterol", "low cholesterol",
  "skim",
  // calories
  "low-calorie", "low calorie",
  "reduced-calorie", "reduced calorie",
  "diet",
  "lite",
  "zero-calorie", "zero calorie",
  // meat grades / cuts marketing
  "extra-lean", "extra lean",
  "lean",
  // oil grades
  "extra-virgin", "extra virgin",
  "virgin",
  "boneless", "skinless",
  "boneless skinless", "skinless boneless",
  "trimmed",
  // sourcing / shelf-marketing claims
  "free-range", "free range",
  "cage-free", "cage free",
  "pasture-raised", "pasture raised",
  "grass-fed", "grass fed",
  "grain-fed", "grain fed",
  "wild-caught", "wild caught",
  "farm-raised", "farm raised",
  "antibiotic-free", "antibiotic free",
  "hormone-free", "hormone free",
  "non-gmo", "non gmo",
  "gluten-free", "gluten free",
  "dairy-free", "dairy free",
  "vegan",
  "vegetarian",
  "kosher",
  "halal",
  "organic",
  "premium",
  "natural",
  "all-natural", "all natural",
  "artisan", "artisanal",
  "homemade",
  "store-bought", "store bought",
  "fair-trade", "fair trade",
  "single-origin", "single origin",
  // size / freshness marketing
  "jumbo",
  "mini",
  "petite",
  "baby",
  // freshness state (descriptor, not type marker)
  "freshly", "fresh",
  // measuring instructions ("packed brown sugar", "heaping cup of...")
  "packed", "heaping", "heaped", "level", "scant",
  // generic intensifiers
  "extra",
  "super",
  // packaging claims
  "no-preservatives", "no preservatives",
  "unbleached",
  "uncured",
  "no-antibiotics", "no antibiotics",
  // prep instructions written as a prefix ("finely chopped fresh rosemary",
  // "thinly sliced onions"). Two-word combos must be listed before their
  // single-word substrings so the loop strips the longer form first.
  "finely chopped", "roughly chopped", "coarsely chopped", "freshly chopped",
  "finely diced", "roughly diced", "coarsely diced", "freshly diced",
  "finely sliced", "thinly sliced", "thickly sliced", "freshly sliced",
  "finely grated", "freshly grated", "coarsely grated",
  "finely minced", "freshly minced",
  "finely ground", "freshly ground", "coarsely ground",
  "finely crumbled", "freshly crumbled",
  "finely",
  "coarsely",
  "thinly", "thickly", "roughly",
];

/**
 * Leading container words left behind once quantities are parsed out —
 * "(14 oz) can diced tomatoes" ends up as "can diced tomatoes" and the can
 * itself is packaging, not product.
 */
const CONTAINER_WORDS = new Set([
  "can", "cans", "tin", "tins", "jar", "jars", "bottle", "bottles",
  "package", "packages", "packet", "packets", "box", "boxes",
  "bag", "bags", "container", "containers", "carton", "cartons",
]);

/**
 * Trailing serving/prep qualifiers that survive the comma-cut ("salt and
 * pepper to taste", "olive oil for frying"). Stripped repeatedly from the
 * end, mirroring the prefix loop.
 */
const TRAILING_PHRASES = [
  "to taste",
  "to serve",
  "to garnish",
  "to decorate",
  "to top",
  "to finish",
  "for serving",
  "for garnish",
  "for frying",
  "for greasing",
  "for drizzling",
  "for dusting",
  "for brushing",
  "for topping",
  "as needed",
  "if needed",
  "if desired",
  "plus more",
  "or more",
  "divided",
  "optional",
  "at room temperature",
  // Trailing prep participles without the usual comma ("4 eggs beaten").
  "beaten",
  "melted",
  "softened",
  "sifted",
  "whisked",
];

/**
 * Color prefixes we strip on ingredients where the color is a varietal but
 * recipes treat them as interchangeable. "Red bell pepper", "orange bell
 * pepper", "green bell pepper" all collapse to "bell pepper" so they merge
 * in inventory. Distinct from the broader rule, where color stays —
 * "red onion" ≠ "white onion".
 */
const STRIPABLE_COLOR_PREFIXES: Array<{ pattern: RegExp; replacement: string }> =
  [
    {
      pattern: /^(red|green|orange|yellow|purple|black)\s+bell\s+pepper(s?)\b/i,
      replacement: "bell pepper$2",
    },
  ];

// Leftover pack-size fragments at the head of a name once the count was
// parsed out: "x 400g tin chopped tomatoes" → "chopped tomatoes".
const LEADING_PACK_NOISE: RegExp[] = [
  /^(?:x|×)\s+/i,
  /^\d+(?:\.\d+)?\s*(?:g|kg|ml|l|oz|lb|lbs|gram|grams|ounce|ounces|pound|pounds|liter|liters|litre|litres)\b\.?\s*/i,
];

/**
 * Tightens up a free-text ingredient name so "Lean ground beef (85/15)"
 * collapses to "ground beef". Used after the parser strips quantity/units
 * so the residue stays short enough to match the user's inventory.
 *
 * Pipeline:
 *   1. Drop parentheticals — "(85/15)", "(divided)", etc.
 *   2. Drop everything after the first comma — recipe ingredients almost
 *      always use comma-suffixes for prep instructions ("garlic, finely
 *      chopped" → "garlic"; "olive oil, extra virgin" → "olive oil").
 *   3. Strip leading quality / prep modifiers, container words, and pack
 *      residue until none match.
 *   4. Strip trailing serving qualifiers ("to taste", "for garnish").
 *   5. Collapse known color-prefix varietals ("red bell pepper" → "bell
 *      pepper") so seasonal swaps merge.
 */
export function cleanIngredientName(raw: string): string {
  let s = decodeHtmlEntities(String(raw ?? ""));
  // Innermost-out so nested parentheticals ("tofu ((8 ounces))") vanish
  // completely instead of leaving a stray ")".
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\([^()]*\)/g, " ");
  }
  // Unbalanced leftovers + footnote markers.
  s = s.replace(/[()*†‡]/g, " ").trim();
  const commaIdx = s.indexOf(",");
  if (commaIdx >= 0) s = s.slice(0, commaIdx).trim();

  let changed = true;
  while (changed) {
    changed = false;
    const lower = s.toLowerCase();

    for (const mod of QUALITY_MODIFIERS) {
      if (lower === mod || lower.startsWith(mod + " ")) {
        s = s.slice(mod.length).replace(/^[\s,]+/, "");
        changed = true;
        break;
      }
    }
    if (changed) continue;

    for (const re of LEADING_PACK_NOISE) {
      if (re.test(s)) {
        s = s.replace(re, "").replace(/^[\s,]+/, "");
        changed = true;
        break;
      }
    }
    if (changed) continue;

    const firstWord = lower.split(/\s+/, 1)[0] ?? "";
    if (CONTAINER_WORDS.has(firstWord)) {
      s = s.slice(firstWord.length).replace(/^[\s,]+/, "");
      // "can of diced tomatoes" → also drop the connecting "of".
      if (/^of\s+/i.test(s)) s = s.replace(/^of\s+/i, "");
      changed = true;
    }
  }

  // Trailing qualifiers, same fixed-point idea from the other end.
  changed = true;
  while (changed) {
    changed = false;
    const lower = s.toLowerCase();
    for (const phrase of TRAILING_PHRASES) {
      if (lower === phrase) {
        s = "";
        changed = true;
        break;
      }
      if (lower.endsWith(" " + phrase)) {
        s = s.slice(0, s.length - phrase.length - 1).replace(/[\s,;-]+$/, "");
        changed = true;
        break;
      }
    }
  }

  for (const { pattern, replacement } of STRIPABLE_COLOR_PREFIXES) {
    if (pattern.test(s)) {
      s = s.replace(pattern, replacement);
      break;
    }
  }

  return s.replace(/\s+/g, " ").trim();
}

export type ParsedIngredient = {
  name: string;
  quantity: number; // grams (integer)
  // True when we had to guess (density/volume conversion, per-item weight,
  // or a quantity range). The UI uses this to nudge the user to verify.
  approximate: boolean;
  // "For the sauce:" style section headings. Name is left empty so existing
  // callers that filter on a truthy name skip them automatically.
  isSectionHeader?: boolean;
};

// Mass units → grams. Exact conversions.
const MASS_UNIT_GRAMS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  mg: 0.001,
  milligram: 0.001,
  milligrams: 0.001,
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.59,
  lbs: 453.59,
  pound: 453.59,
  pounds: 453.59,
};

// Volume units → milliliters. Grams come out after a density lookup.
const VOLUME_UNIT_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  millilitre: 1,
  millilitres: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
  cup: 240,
  cups: 240,
  c: 240,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  pint: 473,
  pints: 473,
  quart: 946,
  quarts: 946,
  gallon: 3785,
  gallons: 3785,
  fl: 30,
  "fl oz": 30,
  "floz": 30,
  "fl-oz": 30,
  "fluid ounce": 30,
  "fluid ounces": 30,
};

// Odd-one-out units with sensible typical weights.
const SPECIAL_UNIT_GRAMS: Record<string, number> = {
  stick: 113, // US butter stick
  sticks: 113,
  clove: 5, // garlic
  cloves: 5,
  pinch: 1,
  pinches: 1,
  dash: 1,
  dashes: 1,
};

// Size words the parser sometimes claims as a "unit" ("3 large eggs").
// They carry no mass — treat the line as a plain count.
const SIZE_UNITS = new Set(["small", "medium", "large", "extra large", "xl"]);

/**
 * Approximate density (g/mL) for staples that are usually measured by
 * volume. Water density is the fallback — right for liquids, tolerable for
 * everything else, and always flagged approximate.
 */
const DENSITY_PHRASES: Array<[phrase: string, density: number]> = [
  ["brown sugar", 0.89],
  ["powdered sugar", 0.5],
  ["icing sugar", 0.5],
  ["confectioners sugar", 0.5],
  ["maple syrup", 1.32],
  ["peanut butter", 1.08],
  ["almond butter", 1.08],
  ["bread crumb", 0.45],
  ["soy sauce", 1.15],
  ["fish sauce", 1.2],
  ["olive oil", 0.92],
  ["sour cream", 0.97],
  ["heavy cream", 1.0],
  ["cream cheese", 0.97],
  ["cocoa powder", 0.5],
];

const DENSITY_TOKENS: Record<string, number> = {
  flour: 0.53,
  cornstarch: 0.53,
  cornmeal: 0.66,
  sugar: 0.85,
  butter: 0.955,
  margarine: 0.955,
  oil: 0.92,
  honey: 1.42,
  molasses: 1.4,
  syrup: 1.32,
  milk: 1.03,
  cream: 1.0,
  yogurt: 1.03,
  yoghurt: 1.03,
  mayonnaise: 0.96,
  mayo: 0.96,
  ketchup: 1.14,
  rice: 0.82,
  oat: 0.38,
  oats: 0.38,
  breadcrumb: 0.45,
  breadcrumbs: 0.45,
  panko: 0.25,
  parmesan: 0.42,
  cheese: 0.45, // shredded
  cocoa: 0.5,
  salt: 1.15,
};

/**
 * Typical per-item weights (grams) for lines that are plain counts:
 * "2 eggs", "1 large onion", "3 tomatoes". Head-noun matched, so
 * "yellow onion" hits "onion". Deliberately limited to items with fairly
 * consistent sizes — everything else stays 0 ("fill me in").
 */
const COUNT_WEIGHTS: Record<string, number> = {
  egg: 55,
  "egg yolk": 18,
  "egg white": 33,
  onion: 150,
  shallot: 40,
  "garlic clove": 5,
  lemon: 100,
  lime: 70,
  orange: 130,
  banana: 120,
  apple: 180,
  tomato: 120,
  potato: 200,
  "sweet potato": 200,
  carrot: 60,
  "bell pepper": 150,
  jalapeno: 25,
  cucumber: 250,
  zucchini: 200,
  avocado: 170,
};

const SIZE_WORDS = new Set(["small", "medium", "large", "extra", "big", "ripe"]);

function countWeightFor(name: string): number | null {
  const tokens = normalizeName(name)
    .split(" ")
    .filter((t) => t && !SIZE_WORDS.has(t));
  if (tokens.length === 0) return null;
  const joined = tokens.join(" ");
  if (COUNT_WEIGHTS[joined] !== undefined) return COUNT_WEIGHTS[joined];
  if (tokens.length >= 2) {
    const lastTwo = tokens.slice(-2).join(" ");
    if (COUNT_WEIGHTS[lastTwo] !== undefined) return COUNT_WEIGHTS[lastTwo];
  }
  const last = tokens[tokens.length - 1];
  return COUNT_WEIGHTS[last] ?? null;
}

function densityFor(name: string): number {
  const normalized = normalizeName(name);
  for (const [phrase, density] of DENSITY_PHRASES) {
    if (normalized.includes(phrase)) return density;
  }
  for (const token of normalized.split(" ")) {
    if (DENSITY_TOKENS[token] !== undefined) return DENSITY_TOKENS[token];
  }
  return 1.0; // water
}

/**
 * Pack-size lines: "1 (14 oz) can diced tomatoes", "2 (400g) tins ...",
 * "2 x 400g tins ...". Returns total grams, or null when not a pack line.
 */
// Both anchored to the line start — a mid-line "(14 oz)" is an annotation
// about some other amount ("1 cup broth (from 1 (14 oz) can)"), not a pack.
const PACK_PAREN_RE =
  /^\s*(\d+(?:\.\d+)?)\s*(?:x\s*)?(?:(?:packages?|packets?|cans?|tins?|jars?|bottles?|boxes?|bags?|containers?|envelopes?|sticks?)\s+)?\(\s*(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?)\s*-?\s*(fl\s*\.?\s*oz|fluid\s+ounces?|oz|ounces?|g|grams?|kg|kilograms?|lbs?|pounds?|ml|milliliters?|millilitres?|l|liters?|litres?|teaspoons?|tsp|tablespoons?|tbsp|cups?)\b\.?[^)]*\)/i;
const PACK_X_RE =
  /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(fl\s*\.?\s*oz|oz|ounces?|g|grams?|kg|kilograms?|lbs?|pounds?|ml|milliliters?|millilitres?|l|liters?|litres?)\b/i;

function packSizeGrams(
  line: string,
  name: string
): { grams: number; approximate: boolean } | null {
  const m = PACK_PAREN_RE.exec(line) ?? PACK_X_RE.exec(line);
  if (!m) return null;
  const count = parseFloat(m[1]);
  const innerQty = parseSimpleAmount(m[2]);
  const unit = m[3].toLowerCase().replace(/\s+/g, " ").replace(/\.\s*/g, " ").trim();
  if (!count || !innerQty) return null;

  const massKey = unit.replace(/\s/g, "");
  if (MASS_UNIT_GRAMS[massKey] !== undefined) {
    return {
      grams: count * innerQty * MASS_UNIT_GRAMS[massKey],
      approximate: false,
    };
  }
  const volumeKey = unit.startsWith("fl") ? "fl oz" : unit;
  const ml = VOLUME_UNIT_ML[volumeKey] ?? VOLUME_UNIT_ML[volumeKey.replace(/s$/, "")];
  if (ml !== undefined) {
    return {
      grams: count * innerQty * ml * densityFor(name),
      approximate: true,
    };
  }
  return null;
}

/**
 * Gram-equivalent annotations in parentheticals: "2 cups (240g) flour",
 * "3/4 cup (12 Tbsp; 170g) butter", "2 chicken breasts (about 450g)".
 * Returns the first mass amount found inside any parenthetical.
 */
const PAREN_MASS_RE =
  /\(([^)]*)\)/g;
const MASS_IN_TEXT_RE =
  /(\d+(?:\.\d+)?)\s*(g|grams?|kg|kilograms?|oz|ounces?|lbs?|pounds?)\b/i;

function parenMassGrams(line: string): number | null {
  let m: RegExpExecArray | null;
  PAREN_MASS_RE.lastIndex = 0;
  while ((m = PAREN_MASS_RE.exec(line)) !== null) {
    const inner = MASS_IN_TEXT_RE.exec(m[1]);
    if (!inner) continue;
    const qty = parseFloat(inner[1]);
    const unitGrams = MASS_UNIT_GRAMS[inner[2].toLowerCase()];
    if (qty > 0 && unitGrams !== undefined) return qty * unitGrams;
  }
  return null;
}

function parseSimpleAmount(s: string): number {
  const t = s.trim();
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (mixed) {
    const denom = parseFloat(mixed[3]);
    return denom ? parseFloat(mixed[1]) + parseFloat(mixed[2]) / denom : 0;
  }
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) {
    const denom = parseFloat(frac[2]);
    return denom ? parseFloat(frac[1]) / denom : 0;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

// Vulgar-fraction characters → ASCII, so both the upstream library and our
// own pack-size regex see "1/4" instead of "¼".
const VULGAR_FRACTIONS: Record<string, string> = {
  "¼": "1/4", "½": "1/2", "¾": "3/4",
  "⅓": "1/3", "⅔": "2/3",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5",
  "⅙": "1/6", "⅚": "5/6",
  "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};
const VULGAR_FRACTION_RE = /([0-9])?([¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g;

/** Entity-decode + unicode cleanup so the parser sees plain ASCII-ish text. */
function prepareLine(raw: string): string {
  return collapseWhitespace(
    decodeHtmlEntities(String(raw ?? ""))
      // Fraction slash → plain slash so "1⁄2" parses like "1/2".
      .replace(/⁄/g, "/")
      // "1½" → "1 1/2", "¼" → "1/4".
      .replace(
        VULGAR_FRACTION_RE,
        (_, digit: string | undefined, frac: string) =>
          (digit ? digit + " " : "") + VULGAR_FRACTIONS[frac]
      )
  );
}

/**
 * Best-effort parse. Always returns a result — the UI shouldn't have to
 * handle the "couldn't parse anything" case specially since the worst-case
 * result is a row with name = original string and quantity = 0.
 */
export function parseRecipeIngredient(raw: string): ParsedIngredient {
  const prepared = prepareLine(raw);
  if (!prepared) return { name: "", quantity: 0, approximate: false };

  const parsed = libParse(prepared);
  if (!parsed || parsed.length === 0) {
    return {
      name: cleanIngredientName(prepared),
      quantity: 0,
      approximate: false,
    };
  }
  const first = parsed[0];

  // "For the sauce:" — a heading, not an ingredient. Empty name lets every
  // existing caller drop it via their truthy-name filter.
  if (first.isGroupHeader) {
    return { name: "", quantity: 0, approximate: false, isSectionHeader: true };
  }

  // Library can return `null` for either field on unparseable input.
  const rawName = (first.description || prepared).trim();
  // Strip quality modifiers + parenthetical notes so "Lean ground beef
  // (85/15)" matches an existing "Ground Beef" line in the grocery list.
  // Fall back to the parser's raw name if cleanup left nothing.
  const name = cleanIngredientName(rawName) || rawName;

  // Pack-size lines carry their real size in the parenthetical the library
  // ignores — reconstruct it before falling back to unit math.
  const pack = packSizeGrams(prepared, name);
  if (pack) {
    return {
      name,
      quantity: Math.max(1, Math.round(pack.grams)),
      approximate: pack.approximate,
    };
  }

  // Ranges ("1-2 lbs", "2 to 3 tbsp") → midpoint, flagged approximate.
  const lower =
    typeof first.quantity === "number" && Number.isFinite(first.quantity)
      ? first.quantity
      : 0;
  const upper =
    typeof first.quantity2 === "number" && Number.isFinite(first.quantity2)
      ? first.quantity2
      : 0;
  const isRange = lower > 0 && upper > lower;
  const amount = isRange ? (lower + upper) / 2 : lower;

  if (!amount) {
    return { name, quantity: 0, approximate: false };
  }

  const unitRaw = (first.unitOfMeasure || "").toLowerCase().trim();
  const unitId = (first.unitOfMeasureID || "").toLowerCase().trim();

  // A "(240g)"-style annotation, if present — used to sharpen or replace
  // estimates below.
  const equivalence = parenMassGrams(prepared);

  // "3 large eggs" — the parser eats the size word as a unit. It's a count.
  const isCount = !unitRaw || SIZE_UNITS.has(unitId) || SIZE_UNITS.has(unitRaw);
  if (isCount) {
    const per = countWeightFor(name);
    if (per !== null) {
      return {
        name,
        quantity: Math.max(1, Math.round(amount * per)),
        approximate: true,
      };
    }
    // "2 chicken breasts (about 450g)" — no typical weight on file, but the
    // recipe told us anyway.
    if (equivalence !== null) {
      return {
        name,
        quantity: Math.max(1, Math.round(equivalence)),
        approximate: true,
      };
    }
    // "1 onion"-style count with no known weight — we don't know grams.
    return { name, quantity: 0, approximate: false };
  }

  const lookup = (table: Record<string, number>): number | undefined =>
    table[unitId] ?? table[unitRaw] ?? table[stripDot(unitRaw)];

  const massGrams = lookup(MASS_UNIT_GRAMS);
  if (massGrams !== undefined) {
    return {
      name,
      quantity: Math.max(1, Math.round(amount * massGrams)),
      approximate: isRange,
    };
  }

  const volumeMl = lookup(VOLUME_UNIT_ML);
  if (volumeMl !== undefined) {
    const estimate = amount * volumeMl * densityFor(name);
    // "1 cup (125g) flour" — when the annotated mass roughly agrees with the
    // density estimate it's an equivalence for this exact amount, so prefer
    // it. Way-off values are something else (e.g. "from 1 (14 oz) can").
    if (
      equivalence !== null &&
      estimate > 0 &&
      equivalence / estimate >= 0.7 &&
      equivalence / estimate <= 1.4
    ) {
      return {
        name,
        quantity: Math.max(1, Math.round(equivalence)),
        approximate: false,
      };
    }
    return {
      name,
      quantity: Math.max(1, Math.round(estimate)),
      approximate: true,
    };
  }

  const specialGrams = lookup(SPECIAL_UNIT_GRAMS);
  if (specialGrams !== undefined) {
    return {
      name,
      quantity: Math.max(1, Math.round(amount * specialGrams)),
      approximate: true,
    };
  }

  // Unknown unit ("1 can black beans (15 oz)") — the annotation is all we
  // have, and it's usually right.
  if (equivalence !== null) {
    return {
      name,
      quantity: Math.max(1, Math.round(equivalence)),
      approximate: true,
    };
  }

  return { name, quantity: 0, approximate: false };
}

function stripDot(s: string): string {
  return s.replace(/\.$/, "");
}
