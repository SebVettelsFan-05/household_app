import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import {
  addCategoryRepo,
  deleteCategoryRepo,
  listCategoriesRepo,
  updateCategoryColorRepo,
} from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTables();
    const categories = await listCategoriesRepo();
    return NextResponse.json({ ok: true, categories });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      color?: string | null;
    };
    const res = await addCategoryRepo(body.name ?? "", body.color ?? null);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      color?: string | null;
    };
    const categories = await updateCategoryColorRepo(
      body.name ?? "",
      body.color ?? null
    );
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, categories });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables();
    const name = req.nextUrl.searchParams.get("name") ?? "";
    const res = await deleteCategoryRepo(name);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
