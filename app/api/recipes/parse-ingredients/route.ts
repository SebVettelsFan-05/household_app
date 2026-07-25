import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { loadCategoryContext } from "@/lib/categoryHistory";
import { guessCategoryOrFallback } from "@/lib/guessCategory";
import { parseRecipeIngredient } from "@/lib/parseIngredient";
import type { RecipeIngredient } from "@/lib/types";

export const dynamic = "force-dynamic";

// Paste-anything fallback for sites the scraper can't reach (hard bot walls,
// paywalls, apps). The user copies the ingredient list off the page and we
// run the exact same parse + categorize pipeline the URL scraper uses.

const MAX_LINES = 120;

type ParseIngredientsResponse = {
  ok: true;
  ingredients: RecipeIngredient[];
  // Lines we deliberately dropped (section headers like "For the sauce:").
  skipped: number;
  hasApproximate: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { text?: string };
    const text = String(body.text ?? "");
    if (!text.trim()) {
      return NextResponse.json(
        { ok: false, error: "Nothing to parse — paste some ingredients first." },
        { status: 400 }
      );
    }

    const lines = text
      .split(/\r?\n/)
      // Strip common copy-paste bullets/checkboxes before parsing.
      .map((line) => line.replace(/^[\s•·▢◻☐✓✔*\-–—]+\s*/, "").trim())
      .filter(Boolean)
      .slice(0, MAX_LINES);
    if (lines.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nothing to parse — paste some ingredients first." },
        { status: 400 }
      );
    }

    const parsed = lines.map((line) => parseRecipeIngredient(line));
    const kept = parsed.filter((p) => Boolean(p.name));
    const skipped = parsed.length - kept.length;

    await ensureTables();
    const { history, validCategories } = await loadCategoryContext();

    const ingredients: RecipeIngredient[] = kept.map((p) => ({
      name: p.name,
      quantity: p.quantity,
      category: guessCategoryOrFallback(p.name, history, validCategories),
    }));

    const result: ParseIngredientsResponse = {
      ok: true,
      ingredients,
      skipped,
      hasApproximate: kept.some((p) => p.approximate),
    };
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
