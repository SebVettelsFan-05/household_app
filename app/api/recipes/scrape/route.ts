import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { loadCategoryContext } from "@/lib/categoryHistory";
import { guessCategoryOrFallback } from "@/lib/guessCategory";
import {
  parseRecipeIngredient,
  type ParsedIngredient,
} from "@/lib/parseIngredient";
import {
  RecipeScrapeError,
  scrapeRecipe,
  type RecipeSource,
} from "@/lib/recipeScraper";
import type { RecipeIngredient } from "@/lib/types";

export const dynamic = "force-dynamic";
// The layered fetch (direct → bot UA → Wayback) can legitimately take tens
// of seconds on a hard-blocked site — give it room to finish.
export const maxDuration = 60;

// How long scrapeRecipe may spend across all its fetch layers. Kept under
// maxDuration so parsing/categorization still fits.
const SCRAPE_BUDGET_MS = 40_000;

// Tiny in-process cache so repeated tries (or a household member opening the
// same link twice in a few minutes) don't re-hit the recipe site. The cache
// intentionally excludes categories because they depend on mutable household
// history and must be recomputed on every request. Per-instance
// only — fine for our scale.
//
// The version prefix is bumped whenever the ingredient parser changes, so the
// cache stops handing back results that were normalized under the old rules.
type ParsedScrape = {
  name: string;
  description: string;
  ingredients: ParsedIngredient[];
  hasApproximate: boolean;
  source?: RecipeSource;
};
type CacheEntry = {
  expiresAt: number;
  parsed: ParsedScrape;
};
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const PARSER_VERSION = "v4";
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

/**
 * Canonical form of the pasted URL: fragment dropped, well-known tracking
 * params removed. Keeps the cache warm across "same link, different share
 * button" pastes from different household members.
 */
function normalizeRecipeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = "";
  const drop: string[] = [];
  for (const key of u.searchParams.keys()) {
    if (/^utm_/i.test(key) || /^(fbclid|gclid|mc_cid|mc_eid|igshid)$/i.test(key)) {
      drop.push(key);
    }
  }
  for (const key of drop) u.searchParams.delete(key);
  return u.toString();
}

type ScrapeResponse = {
  ok: true;
  name: string;
  description: string;
  ingredients: RecipeIngredient[];
  // True when one or more rows had a unit we couldn't precisely convert
  // (volumes, mostly) — the UI surfaces this so the user double-checks.
  hasApproximate: boolean;
  // Which extraction strategy produced the data (debugging/transparency).
  source?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { url?: string };
    const rawUrl = String(body.url ?? "").trim();
    if (!rawUrl) {
      return NextResponse.json(
        { ok: false, error: "Missing url" },
        { status: 400 }
      );
    }
    const url = normalizeRecipeUrl(rawUrl);
    if (!url) {
      return NextResponse.json(
        { ok: false, error: "That doesn't look like a valid http(s) URL." },
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
    let parsedScrape: ParsedScrape;
    if (cached && cached.expiresAt > Date.now()) {
      parsedScrape = cached.parsed;
    } else {
      // Pull HTML + extract only on a cache miss. Categorization happens
      // below, after current household history has been loaded.
      let scraped;
      try {
        scraped = await scrapeRecipe(url, { totalBudgetMs: SCRAPE_BUDGET_MS });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          { ok: false, error: msg },
          { status: err instanceof RecipeScrapeError ? 422 : 500 }
        );
      }

      const parsedIngredients = scraped.ingredients
        .map((raw) => parseRecipeIngredient(raw))
        // Drops section headers ("For the sauce:") too — they parse to "".
        .filter((ingredient) => Boolean(ingredient.name));
      parsedScrape = {
        name: scraped.name ?? "",
        description: scraped.description ?? "",
        ingredients: parsedIngredients,
        hasApproximate: parsedIngredients.some(
          (ingredient) => ingredient.approximate
        ),
        source: scraped.source,
      };
      CACHE.set(cacheId, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        parsed: parsedScrape,
      });
    }

    await ensureTables();

    // Deterministic weighted history — shared with the paste-ingredients
    // route so both paths categorize identically.
    const { history, validCategories } = await loadCategoryContext();

    const ingredients: RecipeIngredient[] = parsedScrape.ingredients.map(
      (parsed) => {
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
      }
    );

    const result: ScrapeResponse = {
      ok: true,
      name: parsedScrape.name,
      description: parsedScrape.description,
      ingredients,
      hasApproximate: parsedScrape.hasApproximate,
      source: parsedScrape.source,
    };
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
