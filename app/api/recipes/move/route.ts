import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import { moveRecipeRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

type MoveBody = {
  id?: string;
  weekStart?: string;
  day?: number;
};

/**
 * Drops a recipe (or a "no meal" marker) on another day, swapping with any
 * row already there. `undo` comes back as the slot the row left, so the
 * client can reverse the whole thing by posting it straight back here.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as MoveBody;
    const { recipes, undo } = await moveRecipeRepo(body.id ?? "", {
      weekStart: body.weekStart ?? "",
      day: typeof body.day === "number" ? body.day : -1,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, recipes, undo });
  } catch (e) {
    return apiError(e);
  }
}
