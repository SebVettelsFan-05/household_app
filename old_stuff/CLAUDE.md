# My Fridge — Project Context

A personal fridge inventory tracker. Standalone HTML frontend (hosted on GitHub Pages) talks to a Google Apps Script JSON API backed by a Google Sheet. No framework, no build step, no server costs.

## Architecture

```
[Phone/Browser] → index.html (GitHub Pages)
                       ↓ fetch() GET
                  Apps Script Web App (/exec)
                       ↓
                  Google Sheet ("Inventory" tab)
```

The split (static frontend + GAS backend) exists because serving HTML directly from `script.google.com` hits Google's `/u/N/` multi-account routing bug, which is an unresolved Google issue (tracker 72798634). Hosting the frontend on a non-Google domain sidesteps the routing entirely.

## File structure

```
/
├── index.html     # Frontend (vanilla JS, ~600 lines, single file)
├── Code.gs        # Apps Script backend (JSON API)
├── HOSTING.md     # End-user deployment guide
└── CLAUDE.md      # This file
```

Deployment targets:
- `index.html` → GitHub Pages, root of `main` branch, public repo
- `Code.gs` → bound to a Google Sheet via Extensions → Apps Script, deployed as Web App

## Backend (Code.gs)

### Sheet schema
- Tab name: `Inventory`
- Columns (order matters — referenced by index in code): `ID | Name | Quantity (g) | Expiry Date | Added | Category`
- IDs are UUIDs from `Utilities.getUuid()`
- Dates stored as native Date objects, returned to client as `yyyy-MM-dd` strings via `formatDate_`
- `VALID_CATEGORIES = ['Meat', 'Veggies', 'Other']`

### API surface
GET-only with `?action=X` query params. GET-only is intentional — see Constraints below.

| Action | Params | Response |
|---|---|---|
| `list` | – | `{ ok: true, items: [...] }` |
| `add` | `name, quantity, expiry?, category?` | `{ ok: true, items, merged: bool, mergedInto?, addedQty? }` |
| `update` | `id, name, quantity, expiry?, category?` | `{ ok: true, items }` |
| `delete` | `id` | `{ ok: true, items }` |

Errors: `{ ok: false, error: "message" }`. All mutating actions return the full updated `items` list so the client can replace state in one shot.

### Smart merge (add only)
`addItem_` looks for an existing item where `normalizeName_(existing.name) === normalizeName_(new.name)`. Normalization is: lowercase + trim + collapse internal whitespace. On match:
- Quantities sum
- Earlier expiry wins (blank treated as "later than any date")
- Existing category preserved
- Response includes `merged: true`, `mergedInto` (existing display name), `addedQty`

Update bypasses merge logic intentionally — editing implies user is in full control.

### Migration / self-healing
`getSheet_` is idempotent and runs on every call:
1. Creates the `Inventory` sheet if missing
2. Rewrites the header row if it doesn't match `HEADERS` exactly
3. Backfills blank Category cells with `'Other'`

Cheap to run repeatedly; no flag to disable.

## Frontend (index.html)

### Stack & constraints
- Vanilla JS, no framework, no build step
- No localStorage / sessionStorage (the Sheet is the source of truth; no client persistence needed)
- Google Fonts: Fraunces (display, opsz 9–144), DM Sans (body)
- CSS custom properties for all theming
- Single file deploy — keep CSS and JS inline

### Required user config
```js
const API_URL = 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE';
```
`checkConfig()` runs on DOMContentLoaded and shows a setup-needed banner if the placeholder is still there or the URL doesn't start with `https://`. Don't refactor this away — it's the only friendly failure mode for users who skim HOSTING.md.

### Design tokens
```
--bg:           #FAF6EE  (cream)
--surface:      #FFFFFF
--ink:          #1B2820  (deep green-black)
--ink-soft:     #5A6B61
--accent:       #2D4A3E  (forest green — primary CTAs, focus)
--accent-soft:  #DCE7E0
--warn:         #C75B3B  (terracotta — expiring soon)
--danger:       #A8362A  (deep red — delete, expired)
--cat-meat:     #B8543D  (rust)
--cat-veggies:  #6E8E5C  (olive)
--cat-other:    #8B8278  (taupe)
```
Aesthetic: cream + forest, slightly editorial. Fraunces for headings reads as warm/kitchen-y vs corporate. Max-width 640px, mobile-first.

### Feature inventory
- Add form: name (text) + category pills (default Other) + quantity grams (number) + optional expiry (date)
- Item list: name, category-colored tag, added date, expiry status, quantity (auto-converts to kg past 1000g)
- Left border on each item indicates expiry urgency: subtle green (fine), terracotta (≤3 days), deep red (expired)
- Tap item → bottom-sheet modal on mobile, centered modal on desktop ≥520px
- Edit: same fields, plus Delete button (with `confirm()` prompt)
- Filter row: All / Meat / Veggies / Other — affects list, count, and total weight
- Sort cycle button: newest → A–Z → quantity → expiry → back to newest
- Header shows live count + total weight (filtered)
- Toast (auto-dismiss ~2.4s) for: Added, Merge feedback, Saved, Deleted, errors
- Empty states: "Your fridge is empty" (no items at all), "No {category} items" (filtered)

### State (all in-memory)
- `items` — array, replaced on every API response
- `sortMode` — 'newest' | 'name' | 'quantity' | 'expiry'
- `filterCat` — 'all' | 'Meat' | 'Veggies' | 'Other'
- `addCat`, `editCat` — currently selected pill in respective forms
- `editingId` — id of item open in edit modal, null when closed

No reactivity framework; `render()` rebuilds the list innerHTML each time. Item count is small (likely <100), so this is fine.

## Deployment workflow

### Backend changes
1. Edit `Code.gs` in Apps Script editor
2. Save (Cmd/Ctrl + S)
3. Deploy → Manage deployments → pencil/edit icon → Version: **New version** → Deploy
4. URL is preserved — frontend keeps working without changes

### Frontend changes
1. Commit `index.html` to the GitHub repo
2. GitHub Pages redeploys in ~30s
3. Hard-refresh in browser (Cmd/Ctrl + Shift + R) to bust cache

### Local frontend testing
Open `index.html` in a browser directly — `fetch()` to the live Apps Script URL works from `file://` and any localhost.

## Constraints worth knowing

- **CORS**: Apps Script web apps don't handle preflight requests. Stick to GET requests with query params. Don't switch to `POST` with `Content-Type: application/json` without solving preflight (the workaround is `text/plain` body, but GET-only is simpler).
- **URL length**: practical limit ~2–8KB depending on browser. Grocery item names are short; this is fine. Don't stuff large payloads in query strings (e.g., bulk import should chunk or use POST text/plain).
- **Execution time**: Apps Script has a 6-minute wall-clock limit per request. Current operations are tiny; not a concern unless adding heavy aggregation.
- **Concurrent writes**: last-write-wins on the sheet. No optimistic locking. If the app grows to multi-user, this needs revisiting.
- **Deployment access**: must be "Anyone" for unauthenticated fetch. "Anyone with Google account" requires an auth token in requests.
- **Sheet bounds**: every read scans `lastRow` rows. Performance is fine into the thousands but degrades; index-on-update isn't worth implementing yet.

## Design decisions (why things are the way they are)

- **Two-piece architecture**: chose split frontend/backend specifically to dodge the multi-account `/u/N/` Google bug. Originally was a single Apps Script project with `Index.html` served via `HtmlService`.
- **GET-only API**: simpler than fighting CORS preflight; no real downside at this scale.
- **Smart merge on add, not on edit**: weekly add-in flow benefits from dedupe; editing should be user-controlled.
- **Earliest expiry wins on merge**: oldest stock should drive reminders (eat-first principle).
- **Three hardcoded categories**: explicitly requested by user. Don't add more without checking.
- **Default add category = Other**: most catch-all option; encourages explicit selection for Meat/Veggies.
- **Sort default = newest**: the use case is "I just added stuff this week, show me what's there."
- **No localStorage**: Sheet is the single source of truth. Avoids stale-state bugs and cross-device issues.
- **Inline CSS/JS in one file**: keeps GitHub Pages deployment a single-file paste.

## Explicitly ruled out (don't re-suggest unprompted)

- Barcode scanning (user wants manual entry)
- Recipe suggestions
- Sharing / multi-user
- Plural/lemma matching (case-insensitive trim is sufficient)
- Adding more categories beyond Meat/Veggies/Other

## Reasonable extensions

- **"Use" action**: subtract grams from an item rather than full edit. Common workflow (cooking uses 200g of the 500g).
- **PWA manifest + service worker**: real installable app feel, offline read-only support. Apps Script API needs to stay online; offline writes would need a queue.
- **Expiry notifications**: Apps Script can send email on a time-based trigger; push notifications would need an external service.
- **Multiple locations**: fridge / freezer / pantry as a top-level dimension (could be done with a new column).
- **Bulk import**: photo of receipt → LLM endpoint → items. Use POST text/plain to bypass URL length and CORS.
- **CSV export**: trivial — read the Sheet and serve as `text/csv` from a new action.
- **Search box**: client-side filter on `name`. ~5 lines of code.

## Gotchas for future Claude

- The Apps Script `Code.gs` lives only in Google's editor unless `clasp` is set up. Don't assume there's a local copy that matches deployment.
- Items returned from API have date strings (`yyyy-MM-dd`), not Date objects. String comparison works for sorting because of the format.
- `Inventory` sheet name and exact `HEADERS` array are referenced from multiple places. Changing either requires migration logic updates.
- The user's deployment has gone through several iterations (`Fridge Tracker`, `Fridge V1`, `Fridge V2`). Only the latest deployment URL is canonical; old ones should be archived.
- The earlier `Index.html` file inside the Apps Script editor (from the original single-project setup) is obsolete and can be deleted — `doGet` no longer references it.
