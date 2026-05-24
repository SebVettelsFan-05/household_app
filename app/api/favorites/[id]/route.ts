import { after, NextRequest, NextResponse } from "next/server";
import { deleteFavoriteRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const favorites = await deleteFavoriteRepo(id);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, favorites });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
