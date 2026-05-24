import { after, NextRequest, NextResponse } from "next/server";
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
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ItemBody;
    const res = await addItemRepo({
      name: body.name ?? "",
      quantity: Number(body.quantity),
      expiry: body.expiry,
      category: body.category,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ItemBody & { id?: string };
    const items = await updateItemRepo({
      id: body.id ?? "",
      name: body.name ?? "",
      quantity: Number(body.quantity),
      expiry: body.expiry,
      category: body.category,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const items = await deleteItemRepo(id);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
