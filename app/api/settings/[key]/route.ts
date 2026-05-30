import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { getSettingRepo, putSettingRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";

// Allowlist — guards against arbitrary blobs getting persisted. Add keys
// here when introducing new shared monthly state.
const ALLOWED_KEYS = new Set([
  "recurring_fixed",
  "recurring_variable",
  "rent_alloc",
]);

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type Ctx = { params: Promise<{ key: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { key } = await params;
    if (!ALLOWED_KEYS.has(key)) return err(`unknown setting key: ${key}`, 400);
    await ensureTables();
    const value = await getSettingRepo(key);
    return NextResponse.json({ ok: true, value });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const { key } = await params;
    if (!ALLOWED_KEYS.has(key)) return err(`unknown setting key: ${key}`, 400);
    await ensureTables();
    const body = (await req.json().catch(() => null)) as { value?: unknown } | null;
    if (!body || !("value" in body)) {
      return err("request body must be { value: ... }", 400);
    }
    await putSettingRepo(key, body.value);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
