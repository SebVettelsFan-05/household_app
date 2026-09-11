"use client";

import { useEffect, useState } from "react";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";

export default function ThemeToggle() {
  // The actual theme is set by an inline script in <head> before paint;
  // mirror that into state so the button reflects it.
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  // Until we know the real theme, render a neutral placeholder so the icon
  // doesn't briefly show the wrong one.
  const icon = !mounted ? "" : theme === "dark" ? "☀" : "☾";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
      }
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {icon}
    </button>
  );
}
