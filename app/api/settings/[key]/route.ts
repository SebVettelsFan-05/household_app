import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { getSettingRepo, putSettingRepo } from "@/lib/repo";
import { MEAL_GROUP_KEY, isBuyer } from "@/lib/types";

export const dynamic = "force-dynamic";

// Allowlist — guards against arbitrary blobs getting persisted. Add keys
// here when introducing new shared monthly state.
const ALLOWED_KEYS = new Set([
  "recurring_fixed",
  "recurring_variable",
  "rent_alloc",
  MEAL_GROUP_KEY,
]);

/**
 * The meal group is read back by the allocation validator, so it is stored
 * in a fixed shape: { members: string[] } with only real household members.
 */
function sanitizeMealGroup(value: unknown): { members: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("meal_group must be an object like { members: [...] }");
  }
  const raw = (value as { members?: unknown }).members;
  const members = Array.isArray(raw)
    ? raw.map((m) => String(m ?? "").trim()).filter(isBuyer)
    : [];
  return { members: [...new Set(members)] };
}

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
    if (key === MEAL_GROUP_KEY) {
      let value: { members: string[] };
      try {
        value = sanitizeMealGroup(body.value);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e), 400);
      }
      await putSettingRepo(key, value);
      return NextResponse.json({ ok: true });
    }
    await putSettingRepo(key, body.value);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
