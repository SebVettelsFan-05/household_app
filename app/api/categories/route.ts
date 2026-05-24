import { after, NextRequest, NextResponse } from "next/server";
import {
  addCategoryRepo,
  deleteCategoryRepo,
  listCategoriesRepo,
} from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET() {
  try {
    const categories = await listCategoriesRepo();
    return NextResponse.json({ ok: true, categories });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const res = await addCategoryRepo(body.name ?? "");
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const name = req.nextUrl.searchParams.get("name") ?? "";
    const res = await deleteCategoryRepo(name);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
