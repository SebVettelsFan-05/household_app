import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError, ValidationError } from "@/lib/errors";
import { bulkAddGroceryRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";
import type { GroceryPool } from "@/lib/types";

export const dynamic = "force-dynamic";

type BulkBody = {
  items?: Array<{
    name?: string;
    quantity?: number | string;
    category?: string;
    categoryReviewed?: boolean;
    store?: string;
    addedBy?: string;
    pool?: GroceryPool;
  }>;
};

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as BulkBody;
    if (body.items !== undefined && !Array.isArray(body.items)) {
      throw new ValidationError("items must be an array");
    }
    const items = (body.items || []).map((i, index) => {
      // `null` reads as an object, so it slips past a plain truthiness check
      // and only blows up later on a property access.
      if (!i || typeof i !== "object" || Array.isArray(i)) {
        throw new ValidationError(`Ingredient ${index + 1} must be an object`);
      }
      return {
        name: i.name ?? "",
        quantity: Number(i.quantity),
        category: i.category,
        categoryReviewed: i.categoryReviewed === true,
        store: i.store,
        addedBy: i.addedBy ?? "",
        pool: i.pool,
      };
    });
    const grocery = await bulkAddGroceryRepo(items);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, grocery, added: items.length });
  } catch (e) {
    return apiError(e);
  }
}
