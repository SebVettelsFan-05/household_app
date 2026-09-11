"use client";

import type { ReactNode } from "react";
import type { FreshTab } from "@/components/fresh/FreshApp";
import {
  IconBox,
  IconChevronRight,
  IconKey,
  IconSettings,
} from "@/components/fresh/icons";

type Props = {
  onNavigate: (tab: FreshTab) => void;
  onOpenSettings: () => void;
};

/**
 * Phone-only overflow. The desktop rail lists these destinations directly,
 * so this screen only ever shows under 720px.
 */
export default function FreshMore({ onNavigate, onOpenSettings }: Props) {
  const entries: {
    label: string;
    hint: string;
    icon: ReactNode;
    onClick: () => void;
  }[] = [
    {
      label: "Inventory",
      hint: "What the house has on hand, and what is about to go off",
      icon: <IconBox size={22} />,
      onClick: () => onNavigate("fridge"),
    },
    {
      label: "Passwords",
      hint: "Shared account logins and numbers",
      icon: <IconKey size={22} />,
      onClick: () => onNavigate("passwords"),
    },
    {
      label: "Household settings",
      hint: "Appearance, look and household preferences",
      icon: <IconSettings size={22} />,
      onClick: onOpenSettings,
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
            <span className="fresh-more-icon">{e.icon}</span>
            <span className="fresh-row-main">
              <span className="fresh-row-title">{e.label}</span>
              <span className="fresh-row-meta">{e.hint}</span>
            </span>
            <span className="fresh-chev">
              <IconChevronRight size={20} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
