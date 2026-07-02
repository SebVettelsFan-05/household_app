import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { getSharedAccountRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await ensureTables();
    const account = await getSharedAccountRepo(id);
    return NextResponse.json({ ok: true, account });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
