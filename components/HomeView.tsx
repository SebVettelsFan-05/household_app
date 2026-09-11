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
    title: "Inventory",
    blurb:
      "Everything we've got on hand — fridge, pantry, household supplies. Quantities, expiry dates, and what's about to go bad.",
  },
  {
    id: "grocery",
    title: "Grocery",
    blurb:
      "Shared shopping list. Adding something already in inventory will warn you so we don't double-buy.",
  },
  {
    id: "recipes",
    title: "Recipes",
    blurb:
      "Dinner schedule for whoever is in the meal group, any day of the week. Pick the cook, log the recipe, and push the ingredients to the grocery list.",
  },
  {
    id: "expenses",
    title: "Expenses",
    blurb:
      "Log spending with a receipt and say who each part was for: everyone, the meal group, or just you. The joint account settles the difference each month.",
  },
  {
    id: "passwords",
    title: "Passwords",
    blurb:
      "Shared account details grouped by place, with flexible fields for logins, numbers, images, and anything else the account needs.",
  },
];

export default function HomeView({ onNavigate }: Props) {
  return (
    <div className="home-view">
      <section className="home-hero">
        <p className="home-lede">
          House costs are shared by everyone; dinners are shared by the meal
          group.
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
