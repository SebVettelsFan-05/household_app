import { after, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
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
    return apiError(e);
  }
}
