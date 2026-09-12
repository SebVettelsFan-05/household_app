"use client";

import { useEffect, useState } from "react";
import ModalFrame from "@/components/ModalFrame";
import { PersonCheckList } from "@/components/PersonPicker";
import { useUiMode } from "@/components/UiModeProvider";
import { putMealGroup } from "@/lib/client";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";
import { BUYERS, type MealGroup } from "@/lib/types";

/** The two-way switch the fresh settings sheet uses for its preferences. */
function Segmented<T extends string>({
  labelId,
  value,
  options,
  onChange,
}: {
  labelId: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="fresh-seg" role="group" aria-labelledby={labelId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`fresh-seg-btn${o.value === value ? " active" : ""}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
  const mode = useUiMode();
  const [members, setMembers] = useState<string[]>(group.members);
  const [busy, setBusy] = useState(false);
  // The document already carries the real theme (an inline script sets it
  // before paint); mirror it once mounted so the control starts correct.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

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
    <ModalFrame
      title="Household"
      onClose={onClose}
      actions={
        <>
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
              className="btn-accent"
              onClick={save}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      }
    >
      {mode === "fresh" ? (
        <>
          <div className="field">
            <label id="hs-appearance">Appearance</label>
            <Segmented
              labelId="hs-appearance"
              value={theme}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              onChange={(next) => {
                setTheme(next);
                applyTheme(next);
              }}
            />
          </div>
          <div className="field">
            <label id="hs-look">Look</label>
            <Segmented
              labelId="hs-look"
              value="fresh"
              options={[
                { value: "fresh", label: "New" },
                { value: "classic", label: "Classic" },
              ]}
              onChange={(next) => {
                if (next === "classic") onSwitchUi?.();
              }}
            />
            <p className="settings-hint">
              Classic is the original design. This device only.
            </p>
          </div>
        </>
      ) : null}

      <div className="field">
        <label>{mode === "fresh" ? "Meal group" : "Shares dinners"}</label>
        {mode === "fresh" ? null : (
          <p className="settings-hint">
            People who share dinners. Used as the default for meal groceries
            and the cook list.
          </p>
        )}
        <PersonCheckList
          people={BUYERS}
          selected={members}
          onToggle={toggle}
          disabled={busy}
          className="settings-people"
          itemClassName="settings-person"
          ariaLabel="Shares dinners"
        />
        {mode === "fresh" ? (
          <p className="settings-hint">
            Default for meal groceries and the cook list.
          </p>
        ) : null}
        {members.length === 0 ? (
          <p className="settings-hint">
            Nobody selected, so meals default to everyone.
          </p>
        ) : null}
      </div>
    </ModalFrame>
  );
}
