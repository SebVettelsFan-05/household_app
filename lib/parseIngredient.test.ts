import assert from "node:assert/strict";
import test from "node:test";

import { cleanIngredientName, parseRecipeIngredient } from "./parseIngredient";

test("mass units convert exactly", () => {
  assert.deepEqual(parseRecipeIngredient("500g chicken thighs"), {
    name: "chicken thighs",
    quantity: 500,
    approximate: false,
  });
  assert.equal(parseRecipeIngredient("1 lb ground beef").quantity, 454);
  assert.equal(parseRecipeIngredient("8 oz cream cheese").quantity, 227);
});

test("volume units use ingredient-aware densities", () => {
  // 1.5 cups × 240 mL × 0.53 g/mL ≈ 191 g — not the 360 g water would give.
  assert.equal(parseRecipeIngredient("1 1/2 cups flour").quantity, 191);
  const sugar = parseRecipeIngredient("1 cup sugar");
  assert.equal(sugar.quantity, 204);
  assert.equal(sugar.approximate, true);
  // Liquids stay water-like.
  assert.equal(parseRecipeIngredient("1 cup water").quantity, 240);
  assert.equal(parseRecipeIngredient("1 cup milk").quantity, 247);
});

test("unicode fractions and HTML entities parse", () => {
  assert.equal(parseRecipeIngredient("½ cup sugar").quantity, 102);
  assert.equal(parseRecipeIngredient("&frac12; cup milk").quantity, 124);
  assert.equal(parseRecipeIngredient("¼ tsp cayenne pepper").quantity, 1);
});

test("section headers are flagged and get an empty name", () => {
  for (const header of ["For the sauce:", "FOR THE MARINADE", "Sauce:"]) {
    const parsed = parseRecipeIngredient(header);
    assert.equal(parsed.name, "", `${header} should produce an empty name`);
    assert.equal(parsed.isSectionHeader, true);
  }
});

test("pack sizes multiply out", () => {
  const cans = parseRecipeIngredient("1 (14 oz) can black beans");
  assert.equal(cans.name, "black beans");
  assert.equal(cans.quantity, 397);
  assert.equal(cans.approximate, false);

  const tins = parseRecipeIngredient("2 x 400g tins chopped tomatoes");
  assert.equal(tins.name, "chopped tomatoes");
  assert.equal(tins.quantity, 800);

  const packs = parseRecipeIngredient("2 (8 ounce) packages cream cheese");
  assert.equal(packs.name, "cream cheese");
  assert.equal(packs.quantity, 454);
});

test("gram-equivalent parentheticals sharpen volume estimates", () => {
  // "(12 Tbsp; 170g)" annotates the ¾ cup — the annotated 170 g agrees with
  // the density estimate (~172 g) so the exact value wins.
  const butter = parseRecipeIngredient(
    "3/4 cup (12 Tbsp; 170g) unsalted butter, softened to room temperature"
  );
  assert.equal(butter.name, "butter");
  assert.equal(butter.quantity, 170);
  assert.equal(butter.approximate, false);

  const flour = parseRecipeIngredient("2 cups (240g) flour");
  assert.equal(flour.quantity, 240);
});

test("gram annotations that disagree wildly with the estimate are ignored", () => {
  // "(from 1 (14 oz) can)" describes the source can, not the cup being used.
  const broth = parseRecipeIngredient(
    "1 cup chicken broth (from 1 (14 oz) can)"
  );
  assert.equal(broth.quantity, 240); // density estimate kept
  assert.equal(broth.approximate, true);
});

test("gram annotations rescue counts and unknown units", () => {
  assert.equal(
    parseRecipeIngredient("2 chicken breasts (about 450g)").quantity,
    450
  );
  assert.equal(
    parseRecipeIngredient("1 can black beans (15 oz)").quantity,
    425
  );
});

test("container words between count and pack size still parse", () => {
  // simplyrecipes writes yeast this way.
  const yeast = parseRecipeIngredient(
    "1 package (2 1/4 teaspoons) active dry yeast"
  );
  assert.equal(yeast.name, "active dry yeast");
  assert.equal(yeast.quantity, 11); // 2.25 tsp × 5 mL
});

test("plain counts fall back to typical item weights", () => {
  const eggs = parseRecipeIngredient("3 large eggs");
  assert.equal(eggs.name, "eggs");
  assert.equal(eggs.quantity, 165);
  assert.equal(eggs.approximate, true);

  assert.equal(parseRecipeIngredient("1 large onion, diced").quantity, 150);
  assert.equal(parseRecipeIngredient("2 lemons").quantity, 200);
  // Unknown count items stay 0 — an explicit "fill me in".
  assert.equal(parseRecipeIngredient("2 chicken breasts").quantity, 0);
});

test("special units have sensible weights", () => {
  assert.equal(parseRecipeIngredient("1 stick butter").quantity, 113);
  assert.equal(parseRecipeIngredient("2 cloves garlic, minced").quantity, 10);
  assert.equal(parseRecipeIngredient("2 cloves garlic, minced").name, "garlic");
});

test("quantity ranges take the midpoint and flag approximate", () => {
  const chicken = parseRecipeIngredient("1-2 lbs chicken thighs");
  assert.equal(chicken.quantity, 680);
  assert.equal(chicken.approximate, true);
  assert.equal(
    parseRecipeIngredient("2 to 3 tablespoons soy sauce").quantity,
    43
  );
});

test("trailing serving qualifiers are stripped from names", () => {
  assert.equal(
    parseRecipeIngredient("Salt and pepper to taste").name,
    "Salt and pepper"
  );
  assert.equal(parseRecipeIngredient("olive oil for frying").name, "olive oil");
  assert.equal(
    parseRecipeIngredient("chopped cilantro for garnish").name,
    "chopped cilantro"
  );
});

test("cleanIngredientName strips packaging, quality, and prep noise", () => {
  assert.equal(
    cleanIngredientName("Lean ground beef (85/15)"),
    "ground beef"
  );
  assert.equal(cleanIngredientName("garlic, finely chopped"), "garlic");
  assert.equal(cleanIngredientName("can of diced tomatoes"), "diced tomatoes");
  assert.equal(cleanIngredientName("packed brown sugar"), "brown sugar");
  assert.equal(
    cleanIngredientName("red bell peppers"),
    "bell peppers"
  );
  // Type markers survive.
  assert.equal(cleanIngredientName("red onion"), "red onion");
  assert.equal(cleanIngredientName("ground beef"), "ground beef");
});

test("nested parentheticals leave no residue in names", () => {
  // Seen in the wild on minimalistbaker: double-wrapped footnotes.
  const tofu = parseRecipeIngredient(
    "1 cup extra-firm tofu* ((8 ounces yields ~1 cup))"
  );
  assert.equal(tofu.name, "extra-firm tofu");
  const rice = parseRecipeIngredient(
    "1 cup long- or short-grain brown rice* ((rinsed thoroughly))"
  );
  assert.ok(!rice.name.includes(")"), rice.name);
  assert.ok(!rice.name.includes("*"), rice.name);
});

test("unicode fractions inside pack sizes work", () => {
  // Seen on simplyrecipes: "2 (¼-ounce) packages active dry yeast".
  const yeast = parseRecipeIngredient("2 (¼-ounce) packages active dry yeast");
  assert.equal(yeast.name, "active dry yeast");
  assert.equal(yeast.quantity, 14); // 2 × 0.25 oz ≈ 14 g
  const cans = parseRecipeIngredient("1 (14 1/2 oz) can diced tomatoes");
  assert.equal(cans.quantity, 411);
});

test("worst case still returns a usable row", () => {
  const weird = parseRecipeIngredient("a glug of something mysterious");
  assert.ok(weird.name.length > 0);
  assert.equal(typeof weird.quantity, "number");
});
