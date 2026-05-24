import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import {
  addGroceryRepo,
  deleteGroceryRepo,
  listGroceryRepo,
  updateGroceryRepo,
} from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET() {
  try {
    await ensureTables();
    const grocery = await listGroceryRepo();
    return NextResponse.json({ ok: true, grocery });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

type AddBody = {
  name?: string;
  quantity?: number | string;
  category?: string;
  store?: string;
  addedBy?: string;
};

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as AddBody;
    const grocery = await addGroceryRepo({
      name: body.name ?? "",
      quantity: Number(body.quantity),
      category: body.category,
      store: body.store,
      addedBy: body.addedBy ?? "",
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, grocery });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
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
      store: body.store,
      addedBy: body.addedBy,
      done: body.done,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, grocery });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
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
    return err(e instanceof Error ? e.message : String(e));
  }
}
