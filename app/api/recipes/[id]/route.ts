import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { deleteRecipeRepo, updateRecipeRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type Ctx = { params: Promise<{ id: string }> };

type PatchBody = {
  weekStart?: string;
  day?: number;
  assignedTo?: string;
  name?: string;
  link?: string;
  description?: string;
  ingredients?: unknown;
};

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    await ensureTables();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as PatchBody;
    const recipes = await updateRecipeRepo({ id, ...body });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, recipes });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    await ensureTables();
    const { id } = await ctx.params;
    const recipes = await deleteRecipeRepo(id);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, recipes });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
