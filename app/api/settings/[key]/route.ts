import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import { getSettingRepo, putSettingRepo } from "@/lib/repo";
import {
  isAllowedSettingKey,
  validateSettingValue,
} from "@/lib/settingsShape";

export const dynamic = "force-dynamic";

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type Ctx = { params: Promise<{ key: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { key } = await params;
    if (!isAllowedSettingKey(key)) {
      return err(`unknown setting key: ${key}`, 400);
    }
    await ensureTables();
    const value = await getSettingRepo(key);
    return NextResponse.json({ ok: true, value });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const { key } = await params;
    if (!isAllowedSettingKey(key)) {
      return err(`unknown setting key: ${key}`, 400);
    }
    await ensureTables();
    const body = (await req.json().catch(() => null)) as { value?: unknown } | null;
    if (!body || !("value" in body)) {
      return err("request body must be { value: ... }", 400);
    }
    // Every allowed key has a known shape, and only that shape is stored:
    // one junk write here breaks hydration for every housemate.
    await putSettingRepo(key, validateSettingValue(key, body.value));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
