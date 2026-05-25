/**
 * Open Food Facts (https://world.openfoodfacts.org) is a free public food
 * product database. No API key, no usage cap beyond "be reasonable" — we
 * cache responses and only query when a barcode hits.
 *
 * This module runs server-side: the Next route at /api/products/lookup
 * calls into it, and the client never talks to OFF directly. That gives us
 * one place to normalize the response shape, cache, and avoid leaking the
 * user's IP into OFF's logs.
 */

import { parseRecipeIngredient } from "./parseIngredient";

export type ProductLookup = {
  // The fields we actually fill into the Add form. Anything missing is
  // returned as an empty string / 0 so the client can skip it cleanly.
  name: string;
  brand: string;
  // Grams. 0 means "OFF didn't report a quantity we could parse".
  quantityGrams: number;
  // OFF's categories_tags formatted as plain words (most specific last) for
  // the category guesser to consume — e.g. "dairy yogurt yogurts" → matches
  // "yogurt" → Dairy.
  categoryHint: string;
  // Original OFF identifier. Useful if we ever want to deep-link back.
  barcode: string;
};

const CACHE = new Map<string, { expiresAt: number; result: ProductLookup | null }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7d — product names don't change

// Polite UA. OFF asks open-data users to identify themselves.
const UA =
  "FridgeBot/1.0 (+https://github.com/SebVettelsFan-05/household_app)";

export async function lookupBarcode(
  barcode: string
): Promise<ProductLookup | null> {
  const clean = String(barcode || "").replace(/[^0-9]/g, "");
  if (!clean) return null;

  const cached = CACHE.get(clean);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const url =
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(clean)}.json` +
    `?fields=product_name,product_name_en,brands,quantity,categories_tags`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": UA },
      // OFF can take a sec; cap so the modal doesn't sit forever.
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const body = (await res.json().catch(() => null)) as {
    status?: number;
    product?: {
      product_name?: string;
      product_name_en?: string;
      brands?: string;
      quantity?: string;
      categories_tags?: string[];
    };
  } | null;
  if (!body || body.status !== 1 || !body.product) {
    CACHE.set(clean, { expiresAt: Date.now() + CACHE_TTL_MS, result: null });
    return null;
  }

  const p = body.product;
  const name = (p.product_name_en || p.product_name || "").trim();
  const brand = (p.brands || "").split(",")[0]?.trim() ?? "";

  // OFF's `quantity` is free text like "500 g" or "1.89 L". Reuse the
  // recipe ingredient parser to convert to grams — same unit table, same
  // approximate-volume warnings. We don't care about the parsed name here.
  let quantityGrams = 0;
  if (p.quantity) {
    const parsed = parseRecipeIngredient(`${p.quantity} placeholder`);
    if (parsed.quantity > 0) quantityGrams = parsed.quantity;
  }

  // categories_tags look like ["en:dairies", "en:yogurts", "en:plain-yogurts"]
  // — strip the language prefix and dashes so the category guesser sees
  // plain words it can match against its keyword dictionary.
  const categoryHint = (p.categories_tags || [])
    .map((t) => t.replace(/^[a-z]{2}:/, "").replace(/-/g, " "))
    .join(" ")
    .trim();

  const result: ProductLookup = {
    name,
    brand,
    quantityGrams,
    categoryHint,
    barcode: clean,
  };
  CACHE.set(clean, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}
