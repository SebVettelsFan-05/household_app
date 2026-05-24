import { after, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { clearExpensesRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await ensureTables();
    const expenses = await clearExpensesRepo();
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, expenses });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
