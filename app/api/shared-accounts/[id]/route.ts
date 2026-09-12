import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import { getSharedAccountRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await ensureTables();
    const account = await getSharedAccountRepo(id);
    return NextResponse.json({ ok: true, account });
  } catch (e) {
    return apiError(e);
  }
}
