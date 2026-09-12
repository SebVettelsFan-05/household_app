"use client";

import { useEffect, useMemo, useState } from "react";
import ModalFrame from "@/components/ModalFrame";
import { listArchivedRecipes } from "@/lib/client";
import { cookCountsLabel } from "@/lib/cookCounts";
import { DAY_LONG, parseYmd, ymd } from "@/lib/dates";
import type { Recipe } from "@/lib/types";

type Props = {
  onClose: () => void;
  onError: (msg: string) => void;
};

function weekLabel(weekStart: string): string {
  const start = parseYmd(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6); // Sun to Sat inclusive
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const sameMonth = start.getMonth() === end.getMonth();
  const startStr = `${months[start.getMonth()]} ${start.getDate()}`;
  const endStr = sameMonth
    ? `${end.getDate()}`
    : `${months[end.getMonth()]} ${end.getDate()}`;
  const year =
    start.getFullYear() !== new Date().getFullYear()
      ? `, ${start.getFullYear()}`
      : "";
  return `${startStr} to ${endStr}${year}`;
}

export default function RecipeArchiveModal({ onClose, onError }: Props) {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listArchivedRecipes()
      .then((data) => {
        if (!cancelled) setRecipes(data);
      })
      .catch((err) => {
        if (cancelled) return;
        onError(err instanceof Error ? err.message : String(err));
        setRecipes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  // Group already-sorted recipes by week. The repo returns them ordered by
  // (weekStart DESC, day ASC), so a single pass preserves that for the UI.
  const grouped = useMemo(() => {
    if (!recipes) return [];
    const out: { weekStart: string; recipes: Recipe[] }[] = [];
    let current: { weekStart: string; recipes: Recipe[] } | null = null;
    // "No shared meal" markers hold a slot in the planner; there is nothing
    // to look back at.
    for (const r of recipes.filter((x) => !x.noMeal)) {
      if (!current || current.weekStart !== r.weekStart) {
        current = { weekStart: r.weekStart, recipes: [] };
        out.push(current);
      }
      current.recipes.push(r);
    }
    return out;
  }, [recipes]);

  // Who has been cooking lately. 28 days keeps it to roughly four cooking
  // weeks without needing exact week arithmetic.
  const recentCooks = useMemo(() => {
    if (!recipes) return "";
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);
    const key = ymd(cutoff);
    return cookCountsLabel(recipes.filter((r) => r.weekStart >= key));
  }, [recipes]);

  return (
    <ModalFrame
      title="Recipe archive"
      classicClass="archive-modal"
      onClose={onClose}
      actions={
        <>
          <div />
          <div className="right">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </>
      }
    >
      <p className="archive-sub">
        Past weeks, newest first. Recipes stay searchable here once the week
        rolls over.
      </p>
      {recentCooks ? (
        <p className="archive-cooks">Last 4 weeks: {recentCooks}</p>
      ) : null}

      {recipes === null ? (
        <div className="loading">
          <span className="spinner" />
          Loading…
        </div>
      ) : grouped.length === 0 ? (
        <div className="empty">
          <p>No archived recipes yet.</p>
          <p style={{ fontSize: 13 }}>
            Past weeks will show up here automatically.
          </p>
        </div>
      ) : (
        <div className="archive-list">
          {grouped.map((week) => (
            <section key={week.weekStart} className="archive-week">
              <h3>{weekLabel(week.weekStart)}</h3>
              <div className="archive-recipes">
                {week.recipes.map((r) => (
                  <div key={r.id} className="archive-recipe">
                    <div className="archive-recipe-head">
                      <span className="archive-day">{DAY_LONG[r.day]}</span>
                      <span className="archive-cook">{r.assignedTo}</span>
                    </div>
                    <div className="archive-name">{r.name}</div>
                    {r.description ? (
                      <div className="archive-desc">{r.description}</div>
                    ) : null}
                    {r.link ? (
                      <a
                        className="archive-link"
                        href={r.link}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open recipe<span className="btn-emoji" aria-hidden="true"> ↗</span>
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </ModalFrame>
  );
}
