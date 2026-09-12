import { NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import { listArchivedRecipesRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTables();
    const recipes = await listArchivedRecipesRepo();
    return NextResponse.json({ ok: true, recipes });
  } catch (e) {
    return apiError(e);
  }
}
