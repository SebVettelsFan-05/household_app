"use client";

import { useEffect, useState } from "react";
import { putMealGroup } from "@/lib/client";
import { BUYERS, type MealGroup } from "@/lib/types";

type Props = {
  group: MealGroup;
  onClose: () => void;
  onSaved: (group: MealGroup) => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
  // Optional "switch to the other shell" action. The classic UI offers the
  // fresh look from here; the fresh UI has its own entry in More, so it
  // mounts this modal without the button.
  switchLabel?: string;
  onSwitchUi?: () => void;
};

export default function HouseholdSettingsModal({
  group,
  onClose,
  onSaved,
  onToast,
  onError,
  switchLabel,
  onSwitchUi,
}: Props) {
  const [members, setMembers] = useState<string[]>(group.members);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(name: string) {
    setMembers((prev) =>
      prev.includes(name)
        ? prev.filter((m) => m !== name)
        : BUYERS.filter((b) => b === name || prev.includes(b))
    );
  }

  async function save() {
    setBusy(true);
    try {
      const next: MealGroup = { members };
      await putMealGroup(next);
      onSaved(next);
      onToast("Household settings saved");
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
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
      <div className="modal">
        <h2>Household</h2>

        <div className="field">
          <label>Shares dinners</label>
          <p className="settings-hint">
            People who share dinners. Used as the default for meal groceries
            and the cook list.
          </p>
          <div className="settings-people">
            {BUYERS.map((b) => (
              <label className="settings-person" key={b}>
                <input
                  type="checkbox"
                  checked={members.includes(b)}
                  onChange={() => toggle(b)}
                  disabled={busy}
                />
                <span>{b}</span>
              </label>
            ))}
          </div>
          {members.length === 0 ? (
            <p className="settings-hint">
              Nobody selected, so meals default to everyone.
            </p>
          ) : null}
        </div>

        <div className="modal-actions">
          {onSwitchUi && switchLabel ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={onSwitchUi}
              disabled={busy}
            >
              {switchLabel}
            </button>
          ) : (
            <div />
          )}
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
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
