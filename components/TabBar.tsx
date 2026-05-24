"use client";

export type Tab = "home" | "fridge" | "grocery" | "recipes" | "expenses";

type Props = {
  value: Tab;
  onChange: (t: Tab) => void;
  groceryCount?: number;
};

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "fridge", label: "Fridge" },
  { id: "grocery", label: "Grocery" },
  { id: "recipes", label: "Recipes" },
  { id: "expenses", label: "Expenses" },
];

export default function TabBar({ value, onChange, groceryCount = 0 }: Props) {
  return (
    <nav className="tab-bar" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={`tab${value === t.id ? " active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.id === "grocery" && groceryCount > 0 ? (
            <span className="tab-badge">{groceryCount}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
