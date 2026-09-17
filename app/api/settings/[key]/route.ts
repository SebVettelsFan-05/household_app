import { NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import { apiError } from "@/lib/errors";
import { getSettingVersionedRepo, putSettingRepo } from "@/lib/repo";
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
    // `updatedAt` is the version of this row: a client that means to edit
    // what it just read sends it back as `expectedUpdatedAt`. Null when the
    // row doesn't exist yet.
    const { value, updatedAt } = await getSettingVersionedRepo(key);
    return NextResponse.json({ ok: true, value, updatedAt });
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
    const body = (await req.json().catch(() => null)) as
      | { value?: unknown; expectedUpdatedAt?: unknown }
      | null;
    if (!body || !("value" in body)) {
      return err("request body must be { value: ... }", 400);
    }
    // Optional: the version the client read. Present means "only write if
    // nobody else has since", and a mismatch answers 409 rather than
    // erasing the other housemate's edit. Absent keeps last-write-wins.
    let expectedUpdatedAt: string | null | undefined;
    if (body.expectedUpdatedAt !== undefined) {
      if (
        body.expectedUpdatedAt !== null &&
        typeof body.expectedUpdatedAt !== "string"
      ) {
        return err(
          "expectedUpdatedAt must be the timestamp string from GET, or null",
          400
        );
      }
      expectedUpdatedAt = body.expectedUpdatedAt;
    }
    // Every allowed key has a known shape, and only that shape is stored:
    // one junk write here breaks hydration for every housemate.
    const { updatedAt } = await putSettingRepo(
      key,
      validateSettingValue(key, body.value),
      expectedUpdatedAt
    );
    return NextResponse.json({ ok: true, updatedAt });
  } catch (e) {
    return apiError(e);
  }
}
