# Fresh UI brief

Design read: redesign-overhaul of a private five-person household utility,
used mostly on phones by people who open it while standing in a kitchen or
a checkout line, occasionally on a laptop at month end. Functional first.
The visual change should be unmistakable next to the classic look, but
nothing about it may cost a tap.

Dials: variance 4, motion 2 (Arthur's Windows machines have OS animation
off, so `prefers-reduced-motion` is set and transitions never render;
nothing may depend on one), density 6.

## Non-negotiables (from tasteskill, filtered for a product UI)

- Typography: not Inter, not DM Sans (classic uses it). Use Geist from
  Google Fonts with a real system fallback stack; tabular numerals
  (`font-variant-numeric: tabular-nums`) everywhere money or counts appear.
  Hierarchy through weight and colour, not size. Body 15-16px, line-height
  1.45.
- Colour: one cool neutral ramp (zinc/slate family, never warm cream) and
  exactly one accent, used for primary actions, active nav and focus rings.
  Not green (classic is green), not purple. Saturation under 80 percent.
  Warn and danger tones are semantic, not decorative. Full dark mode via
  `:root[data-theme="dark"]` tokens, both modes screenshot-checked.
- Shape: one radius scale for the whole surface (10px on controls and
  panels, full pill on chips only). No mixed systems.
- Cards only where elevation means something (tonight's dinner, the
  settlement card). Everything else groups with hairlines and whitespace.
  Shadows tinted to the background hue, never pure black.
- Forms: label above input, helper text below, error text below in the
  danger tone. No placeholder-as-label. Every button label readable against
  its background (WCAG AA). Primary CTA fits on one line.
- States: skeleton loaders that match the final layout, composed empty
  states that say how to fill them, inline errors in forms, toasts only for
  transient confirmations.
- Banned: em-dashes and en-dashes as separators anywhere in the UI; more
  than one middle-dot per line; decorative status dots; eyebrows above
  every heading; uppercase tracked labels as a rhythm; glows; gradients;
  emoji as icons; hand-rolled SVG illustrations; "Elevate / Seamless"
  copy; centred hero blocks. Icons: Phosphor (inline SVG paths copied from
  the set are fine) or none. No icon fonts.
- Dismissal of any popover or sheet uses a catch layer element, never a
  window click listener. A dismiss click must never activate what is under it.

## Structure

- Mobile (under 720px): bottom tab bar, five tabs (Home, Grocery, Recipes,
  Expenses, More) where More holds Inventory, Passwords, Household settings
  and the Classic-look switch. Content max-width 100 percent with 16px
  gutters. Primary action per screen is a fixed bottom-right button above
  the tab bar.
- Desktop (720px and up): left rail with the same destinations plus
  household settings, content column max 1080px, and two-column layouts
  where they pay off: Expenses (list left, month settlement right),
  Recipes (this week left, next week right), Grocery (open list left,
  bought and inventory conflicts right).
- Home is a real dashboard, not a menu: tonight's dinner (cook, dish,
  portions, or "No shared meal", or "Nothing planned" with a one-tap plan
  action), this month's settlement in one line per person (send or
  withdraw amount, tone by direction), open grocery counts by pool, items
  expiring within three days. Every block links to its tab.
- Expenses: the add flow is a full-height sheet on mobile. Amount first
  and large, then paid-by chips, then the allocation chips
  (Everyone / Meals / Personal / Custom) with the "Split receipt" control
  right under the amount so a mixed receipt is one extra tap. Receipt
  capture is a single large control. Settlement card shows per-person send
  or withdraw with the house/meals/bills/rent breakdown revealed inline.
- Recipes: day rows, not a grid of equal cards. Each row: day, cook avatar
  initials, dish, portions, ingredient count, and the cook-count tally in
  the week header. A no-meal day is a quiet row.
- Grocery: grouped by pool first (Meals, House, Personal) then by
  category, with the requester on each line. Pool filter chips at the top.
- Inventory: owner badge, expiring-soon section pinned at the top.

## Engineering constraints

- Both UIs share one data layer: extract the fetch and state logic from
  `app/page.tsx` into a hook, and have both shells consume it.
- The new shell lives under `components/fresh/` with its stylesheet in
  `app/fresh.css`, every rule scoped under a `.fresh` root class so it
  cannot leak into the classic UI. Classic modals with heavy logic
  (recipe scraping, dictation, label scanning, passwords) are reused
  inside the fresh shell; scope token overrides under `.fresh` so they
  inherit the new type, colour and radius.
- UI choice persists per device in localStorage under `hh_ui`
  ("fresh" or "classic"), default fresh, switchable from both UIs.
- Everything must work at 390x844, 1920x1080 and 2560x1400 at 1.5x
  device scale factor. Screenshots of every screen in both modes and both
  themes go under `smoke/out/fresh/` and must be read, not just produced.
