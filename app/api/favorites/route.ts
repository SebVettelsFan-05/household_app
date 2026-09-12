import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import { addFavoriteRepo, listFavoritesRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTables();
    const favorites = await listFavoritesRepo();
    return NextResponse.json({ ok: true, favorites });
  } catch (e) {
    return apiError(e);
  }
}

type AddBody = {
  name?: string;
  link?: string;
  description?: string;
  ingredients?: unknown;
  servings?: number;
};

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as AddBody;
    const { favorites, existed } = await addFavoriteRepo({
      name: body.name ?? "",
      link: body.link,
      description: body.description,
      ingredients: body.ingredients,
      servings: body.servings,
    });
    if (!existed) after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, favorites, existed });
  } catch (e) {
    return apiError(e);
  }
}
