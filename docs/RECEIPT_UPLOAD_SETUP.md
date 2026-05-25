# Receipt upload — setup

Receipts are stored in Google Drive via the same Google Apps Script (GAS) webhook the app already uses for sheet mirroring. Setting this up requires two things on your side:

1. Pasting two new handlers into your existing GAS script.
2. (Optional but recommended) Creating a dedicated Drive folder for receipts and pinning the GAS script to write into it.

If `GAS_API_URL` is not set in your environment, every `POST /api/expenses` will return a clear error explaining that storage isn't configured. The rest of the app keeps working.

---

## 1. Update the GAS script

Open your existing Apps Script project (the one whose deployment URL is `GAS_API_URL`). In its main `.gs` file, find the `doPost(e)` function and add two new branches plus the two helpers below.

### Add to your existing `doPost`

```js
function doPost(e) {
  const body = JSON.parse(e.postData.contents);

  // --- new branches ---
  if (body.action === 'uploadReceipt') return uploadReceipt_(body);
  if (body.action === 'deleteReceipt') return deleteReceipt_(body);

  // --- your existing branches (mirror, etc.) stay below ---
  // ...
}
```

### Paste these helpers

```js
function uploadReceipt_(body) {
  try {
    if (!body.dataBase64 || !body.filename || !body.mimeType) {
      return jsonOut_({ ok: false, error: 'Missing filename/mimeType/dataBase64' });
    }

    // Optional: dedicated folder. Set the script property RECEIPTS_FOLDER_ID
    // in Project Settings → Script Properties to pin uploads there. Falls
    // back to the script's My Drive root if unset.
    const folderId = PropertiesService.getScriptProperties().getProperty('RECEIPTS_FOLDER_ID');
    const folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();

    const bytes = Utilities.base64Decode(body.dataBase64);
    const blob = Utilities.newBlob(bytes, body.mimeType, body.filename);
    const file = folder.createFile(blob);

    // Anyone-with-link view access so the family can open receipts straight
    // from the app. Comment this out if you want a Drive-only audit trail.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return jsonOut_({
      ok: true,
      id: file.getId(),
      url: file.getUrl(),
    });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}

function deleteReceipt_(body) {
  try {
    if (!body.id) return jsonOut_({ ok: false, error: 'Missing id' });
    DriveApp.getFileById(body.id).setTrashed(true);
    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}

// If you don't already have this helper somewhere, add it once.
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### Redeploy the script

GAS web apps don't pick up code changes automatically. After saving:

1. **Deploy → Manage deployments**.
2. Pick the existing deployment (the one whose URL is your `GAS_API_URL`).
3. **Edit** → **Version: New version** → **Deploy**.
4. The URL stays the same — no env var change needed.

> If you change the deployment URL by accident, update `GAS_API_URL` in your hosting provider (Vercel project settings → Environment Variables) and redeploy the Next.js app so the server picks up the new value.

---

## 2. (Recommended) Dedicate a Drive folder

Putting every receipt in My Drive's root works, but it gets noisy fast. Instead:

1. In Google Drive, **New → New folder**, call it something like `Household receipts`.
2. Open the folder. The URL ends in `/folders/<long ID>`. Copy that ID.
3. Back in Apps Script: **Project Settings (⚙️) → Script Properties → Add script property**.
   - Property: `RECEIPTS_FOLDER_ID`
   - Value: the ID you copied.
4. Save. Future uploads go into that folder.

Existing receipts (if any) stay where they were — only new uploads honor the property.

### Sharing

The script as written sets each file to **anyone with the link can view**. That matches the app's UX (one tap to view the receipt) but means anyone who somehow gets the URL can see it. Drive URLs aren't enumerable, so for a household app this is fine in practice — but if you'd rather restrict it:

- Remove the `file.setSharing(...)` line in `uploadReceipt_`. Then receipts are visible only to whoever the GAS deployment runs as (you), unless you manually share the folder with the rest of the household.

---

## 3. What changed in the app

- **DB schema**: `expenses` table gains three nullable columns — `receipt_url`, `receipt_file_id`, `receipt_mime`. Migration is idempotent; just deploy.
- **API**: `POST /api/expenses` now accepts `multipart/form-data` with a `receipt` file field. JSON-only POSTs are rejected with `A receipt photo or PDF is required`. `PATCH` still accepts JSON (for edits that don't replace the receipt) and also accepts multipart (to replace it). `DELETE` cleans up the Drive file too.
- **UI**:
  - Add-expense form has a "Receipt" picker — tap to take a photo (camera on mobile) or attach a file. Submit is blocked until a file is attached.
  - Edit modal shows a thumbnail of the current receipt and an "Open ↗" link; attaching a new file replaces the old one on save (old file is moved to Drive trash).
  - Expense rows show a small `📎` linking straight to the receipt; rows without one show a "no receipt" pill so you can spot legacy entries and backfill them via the edit modal.
  - Monthly breakdown rows show the same `📎` (or `📎×N` when several expenses merged into a single store/description bucket).
- **Image handling**: images are downscaled client-side to 1600px max edge as JPEG @ 85% before upload. PDFs pass through. Server cap is 4 MB; clear error if the file is bigger.

---

## 4. Test it once

1. `vercel env pull .env.local` (or just confirm `GAS_API_URL` is set locally).
2. `npm run dev`.
3. Open the Expenses tab → Add expense → fill in a row → attach a test image → submit.
4. Server should respond OK; the row should render with `📎` and the link should open the file in Drive.
5. Edit the row → attach a different image → save. The link should now point to the new file; the old one is in Drive Trash.
6. Delete the row → check Drive Trash → the receipt should be there too.

If any step fails, the toast surfaces the error — common ones:

- `Receipt storage is not configured` → `GAS_API_URL` is missing or wrong.
- `Receipt upload failed (HTTP …)` → GAS script error. Open the Apps Script editor → **Executions** for the stack trace.
- `Receipt is too large` → resize didn't trip; check that the file is actually a supported image/PDF.

---

## 5. Backfilling old expenses (optional)

Existing rows (logged before this change) keep working — they show "no receipt" in the row meta. To backfill: tap the row, attach a file in the edit modal, save. Same upload path; no special migration needed.
