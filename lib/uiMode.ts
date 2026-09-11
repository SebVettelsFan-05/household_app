export type UiMode = "fresh" | "classic";

const KEY = "hh_ui";

/**
 * Which shell this device renders. Stored per device, not per household,
 * so one housemate trying the new look never moves anybody else's app.
 * Anything other than an explicit "classic" reads as fresh, which is the
 * default for a device that has never chosen.
 */
export function getUiMode(): UiMode {
  try {
    return window.localStorage.getItem(KEY) === "classic" ? "classic" : "fresh";
  } catch {
    return "fresh";
  }
}

export function setUiMode(mode: UiMode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Private-mode storage failures just mean the choice lasts this session.
  }
}
