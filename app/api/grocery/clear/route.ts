import { after, NextResponse } from "next/server";
import { clearGroceryRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
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
