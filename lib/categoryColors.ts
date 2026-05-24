import type { CategoryDef } from "./types";

// Reserved colors for the original three categories — keeps the historic look.
const RESERVED: Record<string, string> = {
  meat: "#B8543D",
  veggies: "#6E8E5C",
  other: "#8B8278",
};

// Curated palette for auto-color fallback (deterministic by name hash).
export const PALETTE: string[] = [
  "#C57F3C", "#4A6E8A", "#8A5A8A", "#3D7A6E",
  "#7A6A3D", "#9C4A4A", "#5C7A8A", "#7A8A4A",
  "#8A4A5C", "#3F5F7A", "#A66A3A", "#5A7A5A",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function autoColor(name: string): string {
  const key = name.trim().toLowerCase();
  if (key in RESERVED) return RESERVED[key];
  return PALETTE[hash(key) % PALETTE.length];
}

/**
 * Resolve the color for a category name. Returns just the primary hex —
 * "soft" backgrounds are derived in CSS via color-mix() so they automatically
 * blend with the current theme's background (light or dark).
 */
export function getCategoryColor(
  name: string,
  explicitHex?: string | null
): string {
  if (explicitHex && /^#[0-9a-f]{6}$/i.test(explicitHex)) return explicitHex;
  return autoColor(name);
}

/**
 * Build a fast lookup from a categories list. Useful when rendering many items.
 */
export function buildColorLookup(
  categories: CategoryDef[]
): (name: string) => string {
  const map = new Map<string, string | null>();
  for (const c of categories) map.set(c.name.toLowerCase(), c.color);
  return (name: string) => {
    const explicit = map.get(name.toLowerCase()) ?? null;
    return getCategoryColor(name, explicit);
  };
}
