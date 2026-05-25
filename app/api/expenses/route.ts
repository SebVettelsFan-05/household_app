import { after, NextRequest, NextResponse } from "next/server";
import { ensureTables } from "@/lib/migrate";
import {
  addExpenseRepo,
  deleteExpenseRepo,
  listExpensesRepo,
  updateExpenseRepo,
} from "@/lib/repo";
import { mirrorToSheet } from "@/lib/mirror";
import {
  deleteReceipt,
  ReceiptStorageError,
  uploadReceipt,
} from "@/lib/receipts";

export const dynamic = "force-dynamic";

// 5 MB ceiling on uploads — Vercel's serverless body limit is 4.5 MB, but
// multipart wrapping eats some of that. The client resizes images to a
// fraction of this, so anything bigger is almost certainly a giant PDF the
// user didn't mean to attach.
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const ALLOWED_RECEIPT_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

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
  amountCents?: number | string;
  store?: string;
  paidBy?: string;
  occurredOn?: string;
  description?: string;
};

type ParsedExpense = ExpenseBody & {
  receipt: { bytes: ArrayBuffer; mimeType: string; filename: string } | null;
};

// Accepts both multipart (with the optional `receipt` file part) and plain
// JSON (no receipt, used by legacy clients and the unit tests). Multipart
// is the new normal — JSON is kept so legacy PATCH calls without a file
// keep working.
async function parseExpenseBody(req: NextRequest): Promise<ParsedExpense> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const body: ExpenseBody = {
      amountCents: form.get("amountCents")?.toString() ?? undefined,
      store: form.get("store")?.toString() ?? undefined,
      paidBy: form.get("paidBy")?.toString() ?? undefined,
      occurredOn: form.get("occurredOn")?.toString() ?? undefined,
      description: form.get("description")?.toString() ?? undefined,
    };
    const file = form.get("receipt");
    if (file && typeof file !== "string" && file.size > 0) {
      if (file.size > MAX_RECEIPT_BYTES) {
        throw new Error(
          `Receipt is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is ${MAX_RECEIPT_BYTES / 1024 / 1024} MB.`
        );
      }
      const mime = file.type || "application/octet-stream";
      if (!ALLOWED_RECEIPT_MIMES.has(mime)) {
        throw new Error(
          `Receipt type "${mime}" not supported. Use JPEG, PNG, WebP, HEIC, or PDF.`
        );
      }
      const bytes = await file.arrayBuffer();
      const filename =
        (file.name && file.name.trim()) || `receipt-${Date.now()}`;
      return { ...body, receipt: { bytes, mimeType: mime, filename } };
    }
    return { ...body, receipt: null };
  }
  const json = (await req.json().catch(() => ({}))) as ExpenseBody;
  return { ...json, receipt: null };
}

export async function POST(req: NextRequest) {
  try {
    await ensureTables();
    const body = await parseExpenseBody(req);

    if (!body.receipt) {
      return err("A receipt photo or PDF is required to log an expense.", 400);
    }

    // Upload to Drive first. If the upload fails we never touch the DB, so
    // the user sees one clean error instead of an orphaned half-saved row.
    let uploaded: { id: string; url: string };
    try {
      uploaded = await uploadReceipt({
        bytes: body.receipt.bytes,
        mimeType: body.receipt.mimeType,
        filename: body.receipt.filename,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(msg, e instanceof ReceiptStorageError ? 502 : 500);
    }

    // DB insert. If this fails after the upload succeeded, clean up the
    // Drive file so we don't leak orphans.
    try {
      const expenses = await addExpenseRepo({
        amountCents: Number(body.amountCents),
        store: body.store,
        paidBy: body.paidBy ?? "",
        occurredOn: body.occurredOn,
        description: body.description,
        receiptUrl: uploaded.url,
        receiptFileId: uploaded.id,
        receiptMime: body.receipt.mimeType,
      });
      after(() => mirrorToSheet());
      return NextResponse.json({ ok: true, expenses });
    } catch (e) {
      after(() => deleteReceipt(uploaded.id));
      return err(e instanceof Error ? e.message : String(e));
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 400);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureTables();
    let parsed: ParsedExpense & { id?: string };
    const contentType = req.headers.get("content-type") || "";
    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      parsed = {
        id: form.get("id")?.toString() ?? "",
        amountCents: form.get("amountCents")?.toString() ?? undefined,
        store: form.get("store")?.toString() ?? undefined,
        paidBy: form.get("paidBy")?.toString() ?? undefined,
        occurredOn: form.get("occurredOn")?.toString() ?? undefined,
        description: form.get("description")?.toString() ?? undefined,
        receipt: null,
      };
      const file = form.get("receipt");
      if (file && typeof file !== "string" && file.size > 0) {
        if (file.size > MAX_RECEIPT_BYTES) {
          return err(
            `Receipt is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is ${MAX_RECEIPT_BYTES / 1024 / 1024} MB.`,
            400
          );
        }
        const mime = file.type || "application/octet-stream";
        if (!ALLOWED_RECEIPT_MIMES.has(mime)) {
          return err(
            `Receipt type "${mime}" not supported. Use JPEG, PNG, WebP, HEIC, or PDF.`,
            400
          );
        }
        parsed.receipt = {
          bytes: await file.arrayBuffer(),
          mimeType: mime,
          filename:
            (file.name && file.name.trim()) || `receipt-${Date.now()}`,
        };
      }
    } else {
      const json = (await req.json().catch(() => ({}))) as ExpenseBody & {
        id?: string;
      };
      parsed = { ...json, receipt: null };
    }

    let oldReceiptIdToDelete: string | null = null;
    let uploadedReceipt: { id: string; url: string } | null = null;
    let receiptMime: string | undefined;

    if (parsed.receipt) {
      try {
        uploadedReceipt = await uploadReceipt({
          bytes: parsed.receipt.bytes,
          mimeType: parsed.receipt.mimeType,
          filename: parsed.receipt.filename,
        });
        receiptMime = parsed.receipt.mimeType;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(msg, e instanceof ReceiptStorageError ? 502 : 500);
      }
      // Look up the existing receipt id so we can delete it after the
      // update commits successfully.
      const existing = (await listExpensesRepo()).find(
        (x) => x.id === parsed.id
      );
      oldReceiptIdToDelete = existing?.receiptFileId || null;
    }

    try {
      const expenses = await updateExpenseRepo({
        id: parsed.id ?? "",
        amountCents:
          parsed.amountCents !== undefined ? Number(parsed.amountCents) : undefined,
        store: parsed.store,
        paidBy: parsed.paidBy,
        occurredOn: parsed.occurredOn,
        description: parsed.description,
        ...(uploadedReceipt
          ? {
              receiptUrl: uploadedReceipt.url,
              receiptFileId: uploadedReceipt.id,
              receiptMime,
            }
          : {}),
      });
      after(() => mirrorToSheet());
      if (oldReceiptIdToDelete) {
        after(() => deleteReceipt(oldReceiptIdToDelete!));
      }
      return NextResponse.json({ ok: true, expenses });
    } catch (e) {
      if (uploadedReceipt) {
        after(() => deleteReceipt(uploadedReceipt!.id));
      }
      return err(e instanceof Error ? e.message : String(e));
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 400);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureTables();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const { expenses, removedReceiptFileId } = await deleteExpenseRepo(id);
    if (removedReceiptFileId) {
      after(() => deleteReceipt(removedReceiptFileId));
    }
    after(() => mirrorToSheet());
    return NextResponse.json({ ok: true, expenses });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
