import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRecipeFromHtml,
  isPrivateAddress,
  parseServings,
  publicUrlBlockReason,
  readCappedText,
} from "./recipeScraper";

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
/* ---------- Outbound address guard (pure, no network) ---------- */

test("loopback, private, link-local and unspecified IPv4 are blocked", () => {
  for (const ip of [
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
  ]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be blocked`);
  }
});

test("carrier-grade NAT, multicast and reserved IPv4 are blocked", () => {
  for (const ip of [
    "100.64.0.1", // 100.64.0.0/10 CGNAT — reaches the ISP's own network
    "100.127.255.255",
    "224.0.0.1", // 224.0.0.0/4 multicast
    "239.255.255.255",
    "240.0.0.1", // 240.0.0.0/4 reserved
    "255.255.255.255", // broadcast
  ]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be blocked`);
  }
});

test("the hosts either side of the CGNAT and multicast ranges still pass", () => {
  for (const ip of ["100.63.255.255", "100.128.0.1", "223.255.255.255"]) {
    assert.equal(isPrivateAddress(ip), false, `${ip} should be allowed`);
  }
});

test("IPv6 multicast is blocked", () => {
  for (const ip of ["ff00::1", "ff02::1", "ff05::1:3", "ffff::1"]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be blocked`);
  }
});

test("6to4 is judged by the IPv4 address it wraps", () => {
  // 2002:<v4>::/16 routes to the embedded address, so 2002:0a00:0001:: is
  // just another spelling of 10.0.0.1.
  assert.equal(isPrivateAddress("2002:0a00:0001::1"), true); // 10.0.0.1
  assert.equal(isPrivateAddress("2002:7f00:0001::1"), true); // 127.0.0.1
  assert.equal(isPrivateAddress("2002:a9fe:a9fe::1"), true); // 169.254.169.254
  assert.equal(isPrivateAddress("2002:c0a8:0101::1"), true); // 192.168.1.1
  assert.equal(isPrivateAddress("2002:0808:0808::1"), false); // 8.8.8.8
});

test("NAT64 is judged by the IPv4 address it wraps", () => {
  assert.equal(isPrivateAddress("64:ff9b::10.0.0.1"), true);
  assert.equal(isPrivateAddress("64:ff9b::127.0.0.1"), true);
  assert.equal(isPrivateAddress("64:ff9b::169.254.169.254"), true);
  assert.equal(isPrivateAddress("64:ff9b::a00:1"), true); // same, in hex
  assert.equal(isPrivateAddress("64:ff9b::8.8.8.8"), false);
});

test("public IPv4 is allowed, including neighbours of private ranges", () => {
  for (const ip of [
    "8.8.8.8",
    "93.184.216.34",
    "9.255.255.255",
    "11.0.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "192.167.255.255",
    "192.169.0.1",
    "169.253.255.255",
  ]) {
    assert.equal(isPrivateAddress(ip), false, `${ip} should be allowed`);
  }
});

test("loopback, link-local and unique-local IPv6 are blocked", () => {
  for (const ip of [
    "::1",
    "::",
    "fe80::1",
    "febf:ffff::1",
    "fc00::1",
    "fd12:3456:789a::1",
  ]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be blocked`);
  }
});

test("public IPv6 is allowed", () => {
  for (const ip of ["2001:4860:4860::8888", "2606:2800:220:1:248:1893:25c8:1946"]) {
    assert.equal(isPrivateAddress(ip), false, `${ip} should be allowed`);
  }
});

test("IPv4 smuggled through an IPv6 literal is judged by the inner address", () => {
  assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateAddress("::ffff:10.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:169.254.169.254"), true);
  assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
});

test("anything that is not a parseable address counts as blocked", () => {
  for (const junk of ["", "not-an-ip", "999.1.1.1", "1.2.3", "::gggg"]) {
    assert.equal(isPrivateAddress(junk), true, `${junk} should be blocked`);
  }
});

test("a normal recipe URL passes the URL guard", () => {
  assert.equal(publicUrlBlockReason("https://example.com/recipes/stew"), null);
  assert.equal(publicUrlBlockReason("http://example.com:80/x"), null);
  assert.equal(publicUrlBlockReason("https://web.archive.org/web/2id_/x"), null);
});

test("the URL guard refuses internal hosts and addresses", () => {
  for (const url of [
    "http://localhost/secret",
    "http://anything.localhost/secret",
    "http://LOCALHOST:80/secret",
    "http://127.0.0.1:4321/secret",
    "http://10.0.0.1/",
    "http://192.168.0.5/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
  ]) {
    assert.ok(publicUrlBlockReason(url), `${url} should be refused`);
  }
});

test("the URL guard refuses non-web schemes and ports", () => {
  assert.ok(publicUrlBlockReason("file:///etc/passwd"));
  assert.ok(publicUrlBlockReason("ftp://example.com/x"));
  assert.ok(publicUrlBlockReason("gopher://example.com/x"));
  assert.ok(publicUrlBlockReason("http://example.com:22/"));
  assert.ok(publicUrlBlockReason("http://example.com:5432/"));
  assert.ok(publicUrlBlockReason("not a url at all"));
});

test("decimal and octal spellings of a loopback address are still refused", () => {
  // WHATWG URL canonicalises these to 127.0.0.1 before the guard sees them.
  assert.ok(publicUrlBlockReason("http://2130706433/"));
  assert.ok(publicUrlBlockReason("http://0177.0.0.1/"));
});

/* ---------- response body cap ---------- */

// A response whose body streams `chunk` forever until the reader gives up.
function endlessResponse(chunk: Uint8Array, headers?: HeadersInit): Response {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cancelled) return;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(body, { headers });
}

test("a body past the cap stops being read instead of buffering forever", async () => {
  const chunk = new Uint8Array(64 * 1024).fill(0x61); // "a"
  const text = await readCappedText(endlessResponse(chunk));
  assert.equal(text.length, 4_000_000);
  assert.equal(text.endsWith("a"), true);
});

test("a body under the cap is returned whole", async () => {
  const res = new Response("<html>hi</html>");
  assert.equal(await readCappedText(res), "<html>hi</html>");
});

test("a character split across two chunks survives the decode", async () => {
  // "é" is two bytes; hand them over one chunk apart.
  const bytes = new TextEncoder().encode("café au lait");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 4));
      controller.enqueue(bytes.subarray(4));
      controller.close();
    },
  });
  assert.equal(await readCappedText(new Response(body)), "café au lait");
});

test("a declared charset is honoured, and a bogus one falls back to UTF-8", async () => {
  const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
  const asLatin1 = new Response(latin1, {
    headers: { "content-type": "text/html; charset=iso-8859-1" },
  });
  assert.equal(await readCappedText(asLatin1), "café");

  const bogus = new Response(new TextEncoder().encode("café"), {
    headers: { "content-type": "text/html; charset=not-a-charset" },
  });
  assert.equal(await readCappedText(bogus), "café");
});
