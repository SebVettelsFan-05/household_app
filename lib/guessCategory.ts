/**
 * Deterministic grocery category suggestions shared by inventory, grocery,
 * recipe imports, dictation, and barcode lookup.
 *
 * The classifier deliberately separates three kinds of evidence:
 *
 * 1. An exact normalized household match normally acts as a correction.
 * 2. Built-in phrase/product rules handle cold starts and can repair one lone
 *    legacy mainstay guess when the compound meaning is unambiguous.
 * 3. Similar household names are considered only when there is no built-in
 *    answer, and require a clear weighted consensus.
 *
 * That ordering prevents a single generic word in history ("apple pie") from
 * overriding the actual product type ("apple"), while still learning exact
 * household choices and custom categories.
 */

import {
  FALLBACK_CATEGORY,
  MAINSTAY_CATEGORIES,
  normalizeName,
} from "./normalize";

export type CategoryHistoryEntry = {
  name: string;
  category: string;
  /**
   * Relative trust in this label. Directly managed inventory/grocery rows can
   * use a higher value; auto-generated recipe history uses a lower value so it
   * cannot reinforce an old guess. Existing callers default to 1.
   */
  weight?: number;
};

/** Weight persisted household corrections above legacy/automatic labels. */
export function storedCategoryWeight(categoryReviewed?: boolean): number {
  return categoryReviewed === true ? 2 : 0.6;
}

type CategoryEvidence = {
  total: number;
  strongest: number;
};

type ExactHistoryMatch = {
  category: string;
};

type BuiltInMatch = {
  category: string;
};

type PhraseRule = {
  phrase: string;
  category: string;
  score: number;
};

// These words do not distinguish one grocery product from another. They are
// removed for exact-history keys and fuzzy comparison, but the full token list
// is still retained for phrase rules such as "ice cream" and "green beans".
const NAME_NOISE = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "and",
  "or",
  "with",
  "without",
  "to",
  "taste",
  "optional",
  "plus",
  "divided",
  "fresh",
  "freshly",
  "raw",
  "cooked",
  "chopped",
  "sliced",
  "diced",
  "grated",
  "minced",
  "peeled",
  "crushed",
  "ground",
  "small",
  "medium",
  "large",
  "extra",
  "lean",
  "boneless",
  "skinless",
  "organic",
  "natural",
  "quality",
  "high",
  "purpose",
  "all",
  "approximately",
  "about",
  "can",
  "canned",
  "package",
  "pack",
  "pkg",
  "bottle",
  "bag",
  "box",
]);

// A match on one of these describes packaging/preparation rather than the
// actual product. It must never be enough to copy a category from history.
const FUZZY_NOISE = new Set([
  ...NAME_NOISE,
  "red",
  "green",
  "yellow",
  "orange",
  "purple",
  "white",
  "black",
  "brown",
  "powder",
  "flake",
  "sauce",
  "paste",
  "oil",
  "vinegar",
  "juice",
  "stock",
  "broth",
  "seasoning",
  "mix",
]);

const UNIT_TOKENS = new Set([
  "g",
  "kg",
  "mg",
  "ml",
  "oz",
  "lb",
  "lbs",
  "tsp",
  "tbsp",
  "teaspoon",
  "tablespoon",
  "cup",
  "pint",
  "quart",
  "liter",
  "litre",
]);

/**
 * Specific compound rules. Scores are intentionally higher than individual
 * token cues, so product type beats an earlier modifier: orange + juice is a
 * beverage; tortilla + chips is a snack; frozen + peas stays Frozen.
 */
const PHRASE_RULES: PhraseRule[] = [
  { phrase: "ice cream", category: "Frozen", score: 320 },
  { phrase: "tortilla chips", category: "Snacks", score: 300 },
  { phrase: "potato chips", category: "Snacks", score: 300 },
  { phrase: "corn chips", category: "Snacks", score: 300 },
  { phrase: "granola bar", category: "Snacks", score: 280 },
  { phrase: "protein bar", category: "Snacks", score: 280 },

  { phrase: "garlic bread", category: "Bakery", score: 300 },
  { phrase: "banana bread", category: "Bakery", score: 300 },
  { phrase: "corn tortilla", category: "Bakery", score: 280 },
  { phrase: "flour tortilla", category: "Bakery", score: 280 },
  { phrase: "bread flour", category: "Pantry", score: 300 },

  { phrase: "bread crumb", category: "Pantry", score: 300 },
  { phrase: "panko bread crumb", category: "Pantry", score: 320 },
  { phrase: "corn starch", category: "Pantry", score: 300 },
  { phrase: "peanut butter", category: "Pantry", score: 300 },
  { phrase: "almond butter", category: "Pantry", score: 300 },
  { phrase: "cashew butter", category: "Pantry", score: 300 },
  { phrase: "garlic powder", category: "Pantry", score: 300 },
  { phrase: "onion powder", category: "Pantry", score: 300 },
  { phrase: "mustard powder", category: "Pantry", score: 300 },
  { phrase: "baking powder", category: "Pantry", score: 300 },
  { phrase: "baking soda", category: "Pantry", score: 300 },
  { phrase: "butter chicken powder", category: "Pantry", score: 320 },
  { phrase: "curry powder", category: "Pantry", score: 300 },
  { phrase: "chili powder", category: "Pantry", score: 300 },
  { phrase: "chilli powder", category: "Pantry", score: 300 },
  { phrase: "chile powder", category: "Pantry", score: 300 },
  { phrase: "pepper flake", category: "Pantry", score: 300 },
  { phrase: "chili flake", category: "Pantry", score: 300 },
  { phrase: "chilli flake", category: "Pantry", score: 300 },
  { phrase: "chile flake", category: "Pantry", score: 300 },
  { phrase: "garlic flake", category: "Pantry", score: 300 },
  { phrase: "onion flake", category: "Pantry", score: 300 },
  { phrase: "potato flake", category: "Pantry", score: 300 },
  { phrase: "black pepper", category: "Pantry", score: 300 },
  { phrase: "white pepper", category: "Pantry", score: 300 },
  { phrase: "cayenne pepper", category: "Pantry", score: 300 },
  { phrase: "curry paste", category: "Pantry", score: 280 },
  { phrase: "lemongrass paste", category: "Pantry", score: 280 },
  { phrase: "cooking wine", category: "Pantry", score: 280 },
  { phrase: "dry white wine", category: "Pantry", score: 280 },
  { phrase: "dry red wine", category: "Pantry", score: 280 },
  { phrase: "apple cider vinegar", category: "Pantry", score: 300 },
  { phrase: "wine vinegar", category: "Pantry", score: 280 },
  { phrase: "chicken stock", category: "Pantry", score: 280 },
  { phrase: "chicken broth", category: "Pantry", score: 280 },
  { phrase: "chicken bouillon", category: "Pantry", score: 280 },
  { phrase: "chicken boullion", category: "Pantry", score: 280 },
  { phrase: "beef stock", category: "Pantry", score: 280 },
  { phrase: "beef broth", category: "Pantry", score: 280 },
  { phrase: "beef bouillon", category: "Pantry", score: 280 },
  { phrase: "beef boullion", category: "Pantry", score: 280 },
  { phrase: "vegetable stock", category: "Pantry", score: 280 },
  { phrase: "vegetable broth", category: "Pantry", score: 280 },

  { phrase: "bell pepper", category: "Veggies", score: 300 },
  { phrase: "green bean", category: "Veggies", score: 300 },
  { phrase: "string bean", category: "Veggies", score: 300 },
  { phrase: "snow pea", category: "Veggies", score: 300 },
  { phrase: "snap pea", category: "Veggies", score: 300 },
  { phrase: "sweet potato", category: "Veggies", score: 280 },
  // Phrases below are written in normalized (singularized) form, because
  // matching happens on normalized tokens: "brussels sprouts" → "brussel
  // sprout".
  { phrase: "bok choy", category: "Veggies", score: 300 },
  { phrase: "brussel sprout", category: "Veggies", score: 300 },

  { phrase: "maple syrup", category: "Pantry", score: 300 },
  { phrase: "pine nut", category: "Pantry", score: 300 },
  { phrase: "mac and cheese", category: "Pantry", score: 300 },

  { phrase: "hot dog", category: "Meat", score: 300 },

  { phrase: "cream cheese", category: "Dairy", score: 300 },
  { phrase: "cottage cheese", category: "Dairy", score: 300 },

  { phrase: "hot chocolate", category: "Beverages", score: 300 },

  { phrase: "trail mix", category: "Snacks", score: 300 },
  { phrase: "rice cake", category: "Snacks", score: 280 },

  { phrase: "fish sauce", category: "Condiments", score: 320 },
  { phrase: "oyster sauce", category: "Condiments", score: 320 },
  { phrase: "soy sauce", category: "Condiments", score: 320 },
  { phrase: "hot sauce", category: "Condiments", score: 320 },
  { phrase: "barbecue sauce", category: "Condiments", score: 320 },
  { phrase: "bbq sauce", category: "Condiments", score: 320 },
  { phrase: "salad dressing", category: "Condiments", score: 300 },
  { phrase: "tomato paste", category: "Condiments", score: 280 },

  { phrase: "orange juice", category: "Beverages", score: 320 },
  { phrase: "apple juice", category: "Beverages", score: 320 },
  { phrase: "lemon juice", category: "Beverages", score: 300 },
  { phrase: "lime juice", category: "Beverages", score: 300 },
  { phrase: "fruit juice", category: "Beverages", score: 300 },
  { phrase: "coconut water", category: "Beverages", score: 300 },
  { phrase: "sparkling water", category: "Beverages", score: 300 },
  { phrase: "coffee bean", category: "Beverages", score: 300 },
  { phrase: "iced coffee", category: "Beverages", score: 300 },

  { phrase: "chocolate milk", category: "Dairy", score: 300 },
  { phrase: "coconut milk", category: "Dairy", score: 280 },
  { phrase: "almond milk", category: "Dairy", score: 280 },
  { phrase: "oat milk", category: "Dairy", score: 280 },
  { phrase: "soy milk", category: "Dairy", score: 280 },
  { phrase: "sour cream", category: "Dairy", score: 280 },
];

/**
 * Individual product cues. Classification scores all cues instead of taking
 * the first word, which makes the result independent of word and history
 * order. Context nouns intentionally carry more weight than ingredients.
 */
const TOKEN_RULES: Array<[token: string, category: string, score: number]> = [
  // Meat / seafood
  ...tokenRules(
    [
      "chicken",
      "beef",
      "pork",
      "lamb",
      "turkey",
      "bacon",
      "sausage",
      "ham",
      "rib",
      "steak",
      "mince",
      "meat",
      "veal",
      "duck",
      "prosciutto",
      "salami",
      "pepperoni",
      "fish",
      "salmon",
      "tuna",
      "cod",
      "shrimp",
      "prawn",
      "scallop",
      "crab",
      "lobster",
      "tilapia",
      "trout",
      "anchovy",
      "sardine",
      "brisket",
      "chorizo",
      "meatball",
      "drumstick",
      "wing",
      "tenderloin",
      "sirloin",
      "ribeye",
      "flank",
      "oxtail",
      "liver",
      "halibut",
      "snapper",
      "catfish",
      "mussel",
      "clam",
      "oyster",
      "squid",
      "calamari",
      "octopus",
      "pastrami",
      "bologna",
      "kielbasa",
      "bratwurst",
      "hotdog",
    ],
    "Meat",
    125
  ),

  // Produce. Color adjectives are deliberately absent.
  ...tokenRules(
    [
      "spinach",
      "lettuce",
      "kale",
      "arugula",
      "carrot",
      "onion",
      "garlic",
      "potato",
      "tomato",
      "cucumber",
      "pepper",
      "broccoli",
      "brocolli",
      "cauliflower",
      "mushroom",
      "celery",
      "zucchini",
      "squash",
      "asparagus",
      "leek",
      "scallion",
      "ginger",
      "jalapeno",
      "cabbage",
      "corn",
      "pea",
      "edamame",
      "avocado",
      "cilantro",
      "coleslaw",
      "slaw",
      "vegetable",
      "veggie",
      "shallot",
      "eggplant",
      "aubergine",
      "courgette",
      "radish",
      "beet",
      "beetroot",
      "turnip",
      "parsnip",
      "chard",
      "romaine",
      "endive",
      "fennel",
      "artichoke",
      "okra",
      "pumpkin",
      "sprout",
      "watercress",
      "lemongrass",
      "chile",
      "daikon",
      "tomatillo",
      "broccolini",
      "napa",
      "basil",
      "mint",
      "dill",
      "chive",
      "salad",
    ],
    "Veggies",
    115
  ),
  ...tokenRules(
    [
      "apple",
      "banana",
      "orange",
      "lemon",
      "lime",
      "berry",
      "blueberry",
      "strawberry",
      "raspberry",
      "blackberry",
      "grape",
      "pear",
      "peach",
      "pineapple",
      "mango",
      "watermelon",
      "cantaloupe",
      "kiwi",
      "grapefruit",
      "cherry",
      "plum",
      "apricot",
      "coconut",
      "fruit",
      "fig",
      "pomegranate",
      "cranberry",
      "nectarine",
      "tangerine",
      "clementine",
      "mandarin",
      "papaya",
      "guava",
      "lychee",
      "melon",
      "honeydew",
      "plantain",
      "persimmon",
    ],
    "Fruits",
    115
  ),

  // Dairy / chilled
  ...tokenRules(
    [
      "milk",
      "cream",
      "cheese",
      "yogurt",
      "yoghurt",
      "butter",
      "egg",
      "cheddar",
      "mozzarella",
      "parmesan",
      "feta",
      "ricotta",
      "margarine",
      "velveeta",
      "sourcream",
      "dairy",
      "brie",
      "gouda",
      "provolone",
      "havarti",
      "halloumi",
      "paneer",
      "mascarpone",
      "buttermilk",
      "ghee",
      "kefir",
      "camembert",
      "gruyere",
      "pecorino",
      "asiago",
      "burrata",
    ],
    "Dairy",
    135
  ),

  // Bakery
  ...tokenRules(
    [
      "bread",
      "bun",
      "bagel",
      "tortilla",
      "pita",
      "naan",
      "roll",
      "croissant",
      "sourdough",
      "baguette",
      "muffin",
      "loaf",
      "wrap",
      "bakery",
      "ciabatta",
      "brioche",
      "focaccia",
      "pumpernickel",
      "crumpet",
    ],
    "Bakery",
    135
  ),

  // Shelf-stable staples and recipe seasonings
  ...tokenRules(
    [
      "rice",
      "pasta",
      "spaghetti",
      "noodle",
      "flour",
      "sugar",
      "salt",
      "bean",
      "lentil",
      "chickpea",
      "quinoa",
      "oat",
      "oats",
      "cereal",
      "peanut",
      "honey",
      "cornstarch",
      "starch",
      "couscous",
      "bouillon",
      "boullion",
      "masala",
      "panko",
      "breadcrumb",
      "extract",
      "vanilla",
      "seed",
      "paprika",
      "cumin",
      "turmeric",
      "oregano",
      "thyme",
      "rosemary",
      "parsley",
      "coriander",
      "cardamom",
      "cinnamon",
      "nutmeg",
      "clove",
      "cayenne",
      "spice",
      "herb",
      "pantry",
      "yeast",
      "cornmeal",
      "polenta",
      "semolina",
      "tahini",
      "miso",
      "gochujang",
      "harissa",
      "molasses",
      "syrup",
      "walnut",
      "almond",
      "cashew",
      "pecan",
      "pistachio",
      "hazelnut",
      "macadamia",
      "sesame",
      "chia",
      "flax",
      "barley",
      "farro",
      "bulgur",
      "buckwheat",
      "millet",
      "tapioca",
      "cocoa",
      "raisin",
      "gelatin",
      "shortening",
      "lard",
      "ramen",
      "udon",
      "soba",
      "gnocchi",
      "macaroni",
      "sage",
      "tarragon",
      "marjoram",
      "dried",
    ],
    "Pantry",
    125
  ),
  ...tokenRules(["oil", "vinegar", "broth", "stock"], "Pantry", 190),
  // Canned/instant soup is shelf-stable; beats single-ingredient cues like
  // "tomato" but not product-type markers.
  ...tokenRules(["soup"], "Pantry", 150),
  // A bare "powder" or "flakes" is too vague to classify (protein powder,
  // cleaning powder, potato flakes, etc.). Specific compounds above and the
  // ingredient token itself still identify garlic/curry/pepper powders.
  ...tokenRules(["seasoning"], "Pantry", 210),

  // Storage/type markers
  ...tokenRules(
    ["frozen", "icecream", "popsicle", "fry"],
    "Frozen",
    360
  ),
  ...tokenRules(["sorbet", "gelato"], "Frozen", 170),
  ...tokenRules(
    [
      "chips",
      "chip",
      "cracker",
      "cookie",
      "pretzel",
      "popcorn",
      "granola",
      "chocolate",
      "brownie",
      "candy",
      "snack",
      "jerky",
    ],
    "Snacks",
    170
  ),
  ...tokenRules(
    [
      "water",
      "coffee",
      "tea",
      "soda",
      "beer",
      "wine",
      "lemonade",
      "cola",
      "sprite",
      "drink",
      "beverage",
      "kombucha",
      "cider",
      "matcha",
      "espresso",
      "smoothie",
      "seltzer",
    ],
    "Beverages",
    175
  ),
  ...tokenRules(["juice"], "Beverages", 230),
  ...tokenRules(
    [
      "ketchup",
      "mustard",
      "mayo",
      "mayonnaise",
      "sriracha",
      "hotsauce",
      "salsa",
      "jam",
      "jelly",
      "pesto",
      "hummus",
      "relish",
      "aioli",
      "marinade",
      "tabasco",
      "condiment",
      "gravy",
      "chutney",
      "kimchi",
      "sauerkraut",
      "tzatziki",
      "pickle",
      "caper",
      "wasabi",
      "horseradish",
    ],
    "Condiments",
    190
  ),
  // Below "oil" (190) so "olive oil" stays Pantry, but wins for bare
  // "olives" / "olive tapenade".
  ...tokenRules(["olive"], "Condiments", 130),
  ...tokenRules(["sauce", "dressing"], "Condiments", 230),
];

function tokenRules(
  tokens: string[],
  category: string,
  score: number
): Array<[string, string, number]> {
  return tokens.map((token) => [token, category, score]);
}

/**
 * Returns the best category, or null when there is not enough evidence.
 */
export function guessCategory(
  name: string,
  history: CategoryHistoryEntry[],
  validCategories: string[]
): string | null {
  // Keep the ordered token stream (with any repeats) for phrase matching, and
  // derive the de-duplicated list for the set-based exact/fuzzy comparisons.
  // De-duping before phrase detection would let a repeated word between a
  // phrase's halves ("apple juice apple") silently break its adjacency.
  const orderedTokens = categoryTokensOrdered(name);
  if (orderedTokens.length === 0) return null;
  const allTokens = unique(orderedTokens);

  const valid = validCategoryMap(validCategories);
  if (valid.size === 0) return null;

  // Exact normalized labels are the correction/learning path. Only normal or
  // high-trust entries can win here; low-trust auto-recipe history is retained
  // for cautious fuzzy voting below.
  const exact = exactHistoryGuess(allTokens, history, valid);
  if (exact) return exact.category;

  const builtIn = builtInGuess(orderedTokens, valid);
  if (builtIn) return builtIn.category;

  // Legacy/unreviewed exact labels are still useful for products outside the
  // built-in vocabulary (brands, supplements, household goods). They are
  // consulted only after product rules, so an old wrong guess cannot beat a
  // clear name such as "orange juice".
  const legacyExact = exactHistoryGuess(allTokens, history, valid, 0.5);
  if (legacyExact) return legacyExact.category;

  return fuzzyHistoryGuess(allTokens, history, valid);
}

/**
 * Exact household lookup without applying built-in or fuzzy rules. Useful
 * when a caller has extra taxonomy text that should help cold starts but must
 * not prevent a precise product-name correction from winning.
 */
export function guessCategoryFromExactHistory(
  name: string,
  history: CategoryHistoryEntry[],
  validCategories: string[]
): string | null {
  const tokens = categoryTokens(name);
  if (tokens.length === 0) return null;
  const valid = validCategoryMap(validCategories);
  return exactHistoryGuess(tokens, history, valid)?.category ?? null;
}

/**
 * Guess if possible; otherwise return a category that is actually present in
 * the household list, preferring Other and then a canonical mainstay.
 */
export function guessCategoryOrFallback(
  name: string,
  history: CategoryHistoryEntry[],
  validCategories: string[]
): string {
  const guess = guessCategory(name, history, validCategories);
  if (guess) return guess;

  const fallback = validCategories.find(
    (category) =>
      category.toLowerCase() === FALLBACK_CATEGORY.toLowerCase()
  );
  if (fallback) return fallback;

  for (const mainstay of MAINSTAY_CATEGORIES) {
    const match = validCategories.find(
      (category) => category.toLowerCase() === mainstay.toLowerCase()
    );
    if (match) return match;
  }
  return validCategories[0] || FALLBACK_CATEGORY;
}

function exactHistoryGuess(
  targetTokens: string[],
  history: CategoryHistoryEntry[],
  valid: Map<string, string>,
  minimumWeight = 0.75
): ExactHistoryMatch | null {
  const targetKey = exactKey(targetTokens);
  if (!targetKey) return null;

  const stats = new Map<
    string,
    { maxWeight: number; totalWeight: number; count: number }
  >();
  for (const entry of history) {
    const categoryKey = usableHistoryCategory(entry, valid);
    if (!categoryKey) continue;
    if (exactKey(categoryTokens(entry.name)) !== targetKey) continue;

    const weight = historyWeight(entry.weight);
    // Values below this threshold are machine-derived context, not evidence
    // of a household correction. They can still participate in fuzzy voting.
    if (weight < minimumWeight) continue;
    const current = stats.get(categoryKey) ?? {
      maxWeight: 0,
      totalWeight: 0,
      count: 0,
    };
    current.maxWeight = Math.max(current.maxWeight, weight);
    current.totalWeight += weight;
    current.count += 1;
    stats.set(categoryKey, current);
  }

  const ranked = [...stats.entries()]
    .filter(([, value]) => value.maxWeight >= minimumWeight)
    .sort((a, b) => compareHistoryStats(b[1], a[1]));
  if (ranked.length === 0) return null;
  if (
    ranked.length > 1 &&
    compareHistoryStats(ranked[0][1], ranked[1][1]) === 0
  ) {
    // Conflicting exact labels with equal support are not a correction. Let
    // deterministic built-in rules decide instead of depending on row order.
    return null;
  }
  const category = valid.get(ranked[0][0]);
  return category ? { category } : null;
}

function compareHistoryStats(
  a: { maxWeight: number; totalWeight: number; count: number },
  b: { maxWeight: number; totalWeight: number; count: number }
): number {
  return (
    a.maxWeight - b.maxWeight ||
    a.totalWeight - b.totalWeight ||
    a.count - b.count
  );
}

function builtInGuess(
  allTokens: string[],
  valid: Map<string, string>
): BuiltInMatch | null {
  const evidence = new Map<string, CategoryEvidence>();

  for (const rule of PHRASE_RULES) {
    if (containsPhrase(allTokens, rule.phrase)) {
      addEvidence(evidence, rule.category, rule.score, valid);
    }
  }

  const uniqueTokens = new Set(allTokens);
  for (const [token, category, score] of TOKEN_RULES) {
    if (uniqueTokens.has(token)) {
      addEvidence(evidence, category, score, valid);
    }
  }

  const ranked = [...evidence.entries()].sort(
    (a, b) =>
      b[1].strongest - a[1].strongest ||
      b[1].total - a[1].total ||
      a[0].localeCompare(b[0])
  );
  if (ranked.length === 0) return null;

  const [topCategory, top] = ranked[0];
  const second = ranked[1];
  if (
    second &&
    top.strongest === second[1].strongest &&
    top.total === second[1].total
  ) {
    return null;
  }
  const category = valid.get(topCategory);
  return category ? { category } : null;
}

function addEvidence(
  evidence: Map<string, CategoryEvidence>,
  rawCategory: string,
  score: number,
  valid: Map<string, string>
): void {
  const category = rawCategory.toLowerCase();
  if (!valid.has(category)) return;
  const current = evidence.get(category) ?? {
    total: 0,
    strongest: 0,
  };
  current.total += score;
  current.strongest = Math.max(current.strongest, score);
  evidence.set(category, current);
}

function fuzzyHistoryGuess(
  targetTokens: string[],
  history: CategoryHistoryEntry[],
  valid: Map<string, string>
): string | null {
  const target = fuzzyTokens(targetTokens);
  if (target.length === 0) return null;

  // Keep only the three strongest independent examples per category. This is
  // enough for consensus, while preventing repeated auto-imports of the same
  // recipe ingredient from accumulating unlimited influence.
  const bestExamples = new Map<
    string,
    { category: string; contribution: number }
  >();
  for (const entry of history) {
    const category = usableHistoryCategory(entry, valid);
    if (!category) continue;
    const entryAllTokens = categoryTokens(entry.name);
    const entryTokens = fuzzyTokens(entryAllTokens);
    if (entryTokens.length === 0) continue;

    const dedupeKey = `${exactKey(entryAllTokens)}\u0000${category}`;
    const similarity = diceSimilarity(target, entryTokens);
    if (similarity < 0.45) continue;
    const contribution = similarity * historyWeight(entry.weight);
    if (contribution <= 0) continue;
    const prior = bestExamples.get(dedupeKey);
    if (!prior || contribution > prior.contribution) {
      bestExamples.set(dedupeKey, { category, contribution });
    }
  }

  const contributions = new Map<string, number[]>();
  for (const { category, contribution } of bestExamples.values()) {
    const list = contributions.get(category) ?? [];
    list.push(contribution);
    contributions.set(category, list);
  }

  const ranked = [...contributions.entries()]
    .filter(([, values]) => values.length >= 2)
    .map(([category, values]) => ({
      category,
      score: values
        .sort((a, b) => b - a)
        .slice(0, 3)
        .reduce((sum, value) => sum + value, 0),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || a.category.localeCompare(b.category)
    );

  if (ranked.length === 0 || ranked[0].score < 0.45) return null;
  if (ranked.length > 1) {
    const lead = ranked[0].score - ranked[1].score;
    if (lead < 0.2 || ranked[0].score < ranked[1].score * 1.2) return null;
  }
  return valid.get(ranked[0].category) ?? null;
}

function usableHistoryCategory(
  entry: CategoryHistoryEntry,
  valid: Map<string, string>
): string | null {
  if (!entry?.name || !entry.category) return null;
  const category = entry.category.trim().toLowerCase();
  if (!category || category === FALLBACK_CATEGORY.toLowerCase()) return null;
  return valid.has(category) ? category : null;
}

function historyWeight(raw: number | undefined): number {
  if (raw === undefined) return 1;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, 10);
}

function validCategoryMap(categories: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of categories) {
    const category = String(raw ?? "").trim();
    if (!category) continue;
    const key = category.toLowerCase();
    if (!map.has(key)) map.set(key, category);
  }
  return map;
}

function exactKey(tokens: string[]): string {
  return tokens.filter((token) => !NAME_NOISE.has(token)).join(" ");
}

function fuzzyTokens(tokens: string[]): string[] {
  return unique(tokens.filter((token) => !FUZZY_NOISE.has(token)));
}

function diceSimilarity(a: string[], b: string[]): number {
  const bSet = new Set(b);
  let shared = 0;
  for (const token of new Set(a)) {
    if (bSet.has(token)) shared += 1;
  }
  return shared === 0 ? 0 : (2 * shared) / (a.length + b.length);
}

function containsPhrase(tokens: string[], phrase: string): boolean {
  const wanted = phrase.split(" ");
  if (wanted.length > tokens.length) return false;
  for (let start = 0; start <= tokens.length - wanted.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < wanted.length; offset += 1) {
      if (tokens[start + offset] !== wanted[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

/**
 * ASCII-fold, split punctuation/hyphens into words, and run the app's plural
 * normalization per word. Keeping this logic here makes history, phrases,
 * barcode tags, and free text follow exactly the same path.
 */
function categoryTokensOrdered(raw: string): string[] {
  const folded = String(raw ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&(?:nbsp|amp);?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!folded) return [];

  const normalized = normalizeName(folded);
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length > 1 && !UNIT_TOKENS.has(token))
    .filter((token) => !/^\d+(?:\.\d+)?$/.test(token))
    .filter((token) => !/^\d+(?:g|kg|mg|ml|l|oz|lb|lbs)$/.test(token));
}

function categoryTokens(raw: string): string[] {
  return unique(categoryTokensOrdered(raw));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
