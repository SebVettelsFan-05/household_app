import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import {
  addExpenseCategoryRepo,
  deleteExpenseCategoryRepo,
  listExpenseCategoriesRepo,
  updateExpenseCategoryColorRepo,
} from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTables();
    const expenseCategories = await listExpenseCategoriesRepo();
    return NextResponse.json({ ok: true, expenseCategories });
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
    const res = await addExpenseCategoryRepo(body.name ?? "", body.color ?? null);
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
    const expenseCategories = await updateExpenseCategoryColorRepo(
      body.name ?? "",
      body.color ?? null
    );
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, expenseCategories });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables();
    const name = req.nextUrl.searchParams.get("name") ?? "";
    const res = await deleteExpenseCategoryRepo(name);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
