"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { UiMode } from "@/lib/uiMode";

/**
 * Which shell is rendering. Read by the components both shells share
 * (modal chrome, person pickers) so one component can draw classic markup
 * in the classic app and fresh markup in the fresh app.
 *
 * The default is "classic" so anything mounted outside a provider keeps the
 * original markup rather than silently switching look.
 */
const UiModeContext = createContext<UiMode>("classic");

export function useUiMode(): UiMode {
  return useContext(UiModeContext);
}

export default function UiModeProvider({
  mode,
  children,
}: {
  mode: UiMode;
  children: ReactNode;
}) {
  return (
    <UiModeContext.Provider value={mode}>{children}</UiModeContext.Provider>
  );
}
