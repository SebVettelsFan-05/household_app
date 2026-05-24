export type CategoryColor = { color: string; soft: string };

// Reserved colors for the original three categories — keeps the historic look.
const RESERVED: Record<string, CategoryColor> = {
  meat:    { color: "#B8543D", soft: "#F1DDD4" },
  veggies: { color: "#6E8E5C", soft: "#DEE8D3" },
  other:   { color: "#8B8278", soft: "#E8E3DB" },
};

// Curated palette that fits the cream + forest aesthetic. Categories outside
// the reserved list are mapped deterministically into this palette by name hash.
const PALETTE: CategoryColor[] = [
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

export function getCategoryColor(name: string): CategoryColor {
  const key = String(name || "").trim().toLowerCase();
  if (key in RESERVED) return RESERVED[key];
  return PALETTE[hash(key) % PALETTE.length];
}
