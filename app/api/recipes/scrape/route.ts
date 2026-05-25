import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import {
  listCategoriesRepo,
  listFavoritesRepo,
  listGroceryRepo,
  listItemsRepo,
  listRecipesRepo,
} from "@/lib/repo";
import { guessCategoryOrFallback } from "@/lib/guessCategory";
import { parseRecipeIngredient } from "@/lib/parseIngredient";
import { RecipeScrapeError, scrapeRecipe } from "@/lib/recipeScraper";
import type { RecipeIngredient } from "@/lib/types";

export const dynamic = "force-dynamic";
// Outgoing fetch + HTML parse can take a few seconds — give it room.
export const maxDuration = 15;

// Tiny in-process cache so repeated tries (or a household member opening the
// same link twice in a few minutes) don't re-hit the recipe site. Per-instance
// only — fine for our scale.
//
// The version prefix is bumped whenever the ingredient parser changes, so the
// cache stops handing back results that were normalized under the old rules.
type CacheEntry = {
  expiresAt: number;
  result: ScrapeResponse;
};
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const PARSER_VERSION = "v2";
const cacheKey = (url: string) => `${PARSER_VERSION}:${url}`;

// Same-instance rate cap. Generous because this is a household app, not a
// public scraper — the cap is just a safety net against accidental loops.
const RATE = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const window = (RATE.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (window.length >= RATE_MAX) return true;
  window.push(now);
  RATE.set(key, window);
  return false;
}

type ScrapeResponse = {
  ok: true;
  name: string;
  description: string;
  ingredients: RecipeIngredient[];
  // True when one or more rows had a unit we couldn't precisely convert
  // (volumes, mostly) — the UI surfaces this so the user double-checks.
  hasApproximate: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { url?: string };
    const url = String(body.url ?? "").trim();
    if (!url) {
      return NextResponse.json(
        { ok: false, error: "Missing url" },
        { status: 400 }
      );
    }

    // Use forwarded-for / x-real-ip if present, otherwise lump everything
    // together. We're not adversarial here.
    const rateKey =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "default";
    if (rateLimited(rateKey)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Too many fetches — wait a minute and try again.",
        },
        { status: 429 }
      );
    }

    const cacheId = cacheKey(url);
    const cached = CACHE.get(cacheId);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.result);
    }

    // Pull HTML + parse JSON-LD.
    let scraped;
    try {
      scraped = await scrapeRecipe(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: msg },
        { status: err instanceof RecipeScrapeError ? 422 : 500 }
      );
    }

    await ensureTables();

    // Build a category-guess history from everything the household has ever
    // tagged. Recipe ingredients (saved + favorites) carry the most signal
    // since they're labeled by the user, so we put them first.
    const [items, grocery, recipes, favorites, categoryDefs] =
      await Promise.all([
        listItemsRepo(),
        listGroceryRepo(),
        listRecipesRepo(),
        listFavoritesRepo(),
        listCategoriesRepo(),
      ]);
    const history: Array<{ name: string; category: string }> = [];
    for (const r of recipes) {
      for (const ing of r.ingredients) {
        history.push({ name: ing.name, category: ing.category });
      }
    }
    for (const f of favorites) {
      for (const ing of f.ingredients) {
        history.push({ name: ing.name, category: ing.category });
      }
    }
    for (const it of items) history.push({ name: it.name, category: it.category });
    for (const g of grocery) history.push({ name: g.name, category: g.category });
    const validCategories = categoryDefs.map((c) => c.name);

    let hasApproximate = false;
    const ingredients: RecipeIngredient[] = scraped.ingredients
      .map((raw) => {
        const parsed = parseRecipeIngredient(raw);
        if (!parsed.name) return null;
        if (parsed.approximate) hasApproximate = true;
        const category = guessCategoryOrFallback(
          parsed.name,
          history,
          validCategories
        );
        return {
          name: parsed.name,
          // 0 grams is a "fill me in" signal — UI shows it clearly so the
          // user knows the conversion wasn't possible (no unit, weird unit,
          // or count-based like "1 onion").
          quantity: parsed.quantity,
          category,
        };
      })
      .filter((x): x is RecipeIngredient => x !== null);

    const result: ScrapeResponse = {
      ok: true,
      name: scraped.name ?? "",
      description: scraped.description ?? "",
      ingredients,
      hasApproximate,
    };
    CACHE.set(cacheId, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
