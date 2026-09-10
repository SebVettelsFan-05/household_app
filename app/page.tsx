"use client";

import { useEffect, useState } from "react";
import ClassicApp from "@/components/classic/ClassicApp";
import FreshApp from "@/components/fresh/FreshApp";
import { getUiMode, setUiMode, type UiMode } from "@/lib/uiMode";
import { useHouseholdData } from "@/lib/useHouseholdData";

export default function Page() {
  const data = useHouseholdData();
  // The stored choice only exists in the browser, so the first render has
  // to commit to nothing. Rendering one shell and swapping it on mount
  // would flash the wrong UI on every load.
  const [mode, setMode] = useState<UiMode | null>(null);

  useEffect(() => {
    setMode(getUiMode());
  }, []);

  function switchTo(next: UiMode) {
    setUiMode(next);
    setMode(next);
  }

  if (mode === null) return null;

  return mode === "classic" ? (
    <ClassicApp data={data} onSwitchUi={() => switchTo("fresh")} />
  ) : (
    <FreshApp data={data} onSwitchUi={() => switchTo("classic")} />
  );
}
