"use client";

import {
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import ReceiptLightbox from "@/components/ReceiptLightbox";
import {
  addSharedAccount,
  deleteSharedAccount,
  getSharedAccount,
  updateSharedAccount,
} from "@/lib/client";
import { prepareReceipt } from "@/lib/imageResize";
import type {
  SharedAccount,
  SharedAccountField,
  SharedFieldKind,
} from "@/lib/types";

type Props = {
  accounts: SharedAccount[];
  loading: boolean;
  loadError: string | null;
  onAccountsChange: (next: SharedAccount[]) => void;
  onToast: (msg: string) => void;
};

const MAX_IMAGE_DATA_URL_LENGTH = 1500000;

function makeFieldId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `field_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function defaultLabel(kind: SharedFieldKind): string {
  if (kind === "password") return "Password";
  if (kind === "image") return "Image";
  return "Field";
}

function cloneFields(fields: SharedAccountField[]): SharedAccountField[] {
  return fields.map((f) => ({ ...f }));
}

function fieldSummary(account: SharedAccount): string {
  const labels = account.fields
    .map((f) => f.label.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (labels.length === 0) return "No fields";
  const extra = account.fields.length - labels.length;
  return extra > 0 ? `${labels.join(", ")} +${extra}` : labels.join(", ");
}

function formatUpdated(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error || new Error("File read failed"));
    fr.readAsDataURL(blob);
  });
}

async function fileToImageField(file: File): Promise<{
  value: string;
  filename: string;
  mimeType: string;
}> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file");
  }
  const prepared = await prepareReceipt(file);
  const value = await readBlobAsDataUrl(prepared.blob);
  if (value.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("Image is too large. Choose a smaller photo.");
  }
  return {
    value,
    filename: prepared.filename || file.name || "image",
    mimeType: prepared.blob.type || file.type || "image/jpeg",
  };
}

export default function PasswordsView({
  accounts,
  loading,
  loadError,
  onAccountsChange,
  onToast,
}: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<SharedAccount | null>(
    null
  );
  const [detailLoading, setDetailLoading] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return accounts;
    return accounts.filter((account) => {
      if (account.name.toLowerCase().includes(term)) return true;
      return account.fields.some((field) =>
        field.label.toLowerCase().includes(term)
      );
    });
  }, [accounts, search]);

  const totalFields = useMemo(
    () => accounts.reduce((sum, account) => sum + account.fields.length, 0),
    [accounts]
  );

  async function createEntry() {
    const trimmed = name.trim();
    if (!trimmed) {
      onToast("Error: Place / account name required");
      return;
    }
    setBusy(true);
    try {
      const res = await addSharedAccount({ name: trimmed, fields: [] });
      onAccountsChange(res.accounts);
      setName("");
      setEditingId(res.account.id);
      setEditingAccount(res.account);
      onToast("Entry created");
    } catch (err) {
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function openEntry(id: string) {
    setEditingId(id);
    setEditingAccount(null);
    setDetailLoading(true);
    try {
      const account = await getSharedAccount(id);
      setEditingAccount(account);
    } catch (err) {
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
      setEditingId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeEditor() {
    setEditingId(null);
    setEditingAccount(null);
    setDetailLoading(false);
  }

  function onEnter(e: ReactKeyboardEvent) {
    if (e.key === "Enter") createEntry();
  }

  return (
    <>
      <div className="view-stats">
        <div>
          <strong>{accounts.length}</strong> account
          {accounts.length === 1 ? "" : "s"}
        </div>
        <div>
          <strong>{totalFields}</strong> field
          {totalFields === 1 ? "" : "s"}
        </div>
      </div>

      <section className="add-card">
        <h2>Add password entry</h2>
        <div className="field">
          <label htmlFor="password-place">Place / account</label>
          <input
            id="password-place"
            type="text"
            placeholder="e.g. Bank1, Wi-Fi, Insurance"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onEnter}
          />
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={createEntry}
          disabled={busy}
        >
          {busy ? "Creating..." : "Create entry"}
        </button>
      </section>

      <div className="list-head">
        <h2>Shared Passwords</h2>
      </div>

      <div className="search-row">
        <input
          type="search"
          placeholder="Search places or field labels..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="list-hint">Tap an entry to edit fields</div>

      {loading ? (
        <div className="loading">
          <span className="spinner" />
          Loading...
        </div>
      ) : loadError ? (
        <div className="empty">
          <p>Couldn&apos;t load shared passwords.</p>
          <p style={{ fontSize: 13 }}>{loadError}</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="empty">
          <p>No shared password entries yet.</p>
          <p style={{ fontSize: 13 }}>Create one above to get started.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <p>No matching entries.</p>
        </div>
      ) : (
        <div className="items">
          {filtered.map((account) => (
            <button
              key={account.id}
              type="button"
              className="item password-item"
              onClick={() => openEntry(account.id)}
            >
              <div className="item-main">
                <div className="item-name">{account.name}</div>
                <div className="item-meta">
                  <span>{fieldSummary(account)}</span>
                  {account.updatedAt ? (
                    <>
                      <span className="dot" />
                      <span>Updated {formatUpdated(account.updatedAt)}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="password-row-count">
                {account.fields.length} field
                {account.fields.length === 1 ? "" : "s"}
              </div>
              <div className="item-chev">&rsaquo;</div>
            </button>
          ))}
        </div>
      )}

      {editingId && !editingAccount ? (
        <PasswordLoadingModal onClose={closeEditor} loading={detailLoading} />
      ) : editingAccount ? (
        <SharedAccountModal
          key={editingAccount.id}
          account={editingAccount}
          onClose={closeEditor}
          onAccountsChange={onAccountsChange}
          onToast={onToast}
        />
      ) : null}
    </>
  );
}

function PasswordLoadingModal({
  onClose,
  loading,
}: {
  onClose: () => void;
  loading: boolean;
}) {
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="loading password-detail-loading">
          {loading ? <span className="spinner" /> : null}
          Loading...
        </div>
      </div>
    </div>
  );
}

function SharedAccountModal({
  account,
  onClose,
  onAccountsChange,
  onToast,
}: {
  account: SharedAccount;
  onClose: () => void;
  onAccountsChange: (next: SharedAccount[]) => void;
  onToast: (msg: string) => void;
}) {
  const [name, setName] = useState(account.name);
  const [fields, setFields] = useState<SharedAccountField[]>(
    () => cloneFields(account.fields)
  );
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
    null
  );

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function addField(kind: SharedFieldKind) {
    setFields((prev) => [
      ...prev,
      {
        id: makeFieldId(),
        label: defaultLabel(kind),
        kind,
        value: "",
      },
    ]);
  }

  function patchField(id: string, patch: Partial<SharedAccountField>) {
    setFields((prev) =>
      prev.map((field) => (field.id === id ? { ...field, ...patch } : field))
    );
  }

  function removeField(id: string) {
    setFields((prev) => prev.filter((field) => field.id !== id));
    setRevealed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function changeKind(id: string, kind: SharedFieldKind) {
    setFields((prev) =>
      prev.map((field) => {
        if (field.id !== id) return field;
        const wasGeneric =
          field.label === "Field" ||
          field.label === "Password" ||
          field.label === "Image";
        return {
          id: field.id,
          label: wasGeneric ? defaultLabel(kind) : field.label,
          kind,
          value: "",
        };
      })
    );
  }

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyValue(value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      onToast("Copied");
    } catch {
      onToast("Error: Copy failed");
    }
  }

  async function chooseImage(id: string, file: File | null) {
    if (!file) return;
    try {
      const image = await fileToImageField(file);
      patchField(id, image);
    } catch (err) {
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      onToast("Error: Place / account name required");
      return;
    }
    const cleanFields = fields.map((field) => ({
      ...field,
      label: field.label.trim() || defaultLabel(field.kind),
      value: field.value || "",
    }));
    setBusy(true);
    try {
      const res = await updateSharedAccount({
        id: account.id,
        name: trimmed,
        fields: cleanFields,
      });
      onAccountsChange(res.accounts);
      onToast("Saved");
      onClose();
    } catch (err) {
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm("Delete this shared password entry?")) return;
    setBusy(true);
    try {
      const res = await deleteSharedAccount(account.id);
      onAccountsChange(res.accounts);
      onToast("Deleted");
      onClose();
    } catch (err) {
      onToast("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal-wide password-modal">
        <div className="modal-header">
          <h2>Edit password entry</h2>
          <span className="modal-sub">
            {fields.length} field{fields.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="field">
          <label htmlFor="password-edit-name">Place / account</label>
          <input
            id="password-edit-name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="password-field-toolbar">
          <label>Fields</label>
          <div className="password-add-fields">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => addField("text")}
            >
              Add text
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => addField("password")}
            >
              Add password
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => addField("image")}
            >
              Add image
            </button>
          </div>
        </div>

        {fields.length === 0 ? (
          <div className="password-field-empty">No fields yet.</div>
        ) : (
          <div className="password-field-list">
            {fields.map((field) => (
              <div key={field.id} className="password-field-card">
                <div className="password-field-head">
                  <input
                    type="text"
                    className="password-field-label"
                    placeholder="Field label"
                    autoComplete="off"
                    value={field.label}
                    onChange={(e) =>
                      patchField(field.id, { label: e.target.value })
                    }
                  />
                  <select
                    className="password-kind"
                    value={field.kind}
                    onChange={(e) =>
                      changeKind(field.id, e.target.value as SharedFieldKind)
                    }
                    aria-label="Field type"
                  >
                    <option value="text">Text</option>
                    <option value="password">Password</option>
                    <option value="image">Image</option>
                  </select>
                  <button
                    type="button"
                    className="password-remove"
                    onClick={() => removeField(field.id)}
                    aria-label="Remove field"
                  >
                    x
                  </button>
                </div>

                {field.kind === "image" ? (
                  <div className="password-image-editor receipt-picker">
                    {field.value ? (
                      <button
                        type="button"
                        className="password-image-thumb"
                        onClick={() =>
                          setLightbox({
                            src: field.value,
                            alt: field.label || "Saved image",
                          })
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={field.value} alt={field.label || "Saved image"} />
                      </button>
                    ) : (
                      <div className="password-image-empty">No image selected</div>
                    )}
                    <div className="password-image-actions">
                      <label
                        htmlFor={`password-image-${field.id}`}
                        className="receipt-picker-cta password-image-cta"
                      >
                        {field.value ? "Replace image" : "Choose image"}
                      </label>
                      <input
                        id={`password-image-${field.id}`}
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          void chooseImage(field.id, file);
                          e.target.value = "";
                        }}
                      />
                      {field.value ? (
                        <button
                          type="button"
                          className="btn-secondary password-small-btn"
                          onClick={() =>
                            patchField(field.id, {
                              value: "",
                              filename: undefined,
                              mimeType: undefined,
                            })
                          }
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : field.kind === "password" ? (
                  <div className="password-secret-row">
                    <input
                      type={revealed.has(field.id) ? "text" : "password"}
                      className="password-value-input"
                      autoComplete="new-password"
                      value={field.value}
                      onChange={(e) =>
                        patchField(field.id, { value: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="btn-secondary password-small-btn"
                      onClick={() => toggleReveal(field.id)}
                    >
                      {revealed.has(field.id) ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary password-small-btn"
                      onClick={() => copyValue(field.value)}
                      disabled={!field.value}
                    >
                      Copy
                    </button>
                  </div>
                ) : (
                  <div className="password-text-editor">
                    <textarea
                      className="textarea password-value-textarea"
                      value={field.value}
                      autoComplete="off"
                      onChange={(e) =>
                        patchField(field.id, { value: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="btn-secondary password-small-btn"
                      onClick={() => copyValue(field.value)}
                      disabled={!field.value}
                    >
                      Copy
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn-danger"
            onClick={del}
            disabled={busy}
          >
            Delete
          </button>
          <div className="right">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ background: "var(--accent)", color: "white" }}
              onClick={save}
              disabled={busy}
            >
              {busy ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>

      {lightbox ? (
        <ReceiptLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}
