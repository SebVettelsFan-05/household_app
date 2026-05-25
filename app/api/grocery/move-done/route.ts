import { after, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { mirrorToSheet } from "@/lib/mirror";
import { moveDoneGroceryToItemsRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await ensureTables();
    const result = await moveDoneGroceryToItemsRepo();
    if (result.moved > 0) {
      after(() => mirrorToSheet());
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
