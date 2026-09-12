import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import {
  addSharedAccountRepo,
  deleteSharedAccountRepo,
  listSharedAccountsRepo,
  updateSharedAccountRepo,
} from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTables();
    const accounts = await listSharedAccountsRepo();
    return NextResponse.json({ ok: true, accounts });
  } catch (e) {
    return apiError(e);
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
    return apiError(e);
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
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const accounts = await deleteSharedAccountRepo(id);
    return NextResponse.json({ ok: true, accounts });
  } catch (e) {
    return apiError(e);
  }
}
