import assert from "node:assert/strict";
import test from "node:test";

import { guessCategory, guessCategoryOrFallback } from "./guessCategory";
import { DEFAULT_CATEGORIES } from "./normalize";

const VALID_CATEGORIES = [
  ...DEFAULT_CATEGORIES,
  "Supplements",
  "Plant Proteins",
  "Proteins",
];

test("cold-start grocery staples cover every mainstay category", () => {
  const cases: Array<[name: string, expected: string]> = [
    ["chicken breast", "Meat"],
    ["ground beef", "Meat"],
    ["bell peppers", "Veggies"],
    ["green onions", "Veggies"],
    ["blueberries", "Fruits"],
    ["pineapple", "Fruits"],
    ["Greek yogurt", "Dairy"],
    ["cheddar cheese", "Dairy"],
    ["sourdough bread", "Bakery"],
    ["tortilla wraps", "Bakery"],
    ["olive oil", "Pantry"],
    ["black beans", "Pantry"],
    ["frozen pizza", "Frozen"],
    ["ice cream", "Frozen"],
    ["granola bars", "Snacks"],
    ["tortilla chips", "Snacks"],
    ["sparkling water", "Beverages"],
    ["orange juice", "Beverages"],
    ["soy sauce", "Condiments"],
    ["Caesar dressing", "Condiments"],
    ["paper towels", "Other"],
  ];

  for (const [name, expected] of cases) {
    assert.equal(
      guessCategoryOrFallback(name, [], VALID_CATEGORIES),
      expected,
      `expected ${name} to resolve to ${expected}`
    );
  }
});

test("cold-start compound names prefer the product type over a modifier", () => {
  const cases: Array<[name: string, expected: string]> = [
    ["frozen peas", "Frozen"],
    ["frozen pizza", "Frozen"],
    ["ice cream", "Frozen"],
    ["orange juice", "Beverages"],
    ["green tea", "Beverages"],
    ["tomato sauce", "Condiments"],
    ["fish sauce", "Condiments"],
    ["chicken stock", "Pantry"],
    ["apple cider vinegar", "Pantry"],
    ["garlic bread", "Bakery"],
    ["tortilla chips", "Snacks"],
    ["black pepper", "Pantry"],
    ["garlic powder", "Pantry"],
    ["all-purpose flour", "Pantry"],
    ["butter chicken powder", "Pantry"],
    ["boullion", "Pantry"],
    ["coleslaw", "Veggies"],
    ["oats", "Pantry"],
    ["French fries", "Frozen"],
    ["baking soda", "Pantry"],
    ["chicken bouillon", "Pantry"],
    ["bread flour", "Pantry"],
    ["500 g chicken breast", "Meat"],
    ["frozen foods frozen vegetables green peas", "Frozen"],
  ];

  for (const [name, expected] of cases) {
    assert.equal(
      guessCategory(name, [], VALID_CATEGORIES),
      expected,
      `expected ${name} to resolve to ${expected}`
    );
  }
});

test("a repeated word does not break phrase adjacency", () => {
  // "green pepper green bean" keeps a real "green bean" adjacency at the end.
  // De-duping the tokens before phrase matching collapses it to
  // [green, pepper, bean], where "green bean" no longer touches and the bare
  // "bean" cue drags the guess to Pantry. Phrase detection must see the
  // ordered stream so the Veggies phrase still wins.
  assert.equal(
    guessCategory("green pepper green bean", [], VALID_CATEGORIES),
    "Veggies"
  );
  // Sanity check the mechanism: with no adjacency the bean cue does win.
  assert.equal(
    guessCategory("green pepper bean", [], VALID_CATEGORIES),
    "Pantry"
  );
});

test("unknown names remain unclassified and use the configured fallback", () => {
  assert.equal(
    guessCategory("paper towels", [], VALID_CATEGORIES),
    null
  );
  assert.equal(
    guessCategoryOrFallback("paper towels", [], VALID_CATEGORIES),
    "Other"
  );
});

test("an exact normalized history match learns household and custom categories", () => {
  assert.equal(
    guessCategory(
      "Protein powders",
      [{ name: "protein powder", category: "Supplements" }],
      VALID_CATEGORIES
    ),
    "Supplements"
  );
  assert.equal(
    guessCategory(
      "Chicken breasts",
      [{ name: "chicken breast", category: "Proteins" }],
      VALID_CATEGORIES
    ),
    "Proteins",
    "an exact household label should override a built-in default"
  );
});

test("specific compound rules repair unreviewed legacy guesses", () => {
  assert.equal(
    guessCategory(
      "ice cream",
      [{ name: "Ice Cream", category: "Dairy", weight: 0.6 }],
      VALID_CATEGORIES
    ),
    "Frozen"
  );
  assert.equal(
    guessCategory(
      "apple juice",
      [{ name: "Apple Juice", category: "Condiments", weight: 0.6 }],
      VALID_CATEGORIES
    ),
    "Beverages"
  );
  assert.equal(
    guessCategory(
      "white corn tortillas",
      [
        {
          name: "White Corn Tortillas",
          category: "Beverages",
          weight: 0.6,
        },
      ],
      VALID_CATEGORIES
    ),
    "Bakery"
  );
  assert.equal(
    guessCategory(
      "shrimp",
      [{ name: "Shrimp", category: "Frozen", weight: 2 }],
      VALID_CATEGORIES
    ),
    "Frozen",
    "a household-specific storage choice remains authoritative"
  );
});

test("a reviewed mainstay correction remains learnable", () => {
  assert.equal(
    guessCategory(
      "tomato paste",
      [{ name: "Tomato Paste", category: "Pantry", weight: 2 }],
      VALID_CATEGORIES
    ),
    "Pantry"
  );
});

test("low-trust recipe guesses cannot reinforce themselves", () => {
  const autoRecipeHistory = Array.from({ length: 12 }, () => ({
    name: "garlic powder",
    category: "Veggies",
    weight: 0.25,
  }));
  assert.equal(
    guessCategory("garlic powder", autoRecipeHistory, VALID_CATEGORIES),
    "Pantry"
  );
});

test("history consensus is independent of row order", () => {
  const history = [
    { name: "smoked tempeh", category: "Plant Proteins", weight: 2 },
    { name: "marinated tempeh", category: "Plant Proteins", weight: 2 },
    { name: "tempeh bacon", category: "Meat", weight: 1 },
  ];

  assert.equal(
    guessCategory("tempeh crumbles", history, VALID_CATEGORIES),
    "Plant Proteins"
  );
  assert.equal(
    guessCategory("tempeh crumbles", [...history].reverse(), VALID_CATEGORIES),
    "Plant Proteins"
  );
});

test("one partial history overlap is not treated as consensus", () => {
  assert.equal(
    guessCategory(
      "protein powder",
      [{ name: "protein bar", category: "Snacks", weight: 2 }],
      VALID_CATEGORIES
    ),
    null
  );
  assert.equal(
    guessCategory(
      "Eggo",
      [{ name: "Eggo", category: "Frozen", weight: 0.6 }],
      VALID_CATEGORIES
    ),
    "Frozen",
    "an unreviewed exact brand remains useful after built-in rules miss"
  );
});

test("a partial history overlap does not override a stronger compound rule", () => {
  const cases: Array<{
    name: string;
    expected: string;
    history: Array<{ name: string; category: string }>;
  }> = [
    {
      name: "apples",
      expected: "Fruits",
      history: [{ name: "apple pie", category: "Bakery" }],
    },
    {
      name: "olive oil",
      expected: "Pantry",
      history: [{ name: "olive bread", category: "Bakery" }],
    },
    {
      name: "chicken stock",
      expected: "Pantry",
      history: [{ name: "chicken breast", category: "Meat" }],
    },
    {
      name: "fish sauce",
      expected: "Condiments",
      history: [{ name: "fish fillet", category: "Meat" }],
    },
  ];

  for (const { name, expected, history } of cases) {
    assert.equal(
      guessCategory(name, history, VALID_CATEGORIES),
      expected,
      `partial history should not misclassify ${name}`
    );
  }
});

test("fallback and invalid history categories provide no learning signal", () => {
  assert.equal(
    guessCategory(
      "orange juice",
      [{ name: "orange juice", category: "Other" }],
      VALID_CATEGORIES
    ),
    "Beverages"
  );
  assert.equal(
    guessCategory(
      "chicken breast",
      [{ name: "chicken breast", category: "Deleted Category" }],
      VALID_CATEGORIES
    ),
    "Meat"
  );
  assert.equal(
    guessCategory(
      "mystery powder",
      [{ name: "mystery powder", category: "Other" }],
      VALID_CATEGORIES
    ),
    null
  );
});

test("normalization handles plurals, hyphens, and diacritics", () => {
  const coldStartCases: Array<[name: string, expected: string]> = [
    ["peas", "Veggies"],
    ["ribs", "Meat"],
    ["mixed-berries", "Fruits"],
    ["skinless-chicken breasts", "Meat"],
    ["ice-cream", "Frozen"],
    ["jalapeño", "Veggies"],
  ];

  for (const [name, expected] of coldStartCases) {
    assert.equal(
      guessCategory(name, [], VALID_CATEGORIES),
      expected,
      `expected normalization to classify ${name}`
    );
  }

  assert.equal(
    guessCategory(
      "creme fraiche",
      [{ name: "Crème fraîche", category: "Dairy" }],
      VALID_CATEGORIES
    ),
    "Dairy",
    "accented and unaccented history names should match"
  );
});
