/**
 * Receipt storage helpers.
 *
 * Receipts live in Google Drive. We don't talk to Drive directly — we
 * delegate to the existing Google Apps Script webhook (the same endpoint
 * `lib/mirror.ts` uses for sheet sync). The GAS script has the household's
 * Drive context already, so this avoids setting up a separate service
 * account just for file uploads.
 *
 * The GAS handler accepts two actions:
 *
 *   { action: "uploadReceipt", filename, mimeType, dataBase64 }
 *     → { ok: true, id, url } | { ok: false, error }
 *
 *   { action: "deleteReceipt", id }
 *     → { ok: true } | { ok: false, error }
 *
 * See docs/RECEIPT_UPLOAD_SETUP.md for the GAS code to paste in.
 */

export class ReceiptStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptStorageError";
  }
}

type UploadInput = {
  filename: string;
  mimeType: string;
  // Raw bytes — we base64-encode them on the way out so they fit in a JSON
  // POST body to GAS (multipart isn't a great fit there).
  bytes: ArrayBuffer | Buffer;
};

type UploadResult = { id: string; url: string };

function toBase64(bytes: ArrayBuffer | Buffer): string {
  if (Buffer.isBuffer(bytes)) return bytes.toString("base64");
  return Buffer.from(bytes).toString("base64");
}

export async function uploadReceipt(input: UploadInput): Promise<UploadResult> {
  const url = process.env.GAS_API_URL;
  if (!url) {
    throw new ReceiptStorageError(
      "Receipt storage is not configured. Set GAS_API_URL and deploy the receipts handler — see docs/RECEIPT_UPLOAD_SETUP.md."
    );
  }
  const filename = input.filename.replace(/[\\/:*?"<>|]/g, "_").slice(0, 200);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "follow",
      body: JSON.stringify({
        action: "uploadReceipt",
        filename,
        mimeType: input.mimeType || "application/octet-stream",
        dataBase64: toBase64(input.bytes),
      }),
    });
  } catch (err) {
    throw new ReceiptStorageError(
      "Couldn't reach the receipt storage service: " +
        (err instanceof Error ? err.message : String(err))
    );
  }
  if (!res.ok) {
    throw new ReceiptStorageError(`Receipt upload failed (HTTP ${res.status})`);
  }
  const body = (await res.json().catch(() => null)) as
    | { ok: true; id: string; url: string }
    | { ok: false; error?: string }
    | null;
  if (!body || !("ok" in body) || !body.ok) {
    const msg =
      body && !body.ok && body.error
        ? body.error
        : "Receipt upload failed (unexpected response)";
    throw new ReceiptStorageError(msg);
  }
  if (!body.id || !body.url) {
    throw new ReceiptStorageError(
      "Receipt upload succeeded but the response was missing id/url"
    );
  }
  return { id: body.id, url: body.url };
}

/**
 * Best-effort delete. Doesn't throw on failure — receipts are stored
 * outside our DB, so an orphaned Drive file is recoverable manually but a
 * failed expense-row delete would not be. Logs errors for observability.
 */
export async function deleteReceipt(fileId: string): Promise<void> {
  if (!fileId) return;
  const url = process.env.GAS_API_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "follow",
      body: JSON.stringify({ action: "deleteReceipt", id: fileId }),
    });
  } catch (err) {
    console.error("[receipts] delete failed for", fileId, err);
  }
}
