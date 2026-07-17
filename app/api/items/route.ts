import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import {
  addItemRepo,
  deleteItemRepo,
  listItemsRepo,
  updateItemRepo,
} from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET() {
  try {
    await ensureTables();
    const items = await listItemsRepo();
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

type ItemBody = {
  name?: string;
  quantity?: number | string;
  expiry?: string;
  category?: string;
  categoryReviewed?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as ItemBody;
    const res = await addItemRepo({
      name: body.name ?? "",
      quantity: Number(body.quantity),
      expiry: body.expiry,
      category: body.category,
      categoryReviewed: body.categoryReviewed === true,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as ItemBody & { id?: string };
    const items = await updateItemRepo({
      id: body.id ?? "",
      name: body.name ?? "",
      quantity: Number(body.quantity),
      expiry: body.expiry,
      category: body.category,
      categoryReviewed: body.categoryReviewed,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const items = await deleteItemRepo(id);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
