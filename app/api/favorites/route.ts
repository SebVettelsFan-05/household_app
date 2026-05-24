import { after, NextRequest, NextResponse } from "next/server";
import { addFavoriteRepo, listFavoritesRepo } from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET() {
  try {
    const favorites = await listFavoritesRepo();
    return NextResponse.json({ ok: true, favorites });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

type AddBody = {
  name?: string;
  link?: string;
  description?: string;
  ingredients?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as AddBody;
    const favorites = await addFavoriteRepo({
      name: body.name ?? "",
      link: body.link,
      description: body.description,
      ingredients: body.ingredients,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, favorites });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
