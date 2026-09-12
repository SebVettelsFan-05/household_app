import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import { categoryUsageRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * How much a category is still used, so the manage-categories modal can say
 * what a delete will move before the user confirms it. Read-only; the same
 * plan runs again inside DELETE, which returns the counts it actually applied.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureTables();
    const name = req.nextUrl.searchParams.get("name") ?? "";
    const usage = await categoryUsageRepo(name);
    return NextResponse.json({ ok: true, usage });
  } catch (e) {
    return apiError(e);
  }
}
