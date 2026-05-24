import { after, NextRequest, NextResponse } from "next/server";
import { addRecipeRepo, listRecipesRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET() {
  try {
    const recipes = await listRecipesRepo();
    return NextResponse.json({ ok: true, recipes });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

type AddBody = {
  weekStart?: string;
  day?: number;
  assignedTo?: string;
  name?: string;
  link?: string;
  description?: string;
  ingredients?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as AddBody;
    const recipes = await addRecipeRepo({
      weekStart: body.weekStart ?? "",
      day: typeof body.day === "number" ? body.day : -1,
      assignedTo: body.assignedTo ?? "",
      name: body.name ?? "",
      link: body.link,
      description: body.description,
      ingredients: body.ingredients,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, recipes });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
