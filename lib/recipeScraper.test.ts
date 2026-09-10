import assert from "node:assert/strict";
import test from "node:test";

import { extractRecipeFromHtml, parseServings } from "./recipeScraper";

const page = (body: string) =>
  `<!doctype html><html><head><title>Fallback Title - Some Site</title></head><body>${body}</body></html>`;

test("plain JSON-LD recipe extracts", () => {
  const html = page(`
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Recipe","name":"Dragon Noodles",
       "description":"Spicy and fast.",
       "recipeIngredient":["4 oz lo mein noodles","2 Tbsp butter"]}
    </script>`);
  const r = extractRecipeFromHtml(html);
  assert.ok(r);
  assert.equal(r.name, "Dragon Noodles");
  assert.equal(r.description, "Spicy and fast.");
  assert.deepEqual(r.ingredients, ["4 oz lo mein noodles", "2 Tbsp butter"]);
  assert.equal(r.source, "json-ld");
});

test("JSON-LD inside @graph and with array @type extracts", () => {
  const html = page(`
    <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","name":"ignore me"},
        {"@type":["Recipe","NewsArticle"],"name":"Butter Chicken",
         "recipeIngredient":["1 tbsp garam masala"]}
      ]}
    </script>`);
  const r = extractRecipeFromHtml(html);
  assert.equal(r?.name, "Butter Chicken");
  assert.deepEqual(r?.ingredients, ["1 tbsp garam masala"]);
});

test("JSON-LD nested under an unfamiliar key still extracts", () => {
  // Some sites tuck the Recipe under mainEntity or a custom wrapper — the
  // walker must visit every value, not just @graph.
  const html = page(`
    <script type="application/ld+json">
      {"@type":"WebPage","mainEntity":{"data":
        {"@type":"Recipe","name":"Nested","recipeIngredient":["1 egg"]}}}
    </script>`);
  assert.deepEqual(extractRecipeFromHtml(html)?.ingredients, ["1 egg"]);
});

test("JSON-LD with literal control characters inside strings recovers", () => {
  const html = page(`
    <script type="application/ld+json">
      {"@type":"Recipe","name":"Broken\n\tNewlines","recipeIngredient":["2 cups rice"]}
    </script>`);
  const r = extractRecipeFromHtml(html);
  assert.deepEqual(r?.ingredients, ["2 cups rice"]);
});

test("JSON-LD with trailing commas recovers", () => {
  const html = page(`
    <script type="application/ld+json">
      {"@type":"Recipe","name":"Trailing","recipeIngredient":["1 onion",],}
    </script>`);
  assert.deepEqual(extractRecipeFromHtml(html)?.ingredients, ["1 onion"]);
});

test("entity-encoded JSON-LD block recovers", () => {
  const html = page(`
    <script type="application/ld+json">
      {&quot;@type&quot;:&quot;Recipe&quot;,&quot;name&quot;:&quot;Encoded&quot;,&quot;recipeIngredient&quot;:[&quot;3 carrots&quot;]}
    </script>`);
  assert.deepEqual(extractRecipeFromHtml(html)?.ingredients, ["3 carrots"]);
});

test("CDATA-wrapped JSON-LD recovers", () => {
  const html = page(`
    <script type="application/ld+json">/*<![CDATA[*/
      {"@type":"Recipe","name":"Wrapped","recipeIngredient":["1 lime"]}
    /*]]>*/</script>`);
  assert.deepEqual(extractRecipeFromHtml(html)?.ingredients, ["1 lime"]);
});

test("legacy singular ingredients field and HTML in strings are handled", () => {
  const html = page(`
    <script type="application/ld+json">
      {"@type":"Recipe","name":"Old Schema",
       "ingredients":["2 tbsp <b>olive oil</b>","1 &amp; 1/2 cups flour"]}
    </script>`);
  const r = extractRecipeFromHtml(html);
  assert.deepEqual(r?.ingredients, ["2 tbsp olive oil", "1 & 1/2 cups flour"]);
});

test("microdata itemprop ingredients extract when JSON-LD is absent", () => {
  const html = page(`
    <div itemscope itemtype="https://schema.org/Recipe">
      <ul>
        <li itemprop="recipeIngredient">1 cup <span>quinoa</span></li>
        <li itemprop="recipeIngredient">2 cups vegetable broth</li>
      </ul>
    </div>`);
  const r = extractRecipeFromHtml(html);
  assert.equal(r?.source, "microdata");
  assert.deepEqual(r?.ingredients, ["1 cup quinoa", "2 cups vegetable broth"]);
  // Name falls back to the page title.
  assert.equal(r?.name, "Fallback Title - Some Site");
});

test("embedded __NEXT_DATA__-style JSON extracts", () => {
  const html = page(`
    <script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"recipe":{"name":"App State Curry",
        "recipeIngredient":["1 can coconut milk","2 tbsp curry paste"]}}}}
    </script>`);
  const r = extractRecipeFromHtml(html);
  assert.equal(r?.source, "embedded-json");
  assert.equal(r?.name, "App State Curry");
  assert.deepEqual(r?.ingredients, [
    "1 can coconut milk",
    "2 tbsp curry paste",
  ]);
});

test("embedded assignment-style state extracts", () => {
  const html = page(`
    <script>window.__INITIAL_STATE__ = {"recipe":{"name":"Assigned",
      "recipeIngredient":["4 tortillas"]}};</script>`);
  assert.deepEqual(extractRecipeFromHtml(html)?.ingredients, ["4 tortillas"]);
});

test("WPRM plugin markup extracts when structured data is missing", () => {
  const html = page(`
    <ul class="wprm-recipe-ingredients">
      <li class="wprm-recipe-ingredient" style="list-style:none">
        <span class="wprm-recipe-ingredient-amount">1</span>
        <span class="wprm-recipe-ingredient-unit">lb</span>
        <span class="wprm-recipe-ingredient-name">ground turkey</span>
      </li>
      <li class="wprm-recipe-ingredient">
        <span class="wprm-recipe-ingredient-amount">2</span>
        <span class="wprm-recipe-ingredient-name">eggs</span>
      </li>
    </ul>`);
  const r = extractRecipeFromHtml(html);
  assert.equal(r?.source, "recipe-html");
  assert.deepEqual(r?.ingredients, ["1 lb ground turkey", "2 eggs"]);
});

test("og:title enriches results that lack a name", () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Sheet Pan Gnocchi" />
    </head><body>
    <li itemprop="recipeIngredient">1 lb gnocchi</li>
    <li itemprop="recipeIngredient">2 bell peppers</li>
    </body></html>`;
  const r = extractRecipeFromHtml(html);
  assert.equal(r?.name, "Sheet Pan Gnocchi");
});

test("a page with no recipe data at all returns name-only or null", () => {
  const r = extractRecipeFromHtml(page("<p>Just a blog post.</p>"));
  // Title-only fallback is fine, but it must not invent ingredients.
  if (r) {
    assert.equal(r.ingredients.length, 0);
    assert.equal(r.source, "page-meta");
  }
  assert.equal(extractRecipeFromHtml("<p>no head</p>"), null);
});

test("JSON-LD recipe with no ingredients falls through to other strategies", () => {
  const html = page(`
    <script type="application/ld+json">
      {"@type":"Recipe","name":"Video Only Recipe"}
    </script>
    <li itemprop="recipeIngredient">1 cup lentils</li>
    <li itemprop="recipeIngredient">4 cups water</li>`);
  const r = extractRecipeFromHtml(html);
  assert.equal(r?.source, "microdata");
  assert.deepEqual(r?.ingredients, ["1 cup lentils", "4 cups water"]);
  // The thin JSON-LD block still knew the real recipe name — it should win
  // over the page title.
  assert.equal(r?.name, "Video Only Recipe");
});

test("recipeYield as a string with a unit yields numeric servings", () => {
  const html = page(`
    <script type="application/ld+json">
      {"@type":"Recipe","name":"Pad See Ew","recipeYield":"4 servings",
       "recipeIngredient":["200 g rice noodles","2 eggs"]}
    </script>`);
  assert.equal(extractRecipeFromHtml(html)?.servings, 4);
});

test("recipeYield as a single-element array yields numeric servings", () => {
  const html = page(`
    <script type="application/ld+json">
      {"@type":"Recipe","name":"Congee","recipeYield":["6"],
       "recipeIngredient":["1 cup rice","8 cups stock"]}
    </script>`);
  assert.equal(extractRecipeFromHtml(html)?.servings, 6);
});

test("piece-count yields are not treated as servings", () => {
  assert.equal(parseServings("24 cookies"), undefined);
  assert.equal(parseServings("16 muffins"), undefined);
  assert.equal(parseServings("Serves 16"), 16);
  assert.equal(parseServings("8 pieces"), 8);
  assert.equal(parseServings(["30"]), undefined);
});

test("a missing or implausible recipeYield leaves servings unset", () => {
  const noYield = page(`
    <script type="application/ld+json">
      {"@type":"Recipe","name":"Toast","recipeIngredient":["2 slices bread"]}
    </script>`);
  assert.equal(extractRecipeFromHtml(noYield)?.servings, undefined);

  // "1 batch (makes 240 cookies)" must never become a 240x scale factor.
  const hugeYield = page(`
    <script type="application/ld+json">
      {"@type":"Recipe","name":"Cookies","recipeYield":"240 cookies",
       "recipeIngredient":["500 g flour"]}
    </script>`);
  assert.equal(extractRecipeFromHtml(hugeYield)?.servings, undefined);
});

test("parseServings handles the shapes real sites emit", () => {
  assert.equal(parseServings(4), 4);
  assert.equal(parseServings("Serves 6"), 6);
  assert.equal(parseServings("4-6 servings"), 4);
  assert.equal(parseServings(["4", "4 rolls"]), 4);
  assert.equal(parseServings(["makes a lot", "8 servings"]), 8);
  assert.equal(parseServings("a few"), undefined);
  assert.equal(parseServings(0), undefined);
  assert.equal(parseServings(4.5), undefined);
  assert.equal(parseServings(undefined), undefined);
});

test("microdata recipeYield is picked up too", () => {
  const html = page(`
    <span itemprop="recipeYield">Serves 3</span>
    <li itemprop="recipeIngredient">1 cup lentils</li>
    <li itemprop="recipeIngredient">4 cups water</li>`);
  const r = extractRecipeFromHtml(html);
  assert.equal(r?.source, "microdata");
  assert.equal(r?.servings, 3);
});
