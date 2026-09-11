"use client";

/**
 * The fresh shell's whole icon vocabulary, drawn once. 24x24, 2px stroke,
 * round caps and joins, `currentColor` throughout, so an icon takes the
 * colour of whatever it sits in and never needs a second variant.
 *
 * There are no emoji anywhere in the fresh components; the reused classic
 * forms keep theirs in the DOM and fresh.css hides them.
 */

export type IconProps = {
  size?: number;
  className?: string;
};

function svg(path: React.ReactNode, { size = 24, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}

export function IconHome(p: IconProps) {
  return svg(
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M9.5 20v-6h5v6" />
    </>,
    p
  );
}

/** A cooking pot with two handles and a lid. Stands for Recipes. */
export function IconPot(p: IconProps) {
  return svg(
    <>
      <path d="M4 9h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
      <path d="M2 6.5h20" />
      <path d="M12 3v3.5" />
      <path d="M4 11H2.5" />
      <path d="M20 11h1.5" />
    </>,
    p
  );
}

export function IconCart(p: IconProps) {
  return svg(
    <>
      <path d="M3 4h2.2l2.2 10.2a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.5L20.5 7H6" />
      <circle cx="10" cy="20" r="1.4" />
      <circle cx="17.5" cy="20" r="1.4" />
    </>,
    p
  );
}

export function IconReceipt(p: IconProps) {
  return svg(
    <>
      <path d="M5.5 3h13v18l-2.2-1.6-2.2 1.6-2.1-1.6L9.9 21l-2.2-1.6L5.5 21V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </>,
    p
  );
}

export function IconBox(p: IconProps) {
  return svg(
    <>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" />
      <path d="m3 7.5 9 4.5 9-4.5" />
      <path d="M12 12v9" />
    </>,
    p
  );
}

export function IconKey(p: IconProps) {
  return svg(
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9" />
      <path d="m17 6 2.5 2.5" />
      <path d="m14.5 8.5 2.5 2.5" />
    </>,
    p
  );
}

export function IconPlus(p: IconProps) {
  return svg(
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>,
    p
  );
}

export function IconCheck(p: IconProps) {
  return svg(<path d="m4.5 12.5 5 5 10-11" />, p);
}

export function IconChevronRight(p: IconProps) {
  return svg(<path d="m9 4.5 7.5 7.5L9 19.5" />, p);
}

export function IconChevronLeft(p: IconProps) {
  return svg(<path d="M15 4.5 7.5 12 15 19.5" />, p);
}

export function IconCamera(p: IconProps) {
  return svg(
    <>
      <path d="M3 8.5h3.5L8.2 6h7.6l1.7 2.5H21V19H3V8.5Z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>,
    p
  );
}

export function IconMic(p: IconProps) {
  return svg(
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 12a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18.5V21" />
    </>,
    p
  );
}

export function IconCalendar(p: IconProps) {
  return svg(
    <>
      <rect x="3" y="5.5" width="18" height="15" rx="3" />
      <path d="M3 10h18" />
      <path d="M8 3v5" />
      <path d="M16 3v5" />
    </>,
    p
  );
}

export function IconSettings(p: IconProps) {
  return svg(
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.6 14.6a1.6 1.6 0 0 0 .32 1.77l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.05-.06a1.6 1.6 0 0 0-1.78-.32 1.6 1.6 0 0 0-.97 1.47v.17a1.9 1.9 0 0 1-3.8 0v-.09a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.78 1.6 1.6 0 0 0-1.47-.97h-.17a1.9 1.9 0 0 1 0-3.8h.09a1.6 1.6 0 0 0 1.46-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.77.32h.08a1.6 1.6 0 0 0 .97-1.47v-.17a1.9 1.9 0 1 1 3.8 0v.09a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.78-.32l.05-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.47.97h.17a1.9 1.9 0 0 1 0 3.8h-.09a1.6 1.6 0 0 0-1.46.97Z" />
    </>,
    p
  );
}

export function IconRefresh(p: IconProps) {
  return svg(
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.5 3.5V9h-5.5" />
    </>,
    p
  );
}

export function IconMoon(p: IconProps) {
  return svg(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />, p);
}

export function IconSun(p: IconProps) {
  return svg(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.4 5.6 17 7M7 17l-1.4 1.4M18.4 18.4 17 17M7 7 5.6 5.6" />
    </>,
    p
  );
}

export function IconX(p: IconProps) {
  return svg(
    <>
      <path d="m5.5 5.5 13 13" />
      <path d="m18.5 5.5-13 13" />
    </>,
    p
  );
}

export function IconStar(p: IconProps) {
  return svg(
    <path d="m12 3.5 2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83L6.62 20.15l1.03-6L3.3 9.9l6-.9L12 3.5Z" />,
    p
  );
}

export function IconArchive(p: IconProps) {
  return svg(
    <>
      <rect x="3" y="4" width="18" height="4.5" rx="1.5" />
      <path d="M4.8 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11.4a1.5 1.5 0 0 0 1.5-1.5V8.5" />
      <path d="M10 12.5h4" />
    </>,
    p
  );
}

/** Overflow: the phone nav's fifth slot. */
export function IconMore(p: IconProps) {
  return svg(
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>,
    p
  );
}

export function IconLink(p: IconProps) {
  return svg(
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" />
    </>,
    p
  );
}

export function IconSearch(p: IconProps) {
  return svg(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>,
    p
  );
}
