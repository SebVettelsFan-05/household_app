import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import { deleteFavoriteRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    await ensureTables();
    const { id } = await ctx.params;
    const favorites = await deleteFavoriteRepo(id);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, favorites });
  } catch (e) {
    return apiError(e);
  }
}
