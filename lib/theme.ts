export type Theme = "light" | "dark";

const KEY = "theme";

/**
 * The theme is stamped on <html> by an inline script in `app/layout.tsx`
 * before first paint, so the document is the source of truth here; the
 * controls that change it just mirror what is already there.
 */
export function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private-mode storage failures just mean the choice lasts this session.
  }
}
