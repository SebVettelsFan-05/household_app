/**
 * Tiny HTML text utilities shared by the recipe scraper and the ingredient
 * parser. Pure string functions — safe on both server and client.
 */

// Named entities that actually show up in recipe markup. Numeric forms
// (&#233; / &#x2153;) are handled generically below, so this list only needs
// the common named ones.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  deg: "°",
  times: "×",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  ntilde: "ñ",
  // Vulgar fractions — recipe sites love these ("&frac12; cup sugar").
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  frac13: "⅓",
  frac23: "⅔",
  frac15: "⅕",
  frac16: "⅙",
  frac18: "⅛",
  frac38: "⅜",
  frac58: "⅝",
  frac78: "⅞",
};

/**
 * Decode HTML entities (named, decimal, and hex) into plain text. Unknown
 * named entities are left untouched rather than mangled.
 */
export function decodeHtmlEntities(s: string): string {
  return String(s ?? "").replace(
    /&(#x?[0-9a-f]+|[a-z][a-z0-9]*);?/gi,
    (whole, body: string) => {
      if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
          return whole;
        }
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      const named = NAMED_ENTITIES[body.toLowerCase()];
      return named !== undefined ? named : whole;
    }
  );
}

/** Remove tags, leaving inner text. Not a sanitizer — display cleanup only. */
export function stripHtmlTags(s: string): string {
  return String(s ?? "").replace(/<[^>]*>/g, " ");
}

export function collapseWhitespace(s: string): string {
  return (
    String(s ?? "")
      // Zero-width chars vanish; \s already covers NBSP + unicode spaces.
      .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** stripHtmlTags → decodeHtmlEntities → collapseWhitespace, in that order. */
export function htmlToText(s: string): string {
  return collapseWhitespace(decodeHtmlEntities(stripHtmlTags(s)));
}
