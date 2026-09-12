import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import {
  addGroceryRepo,
  deleteGroceryRepo,
  listGroceryRepo,
  updateGroceryRepo,
} from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";
import type { GroceryPool } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTables();
    const grocery = await listGroceryRepo();
    return NextResponse.json({ ok: true, grocery });
  } catch (e) {
    return apiError(e);
  }
}

type AddBody = {
  name?: string;
  quantity?: number | string;
  category?: string;
  categoryReviewed?: boolean;
  store?: string;
  addedBy?: string;
  pool?: GroceryPool;
};

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as AddBody;
    const grocery = await addGroceryRepo({
      name: body.name ?? "",
      quantity: Number(body.quantity),
      category: body.category,
      categoryReviewed: body.categoryReviewed === true,
      store: body.store,
      addedBy: body.addedBy ?? "",
      pool: body.pool,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, grocery });
  } catch (e) {
    return apiError(e);
  }
}

type PatchBody = Partial<AddBody> & { id?: string; done?: boolean };

export async function PATCH(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as PatchBody;
    const grocery = await updateGroceryRepo({
      id: body.id ?? "",
      name: body.name,
      quantity: body.quantity !== undefined ? Number(body.quantity) : undefined,
      category: body.category,
      categoryReviewed: body.categoryReviewed,
      store: body.store,
      addedBy: body.addedBy,
      pool: body.pool,
      done: body.done,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, grocery });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const grocery = await deleteGroceryRepo(id);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, grocery });
  } catch (e) {
    return apiError(e);
  }
}
