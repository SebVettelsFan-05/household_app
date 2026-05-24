"use client";

import type { Tab } from "./TabBar";

type Props = {
  onNavigate: (t: Tab) => void;
};

const SECTIONS: {
  id: Exclude<Tab, "home">;
  title: string;
  blurb: string;
}[] = [
  {
    id: "fridge",
    title: "Fridge",
    blurb:
      "Track what's in the household fridge — quantities, expiry dates, and what's about to go bad.",
  },
  {
    id: "grocery",
    title: "Grocery",
    blurb:
      "Shared shopping list. Adding something already in the fridge will warn you so we don't double-buy.",
  },
  {
    id: "recipes",
    title: "Recipes",
    blurb:
      "Weekly cooking schedule, Sunday → Thursday. Pick the cook, log the recipe, and push the ingredients straight to the grocery list.",
  },
  {
    id: "expenses",
    title: "Expenses",
    blurb:
      "Log shared spending and split the total 5 ways at the end of the month. Everyone funds the joint account; whoever paid gets reimbursed from it.",
  },
];

export default function HomeView({ onNavigate }: Props) {
  return (
    <div className="home-view">
      <section className="home-hero">
        <p className="home-lede">
          A little household app for the five of us.
        </p>
        <p className="home-sub">
          Everything stays in sync across phones, and a copy lives in our
          Google Sheet for the record.
        </p>
      </section>

      <div className="home-cards">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="home-card"
            onClick={() => onNavigate(s.id)}
          >
            <div className="home-card-title">{s.title}</div>
            <div className="home-card-blurb">{s.blurb}</div>
            <div className="home-card-cta">Open →</div>
          </button>
        ))}
      </div>
    </div>
  );
}
