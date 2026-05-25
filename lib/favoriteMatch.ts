/**
 * Shared favorite-matching logic so the card star and the in-modal toggle
 * always agree on whether a given recipe is already a favorite.
 *
 * Match rule (case-insensitive): name OR link. A favorite saved under one
 * name still counts as a match if its link matches the recipe's link, and
 * vice versa.
 */

import type { FavoriteRecipe } from "./types";

type Candidate = { name?: string; link?: string };

export function findFavoriteMatch(
  candidate: Candidate,
  favorites: FavoriteRecipe[]
): FavoriteRecipe | null {
  const nameKey = (candidate.name || "").trim().toLowerCase();
  const linkKey = (candidate.link || "").trim().toLowerCase();
  if (!nameKey && !linkKey) return null;
  for (const f of favorites) {
    if (nameKey && f.name.trim().toLowerCase() === nameKey) return f;
    if (linkKey && (f.link || "").trim().toLowerCase() === linkKey) return f;
  }
  return null;
}

export function isFavoriteMatch(
  candidate: Candidate,
  favorites: FavoriteRecipe[]
): boolean {
  return findFavoriteMatch(candidate, favorites) !== null;
}
