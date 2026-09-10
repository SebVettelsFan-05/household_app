"use client";

/**
 * Person identity in the fresh shell. A housemate is always drawn the same
 * way: a coloured disc with their initial, then their name. The colours are
 * fixed for good, so the same person is the same colour on a day card, a
 * settlement row, a grocery request and a receipt.
 */

const PERSON_COLORS: Record<string, string> = {
  // Each passes 4.5:1 under a white initial and against the paper page.
  Arthur: "#2F5BEA",
  Daniel: "#BD5609",
  Eli: "#C23A78",
  Ibrahim: "#177A52",
  Minh: "#6A3DE8",
};

/** Anyone not on the fixed list (a departed housemate on an old receipt). */
const UNKNOWN_COLOR = "#6B655C";

export function personColor(name: string): string {
  return PERSON_COLORS[name.trim()] ?? UNKNOWN_COLOR;
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
}

/**
 * The disc on its own. `size` is the diameter in px; the letter scales with
 * it so a 20px disc and a 36px disc read the same.
 */
export function Avatar({
  name,
  size = 28,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`fresh-avatar${className ? ` ${className}` : ""}`}
      style={{
        background: personColor(name),
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
      }}
      aria-hidden="true"
    >
      {initial(name)}
    </span>
  );
}

/** Disc plus name, the only way a person is ever written in the fresh UI. */
export function PersonTag({
  name,
  size = 24,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`fresh-person${className ? ` ${className}` : ""}`}>
      <Avatar name={name} size={size} />
      <span className="fresh-person-name">{name}</span>
    </span>
  );
}
