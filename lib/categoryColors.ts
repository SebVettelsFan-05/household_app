import type { CategoryDef } from "./types";

export type CategoryColor = { color: string; soft: string };

// Reserved colors for the original three categories — keeps the historic look
// for users who haven't set explicit colors.
const RESERVED: Record<string, CategoryColor> = {
  meat:    { color: "#B8543D", soft: "#F1DDD4" },
  veggies: { color: "#6E8E5C", soft: "#DEE8D3" },
  other:   { color: "#8B8278", soft: "#E8E3DB" },
};

// Curated palette that fits the cream + forest aesthetic. Used as the
// auto-color fallback when a category has no explicit color set.
export const PALETTE: CategoryColor[] = [
  { color: "#C57F3C", soft: "#F1E2CD" }, // amber
  { color: "#4A6E8A", soft: "#D3DFE8" }, // dusty blue
  { color: "#8A5A8A", soft: "#E5D3E2" }, // mauve
  { color: "#3D7A6E", soft: "#CFE2DD" }, // teal
  { color: "#7A6A3D", soft: "#E5DEC9" }, // ochre
  { color: "#9C4A4A", soft: "#EAD2D2" }, // coral
  { color: "#5C7A8A", soft: "#D6DFE3" }, // slate
  { color: "#7A8A4A", soft: "#DDE3CC" }, // moss
  { color: "#8A4A5C", soft: "#EAD0D6" }, // wine
  { color: "#3F5F7A", soft: "#D2DBE3" }, // indigo
  { color: "#A66A3A", soft: "#ECD7C6" }, // copper
  { color: "#5A7A5A", soft: "#D3DECF" }, // sage
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

const BG: [number, number, number] = [0xfa, 0xf6, 0xee]; // app cream

// Mix an arbitrary hex color toward cream to get a pill-background tint that
// blends with the rest of the design.
export function deriveSoft(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const mix = (a: number, b: number) => Math.round(a * 0.22 + b * 0.78);
  const r = mix(rgb[0], BG[0]);
  const g = mix(rgb[1], BG[1]);
  const b = mix(rgb[2], BG[2]);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function autoColor(name: string): CategoryColor {
  const key = name.trim().toLowerCase();
  if (key in RESERVED) return RESERVED[key];
  return PALETTE[hash(key) % PALETTE.length];
}

/**
 * Resolve the color for a category name. If an explicit hex is provided
 * (from the user's setting), use it and derive the soft pill background.
 * Otherwise fall back to the auto palette / reserved defaults.
 */
export function getCategoryColor(
  name: string,
  explicitHex?: string | null
): CategoryColor {
  if (explicitHex) {
    const rgb = parseHex(explicitHex);
    if (rgb) return { color: explicitHex, soft: deriveSoft(explicitHex) };
  }
  return autoColor(name);
}

/**
 * Build a fast lookup from category list. Useful when rendering many items.
 */
export function buildColorLookup(
  categories: CategoryDef[]
): (name: string) => CategoryColor {
  const map = new Map<string, string | null>();
  for (const c of categories) map.set(c.name.toLowerCase(), c.color);
  return (name: string) => {
    const explicit = map.get(name.toLowerCase()) ?? null;
    return getCategoryColor(name, explicit);
  };
}
