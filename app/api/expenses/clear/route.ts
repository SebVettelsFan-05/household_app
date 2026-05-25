import { after, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { clearExpensesRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";
import { deleteReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await ensureTables();
    const { expenses, removedReceiptFileIds } = await clearExpensesRepo();
    for (const id of removedReceiptFileIds) {
      after(() => deleteReceipt(id));
    }
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, expenses });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
