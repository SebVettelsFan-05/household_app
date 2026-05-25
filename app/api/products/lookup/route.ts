import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import {
  listGroceryRepo,
  listItemsRepo,
  listCategoriesRepo,
} from "@/lib/repo";
import { guessCategoryOrFallback } from "@/lib/guessCategory";
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
      ...items.map((i) => ({ name: i.name, category: i.category })),
      ...grocery.map((g) => ({ name: g.name, category: g.category })),
    ];
    const validCategories = categoryDefs.map((c) => c.name);
    const guessed = guessCategoryOrFallback(
      // The category hint is the strongest signal, but the product name
      // gives the dictionary something to bite into for items OFF didn't
      // categorize well.
      `${product.categoryHint} ${product.name}`.trim(),
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
