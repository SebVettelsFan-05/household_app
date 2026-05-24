import { after, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { clearGroceryRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await ensureTables();
    const grocery = await clearGroceryRepo();
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, grocery });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
