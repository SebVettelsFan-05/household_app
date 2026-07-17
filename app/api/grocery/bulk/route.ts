import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { bulkAddGroceryRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

type BulkBody = {
  items?: Array<{
    name?: string;
    quantity?: number | string;
    category?: string;
    categoryReviewed?: boolean;
    store?: string;
    addedBy?: string;
  }>;
};

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as BulkBody;
    const items = (body.items || []).map((i) => ({
      name: i.name ?? "",
      quantity: Number(i.quantity),
      category: i.category,
      categoryReviewed: i.categoryReviewed === true,
      store: i.store,
      addedBy: i.addedBy ?? "",
    }));
    const grocery = await bulkAddGroceryRepo(items);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, grocery, added: items.length });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
