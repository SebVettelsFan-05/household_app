/**
 * Category auto-suggest.
 *
 * Used by:
 *   - The recipe scraper, to tag scraped ingredients with sane defaults.
 *   - The fridge / grocery add forms, to pre-pick a category as the user
 *     types a name.
 *
 * Strategy (in order):
 *   1. **History match** — case-insensitive token overlap against everything
 *      the household has already tagged. If you've previously logged "chicken
 *      breast" as Meat, then "chicken thighs" should also land in Meat.
 *   2. **Built-in keyword fallback** — small hand-rolled dictionary that
 *      maps common groceries to mainstay categories. Lets a brand-new
 *      household get useful guesses before they've built any history.
 *
 * Returns `null` when neither method confidently matches — callers then
 * fall back to the existing default (typically "Other").
 */

import { FALLBACK_CATEGORY, MAINSTAY_CATEGORIES, normalizeName } from "./normalize";

// Loose lexical features so "Chicken breasts" matches "Chicken thigh".
// Splits on whitespace, dashes, slashes; drops single-character tokens and
// short noise words. Lowercased.
function tokens(s: string): string[] {
  const STOP = new Set([
    "a", "an", "the",
    "of", "for", "and", "or",
    "fresh", "frozen", "dried",
    "raw", "cooked", "chopped", "sliced", "diced", "grated", "ground",
    "small", "medium", "large", "extra",
    "lean", "boneless", "skinless", "organic",
    "with", "without",
    "to", "taste",
  ]);
  return Array.from(
    new Set(
      normalizeName(s)
        .split(/[\s\-/,]+/)
        .map((t) => t.replace(/[^a-z0-9]+/g, ""))
        .filter((t) => t.length > 1 && !STOP.has(t))
    )
  );
}

/**
 * Built-in keyword → category map. Conservative — keys are the most
 * recognizable tokens. Misses fall through to the user's history; if both
 * miss, the caller uses the default.
 */
const KEYWORD_CATEGORY: Array<[string, string]> = [
  // Meat
  ["chicken", "Meat"], ["beef", "Meat"], ["pork", "Meat"], ["lamb", "Meat"],
  ["turkey", "Meat"], ["bacon", "Meat"], ["sausage", "Meat"], ["ham", "Meat"],
  ["ribs", "Meat"], ["steak", "Meat"], ["mince", "Meat"], ["pepperoni", "Meat"],
  ["fish", "Meat"], ["salmon", "Meat"], ["tuna", "Meat"], ["cod", "Meat"],
  ["shrimp", "Meat"], ["prawn", "Meat"], ["scallop", "Meat"], ["crab", "Meat"],
  // Veggies
  ["spinach", "Veggies"], ["lettuce", "Veggies"], ["kale", "Veggies"],
  ["arugula", "Veggies"], ["carrot", "Veggies"], ["carrots", "Veggies"],
  ["onion", "Veggies"], ["onions", "Veggies"], ["garlic", "Veggies"],
  ["potato", "Veggies"], ["potatoes", "Veggies"], ["tomato", "Veggies"],
  ["tomatoes", "Veggies"], ["cucumber", "Veggies"], ["pepper", "Veggies"],
  ["peppers", "Veggies"], ["broccoli", "Veggies"], ["cauliflower", "Veggies"],
  ["mushroom", "Veggies"], ["mushrooms", "Veggies"], ["celery", "Veggies"],
  ["zucchini", "Veggies"], ["squash", "Veggies"], ["asparagus", "Veggies"],
  ["leek", "Veggies"], ["leeks", "Veggies"], ["scallion", "Veggies"],
  ["ginger", "Veggies"], ["jalapeno", "Veggies"], ["cabbage", "Veggies"],
  ["corn", "Veggies"], ["peas", "Veggies"], ["green", "Veggies"],
  // Fruits
  ["apple", "Fruits"], ["apples", "Fruits"], ["banana", "Fruits"],
  ["bananas", "Fruits"], ["orange", "Fruits"], ["oranges", "Fruits"],
  ["lemon", "Fruits"], ["lime", "Fruits"], ["berry", "Fruits"],
  ["berries", "Fruits"], ["blueberry", "Fruits"], ["blueberries", "Fruits"],
  ["strawberry", "Fruits"], ["strawberries", "Fruits"], ["raspberry", "Fruits"],
  ["grape", "Fruits"], ["grapes", "Fruits"], ["pear", "Fruits"],
  ["peach", "Fruits"], ["peaches", "Fruits"], ["pineapple", "Fruits"],
  ["mango", "Fruits"], ["watermelon", "Fruits"], ["cantaloupe", "Fruits"],
  ["avocado", "Fruits"], ["kiwi", "Fruits"],
  // Dairy
  ["milk", "Dairy"], ["cream", "Dairy"], ["cheese", "Dairy"], ["yogurt", "Dairy"],
  ["yoghurt", "Dairy"], ["butter", "Dairy"], ["egg", "Dairy"], ["eggs", "Dairy"],
  ["cheddar", "Dairy"], ["mozzarella", "Dairy"], ["parmesan", "Dairy"],
  ["feta", "Dairy"], ["ricotta", "Dairy"], ["sourcream", "Dairy"],
  // Bakery
  ["bread", "Bakery"], ["bun", "Bakery"], ["buns", "Bakery"],
  ["bagel", "Bakery"], ["bagels", "Bakery"], ["tortilla", "Bakery"],
  ["tortillas", "Bakery"], ["pita", "Bakery"], ["naan", "Bakery"],
  ["roll", "Bakery"], ["rolls", "Bakery"], ["croissant", "Bakery"],
  ["sourdough", "Bakery"], ["baguette", "Bakery"], ["muffin", "Bakery"],
  ["muffins", "Bakery"],
  // Pantry
  ["rice", "Pantry"], ["pasta", "Pantry"], ["noodle", "Pantry"],
  ["noodles", "Pantry"], ["flour", "Pantry"], ["sugar", "Pantry"],
  ["salt", "Pantry"], ["oil", "Pantry"], ["olive", "Pantry"],
  ["vinegar", "Pantry"], ["bean", "Pantry"], ["beans", "Pantry"],
  ["lentil", "Pantry"], ["lentils", "Pantry"], ["chickpea", "Pantry"],
  ["chickpeas", "Pantry"], ["quinoa", "Pantry"], ["oat", "Pantry"],
  ["oats", "Pantry"], ["cereal", "Pantry"], ["peanut", "Pantry"],
  ["honey", "Pantry"], ["broth", "Pantry"], ["stock", "Pantry"],
  ["cornstarch", "Pantry"], ["baking", "Pantry"],
  // Frozen
  ["frozen", "Frozen"], ["icecream", "Frozen"],
  // Snacks
  ["chip", "Snacks"], ["chips", "Snacks"], ["cracker", "Snacks"],
  ["crackers", "Snacks"], ["cookie", "Snacks"], ["cookies", "Snacks"],
  ["pretzel", "Snacks"], ["popcorn", "Snacks"], ["granola", "Snacks"],
  ["chocolate", "Snacks"],
  // Beverages
  ["water", "Beverages"], ["juice", "Beverages"], ["coffee", "Beverages"],
  ["tea", "Beverages"], ["soda", "Beverages"], ["beer", "Beverages"],
  ["wine", "Beverages"], ["sparkling", "Beverages"],
  // Condiments
  ["ketchup", "Condiments"], ["mustard", "Condiments"], ["mayo", "Condiments"],
  ["mayonnaise", "Condiments"], ["sriracha", "Condiments"], ["hotsauce", "Condiments"],
  ["soy", "Condiments"], ["sauce", "Condiments"], ["dressing", "Condiments"],
  ["salsa", "Condiments"], ["jam", "Condiments"], ["jelly", "Condiments"],
  ["pesto", "Condiments"], ["hummus", "Condiments"], ["sriracha", "Condiments"],
];

type HistoryEntry = { name: string; category: string };

/**
 * Returns the best-guess category, or `null` if neither history nor the
 * keyword dictionary could decide.
 *
 * @param name              Free-text name to categorize.
 * @param history           Existing tagged items (fridge items, grocery
 *                          items, recipe ingredients — anything with
 *                          `{ name, category }`). Earlier = more relevant.
 * @param validCategories   The categories the household actually has. Guesses
 *                          for categories outside this list are dropped so
 *                          we never assign a phantom category.
 */
export function guessCategory(
  name: string,
  history: HistoryEntry[],
  validCategories: string[]
): string | null {
  const target = tokens(name);
  if (target.length === 0) return null;
  const validSet = new Set(
    validCategories.map((c) => c.toLowerCase())
  );

  // 1. Score every history entry by token overlap with the input. Best
  // overlap wins. Ties broken by recency (history is iterated in given
  // order; first match wins on ties).
  let best: { score: number; category: string } | null = null;
  for (const entry of history) {
    if (!entry.name || !entry.category) continue;
    if (
      entry.category.toLowerCase() === FALLBACK_CATEGORY.toLowerCase()
    ) {
      // Don't propagate the catch-all — it's no signal at all.
      continue;
    }
    if (!validSet.has(entry.category.toLowerCase())) continue;
    const entryTokens = tokens(entry.name);
    let score = 0;
    for (const t of target) {
      if (entryTokens.includes(t)) score++;
    }
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { score, category: entry.category };
    }
  }
  if (best) return best.category;

  // 2. Fall back to the built-in keyword dictionary.
  for (const t of target) {
    for (const [kw, cat] of KEYWORD_CATEGORY) {
      if (t === kw && validSet.has(cat.toLowerCase())) {
        return cat;
      }
    }
  }

  return null;
}

/**
 * Convenience for the most common call — guess if possible, otherwise
 * return the fallback category. Always returns a valid category name.
 */
export function guessCategoryOrFallback(
  name: string,
  history: HistoryEntry[],
  validCategories: string[]
): string {
  const guess = guessCategory(name, history, validCategories);
  if (guess) return guess;
  // Prefer the canonical fallback if it's in the valid list; otherwise pick
  // the first mainstay we can find; otherwise the first category at all.
  if (
    validCategories.some(
      (c) => c.toLowerCase() === FALLBACK_CATEGORY.toLowerCase()
    )
  ) {
    return FALLBACK_CATEGORY;
  }
  const mainstay = MAINSTAY_CATEGORIES.find((m) =>
    validCategories.some((c) => c.toLowerCase() === m.toLowerCase())
  );
  return mainstay || validCategories[0] || FALLBACK_CATEGORY;
}
