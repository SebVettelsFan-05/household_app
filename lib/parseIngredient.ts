/**
 * Splits free-text recipe ingredient strings into the shape the app stores.
 *
 * Input examples:
 *   "2 tbsp olive oil"        → { name: "olive oil", quantity: 30, ... }
 *   "500g chicken thighs"     → { name: "chicken thighs", quantity: 500, ... }
 *   "1 1/2 cup flour"         → { name: "flour", quantity: 360, ... }
 *   "1 large onion"           → { name: "large onion", quantity: 0, ... }
 *
 * Volume → grams conversions are approximate (using water density). When the
 * unit is unrecognized or absent we return `quantity: 0` so the user knows
 * to fill it in. This is intentional — we'd rather hand off a row that says
 * "fix me" than confidently lie about grams.
 */

import { parseIngredient as libParse } from "parse-ingredient";

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
 *   3. Strip leading quality / prep modifiers until none match.
 *   4. Collapse known color-prefix varietals ("red bell pepper" → "bell
 *      pepper") so seasonal swaps merge.
 */
export function cleanIngredientName(raw: string): string {
  let s = raw.replace(/\s*\([^)]*\)/g, " ").trim();
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
  // True when we had to guess (unrecognized unit or volume conversion). The
  // UI uses this to nudge the user to verify before saving.
  approximate: boolean;
};

// Lowercase unit → grams-per-unit. Volumetric units assume water-like
// density (~1 g/mL); fine for liquids, a guess for solids.
const UNIT_TO_GRAMS: Record<string, { grams: number; approximate: boolean }> = {
  // Mass — exact.
  g: { grams: 1, approximate: false },
  gram: { grams: 1, approximate: false },
  grams: { grams: 1, approximate: false },
  kg: { grams: 1000, approximate: false },
  kilogram: { grams: 1000, approximate: false },
  kilograms: { grams: 1000, approximate: false },
  mg: { grams: 0.001, approximate: false },
  oz: { grams: 28.35, approximate: false },
  ounce: { grams: 28.35, approximate: false },
  ounces: { grams: 28.35, approximate: false },
  lb: { grams: 453.59, approximate: false },
  lbs: { grams: 453.59, approximate: false },
  pound: { grams: 453.59, approximate: false },
  pounds: { grams: 453.59, approximate: false },

  // Volume — approximate (water density).
  ml: { grams: 1, approximate: true },
  milliliter: { grams: 1, approximate: true },
  milliliters: { grams: 1, approximate: true },
  millilitre: { grams: 1, approximate: true },
  millilitres: { grams: 1, approximate: true },
  l: { grams: 1000, approximate: true },
  liter: { grams: 1000, approximate: true },
  liters: { grams: 1000, approximate: true },
  litre: { grams: 1000, approximate: true },
  litres: { grams: 1000, approximate: true },
  cup: { grams: 240, approximate: true },
  cups: { grams: 240, approximate: true },
  c: { grams: 240, approximate: true },
  tbsp: { grams: 15, approximate: true },
  tablespoon: { grams: 15, approximate: true },
  tablespoons: { grams: 15, approximate: true },
  T: { grams: 15, approximate: true },
  tsp: { grams: 5, approximate: true },
  teaspoon: { grams: 5, approximate: true },
  teaspoons: { grams: 5, approximate: true },
  t: { grams: 5, approximate: true },
  pint: { grams: 473, approximate: true },
  pints: { grams: 473, approximate: true },
  quart: { grams: 946, approximate: true },
  quarts: { grams: 946, approximate: true },
  gallon: { grams: 3785, approximate: true },
  gallons: { grams: 3785, approximate: true },
  fl: { grams: 30, approximate: true }, // e.g. "fl oz" → handled below
  "fl oz": { grams: 30, approximate: true },
  "fluid ounce": { grams: 30, approximate: true },
  "fluid ounces": { grams: 30, approximate: true },
};

/**
 * Best-effort parse. Always returns a result — the UI shouldn't have to
 * handle the "couldn't parse anything" case specially since the worst-case
 * result is a row with name = original string and quantity = 0.
 */
export function parseRecipeIngredient(raw: string): ParsedIngredient {
  const trimmed = raw.trim();
  if (!trimmed) return { name: "", quantity: 0, approximate: false };

  const parsed = libParse(trimmed);
  if (!parsed || parsed.length === 0) {
    return {
      name: cleanIngredientName(trimmed),
      quantity: 0,
      approximate: false,
    };
  }
  const first = parsed[0];

  // Library can return `null` for either field on unparseable input.
  const rawName = (first.description || trimmed).trim();
  // Strip quality modifiers + parenthetical notes so "Lean ground beef
  // (85/15)" matches an existing "Ground Beef" line in the grocery list.
  // Fall back to the parser's raw name if cleanup left nothing.
  const name = cleanIngredientName(rawName) || rawName;
  const amount =
    typeof first.quantity === "number" && Number.isFinite(first.quantity)
      ? first.quantity
      : 0;
  const unit = (first.unitOfMeasure || "").toLowerCase().trim();

  if (!amount) {
    return { name, quantity: 0, approximate: false };
  }

  if (!unit) {
    // No unit — could be "1 onion", "2 eggs". We don't know grams.
    return { name, quantity: 0, approximate: false };
  }

  const conversion = UNIT_TO_GRAMS[unit] ?? UNIT_TO_GRAMS[stripDot(unit)];
  if (!conversion) {
    return { name, quantity: 0, approximate: false };
  }
  return {
    name,
    quantity: Math.max(1, Math.round(amount * conversion.grams)),
    approximate: conversion.approximate,
  };
}

function stripDot(s: string): string {
  return s.replace(/\.$/, "");
}
