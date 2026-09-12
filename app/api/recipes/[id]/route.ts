import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import { deleteRecipeRepo, updateRecipeRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type PatchBody = {
  weekStart?: string;
  day?: number;
  assignedTo?: string;
  name?: string;
  link?: string;
  description?: string;
  ingredients?: unknown;
  servings?: number;
  portions?: number;
  noMeal?: boolean;
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
    return apiError(e);
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
    return apiError(e);
  }
}
