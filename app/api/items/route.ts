import { sql } from "drizzle-orm";
import { after, NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
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

// Catches the "you deployed but haven't hit /api/seed yet" case so the page
// renders empty instead of 500-ing.
async function ensureTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      expiry DATE,
      added TIMESTAMP NOT NULL DEFAULT NOW(),
      category TEXT NOT NULL DEFAULT 'Other'
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY
    )
  `);
  await db.execute(sql`
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS color TEXT
  `);
}

export async function GET() {
  try {
    await ensureTables();
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
