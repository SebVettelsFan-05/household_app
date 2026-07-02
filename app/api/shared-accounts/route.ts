import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import {
  addSharedAccountRepo,
  deleteSharedAccountRepo,
  listSharedAccountsRepo,
  updateSharedAccountRepo,
} from "@/lib/repo";

export const dynamic = "force-dynamic";

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET() {
  try {
    await ensureTables();
    const accounts = await listSharedAccountsRepo();
    return NextResponse.json({ ok: true, accounts });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

type AccountBody = {
  id?: string;
  name?: string;
  fields?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as AccountBody;
    const res = await addSharedAccountRepo({
      name: body.name ?? "",
      fields: body.fields,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as AccountBody;
    const accounts = await updateSharedAccountRepo({
      id: body.id ?? "",
      name: body.name,
      fields: body.fields,
    });
    return NextResponse.json({ ok: true, accounts });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const accounts = await deleteSharedAccountRepo(id);
    return NextResponse.json({ ok: true, accounts });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
