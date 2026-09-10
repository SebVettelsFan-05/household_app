"use client";

import type { FreshTab } from "@/components/fresh/FreshApp";

type Props = {
  onNavigate: (tab: FreshTab) => void;
  onOpenSettings: () => void;
  onSwitchUi: () => void;
};

/**
 * Phone-only overflow. The desktop rail lists these destinations directly,
 * so this screen only ever shows under 720px.
 */
export default function FreshMore({
  onNavigate,
  onOpenSettings,
  onSwitchUi,
}: Props) {
  const entries: { label: string; hint: string; onClick: () => void }[] = [
    {
      label: "Inventory",
      hint: "What the house has on hand, and what is about to go off",
      onClick: () => onNavigate("fridge"),
    },
    {
      label: "Passwords",
      hint: "Shared account logins and numbers",
      onClick: () => onNavigate("passwords"),
    },
    {
      label: "Household settings",
      hint: "Who shares dinners",
      onClick: onOpenSettings,
    },
    {
      label: "Classic look",
      hint: "Switch this device back to the original design",
      onClick: onSwitchUi,
    },
  ];

  return (
    <div className="fresh-more">
      <div className="fresh-rows">
        {entries.map((e) => (
          <button
            key={e.label}
            type="button"
            className="fresh-row"
            onClick={e.onClick}
          >
            <span className="fresh-row-main">
              <span className="fresh-row-title">{e.label}</span>
              <span className="fresh-row-meta">{e.hint}</span>
            </span>
            <span className="fresh-row-note">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
