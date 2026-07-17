import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import {
  listGroceryRepo,
  listItemsRepo,
  listCategoriesRepo,
} from "@/lib/repo";
import {
  guessCategoryFromExactHistory,
  guessCategoryOrFallback,
  storedCategoryWeight,
} from "@/lib/guessCategory";
import { lookupBarcode } from "@/lib/openFoodFacts";

export const dynamic = "force-dynamic";
export const maxDuration = 12;

export async function GET(req: NextRequest) {
  try {
    const barcode = req.nextUrl.searchParams.get("barcode") ?? "";
    if (!barcode) {
      return NextResponse.json(
        { ok: false, error: "Missing barcode" },
        { status: 400 }
      );
    }

    const product = await lookupBarcode(barcode);
    if (!product) {
      return NextResponse.json({ ok: true, product: null });
    }

    await ensureTables();
    const [items, grocery, categoryDefs] = await Promise.all([
      listItemsRepo(),
      listGroceryRepo(),
      listCategoriesRepo(),
    ]);

    // Run OFF's categories_tags through the same guesser used by the manual
    // add forms, so a hit on "yogurts" maps to whatever category the
    // household calls dairy (case-insensitively, with synonyms).
    const history = [
      ...items.map((i) => ({
        name: i.name,
        category: i.category,
        weight: storedCategoryWeight(i.categoryReviewed),
      })),
      ...grocery.map((g) => ({
        name: g.name,
        category: g.category,
        weight: storedCategoryWeight(g.categoryReviewed),
      })),
    ];
    const validCategories = categoryDefs.map((c) => c.name);
    // First let an exact household product name win. If it is new, append
    // Open Food Facts' taxonomy tags so the same shared phrase rules can use
    // richer signals such as dairy/frozen without polluting exact matching.
    const displayName = [product.brand, product.name]
      .filter(Boolean)
      .join(" ")
      .trim();
    const guessed =
      guessCategoryFromExactHistory(
        displayName,
        history,
        validCategories
      ) ??
      guessCategoryFromExactHistory(
        product.name,
        history,
        validCategories
      ) ??
      guessCategoryOrFallback(
        `${product.categoryHint} ${displayName}`.trim(),
        history,
        validCategories
      );

    return NextResponse.json({
      ok: true,
      product: {
        name: product.name,
        brand: product.brand,
        quantityGrams: product.quantityGrams,
        category: guessed,
        barcode: product.barcode,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
