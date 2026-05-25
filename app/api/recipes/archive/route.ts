import { NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { listArchivedRecipesRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTables();
    const recipes = await listArchivedRecipesRepo();
    return NextResponse.json({ ok: true, recipes });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
