import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import { addRecipeRepo, listRecipesRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTables();
    const recipes = await listRecipesRepo();
    return NextResponse.json({ ok: true, recipes });
  } catch (e) {
    return apiError(e);
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
  servings?: number;
  portions?: number;
  noMeal?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as AddBody;
    const recipes = await addRecipeRepo({
      weekStart: body.weekStart ?? "",
      day: typeof body.day === "number" ? body.day : -1,
      assignedTo: body.assignedTo ?? "",
      name: body.name ?? "",
      link: body.link,
      description: body.description,
      ingredients: body.ingredients,
      servings: body.servings,
      portions: body.portions,
      noMeal: body.noMeal,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, recipes });
  } catch (e) {
    return apiError(e);
  }
}
