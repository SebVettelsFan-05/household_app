import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import {
  addExpenseRepo,
  deleteExpenseRepo,
  listExpensesRepo,
  updateExpenseRepo,
} from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";

export const dynamic = "force-dynamic";

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET() {
  try {
    await ensureTables();
    const expenses = await listExpensesRepo();
    return NextResponse.json({ ok: true, expenses });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

type ExpenseBody = {
  name?: string;
  amountCents?: number | string;
  category?: string;
  store?: string;
  paidBy?: string;
};

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as ExpenseBody;
    const expenses = await addExpenseRepo({
      name: body.name ?? "",
      amountCents: Number(body.amountCents),
      category: body.category,
      store: body.store,
      paidBy: body.paidBy ?? "",
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, expenses });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureTables();
    const body = (await req.json().catch(() => ({}))) as ExpenseBody & {
      id?: string;
    };
    const expenses = await updateExpenseRepo({
      id: body.id ?? "",
      name: body.name,
      amountCents:
        body.amountCents !== undefined ? Number(body.amountCents) : undefined,
      category: body.category,
      store: body.store,
      paidBy: body.paidBy,
    });
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, expenses });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const expenses = await deleteExpenseRepo(id);
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, expenses });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
