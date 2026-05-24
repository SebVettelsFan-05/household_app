"use client";

export type Tab = "fridge" | "grocery";

type Props = {
  value: Tab;
  onChange: (t: Tab) => void;
  groceryCount?: number;
};

export default function TabBar({ value, onChange, groceryCount = 0 }: Props) {
  return (
    <nav className="tab-bar" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={value === "fridge"}
        className={`tab${value === "fridge" ? " active" : ""}`}
        onClick={() => onChange("fridge")}
      >
        Fridge
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "grocery"}
        className={`tab${value === "grocery" ? " active" : ""}`}
        onClick={() => onChange("grocery")}
      >
        Grocery
        {groceryCount > 0 ? (
          <span className="tab-badge">{groceryCount}</span>
        ) : null}
      </button>
    </nav>
  );
}
