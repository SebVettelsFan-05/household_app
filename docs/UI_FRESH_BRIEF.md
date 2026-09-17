# Fresh UI: design spec

This replaces the first attempt, which read as a generic grey SaaS dashboard.
The app is a shared kitchen board for five friends in one house, used
mostly on phones while cooking, shopping, or settling up. It should feel
warm, bold and tactile, like a well-made paper planner, not like admin
software. Everything below is a decision, not a suggestion. Where a detail
is not specified, choose the option with more character and more contrast,
never the quieter one.

## Palette

Light: paper `#F6F1E7` page, card `#FFFDF8`, ink `#1A1714`, ink-soft
`#6B655C`, hairline `rgba(26,23,20,0.12)`.
Dark: page `#151311`, card `#211E1A`, ink `#F3EDE2`, ink-soft `#A39B8F`,
hairline `rgba(243,237,226,0.12)`.

Section colours, each used as that screen's wash (header title colour,
active tab, primary button, focus ring, selected chip):

| Screen    | Light     | Dark      |
|-----------|-----------|-----------|
| Home      | ink       | ink       |
| Recipes   | `#C13D22` | `#F0694B` |
| Grocery   | `#8A5F00` | `#E8AA2A` |
| Expenses  | `#136F63` | `#2FA08F` |
| Inventory | `#3F7A2E` | `#7BB865` |
| Passwords | `#6B3FA0` | `#9C74D6` |

Every light value is at least 4.5:1 as text on paper and under white text
as a fill; do not lighten them.

Person colours, fixed forever, used for avatar discs (initial letter, white
on colour) wherever a name appears: Arthur `#2F5BEA`, Daniel `#BD5609`,
Eli `#C23A78`, Ibrahim `#177A52`, Minh `#6A3DE8`. A name is always shown
as disc + name, never a bare grey pill.

Pool tags: Meals in the Recipes colour, House in ink, Personal in the
person's colour. Money direction: send in the Recipes colour, withdraw in
the Expenses colour, tabular numerals always.

## Type

Google Fonts link in `app/layout.tsx`:
`Bricolage+Grotesque:opsz,wght@12..96,400..800` for display and
`Instrument+Sans:wght@400;500;600;700` for everything else. Fallbacks:
`"Bricolage Grotesque", "Instrument Sans", system-ui, sans-serif`.

- Screen title: Bricolage 24px on phones, 28px from 720px up, /1.05,
  weight 700, letter-spacing -0.02em, section colour.
- Section heading (`.fresh-h2`): Bricolage 17px, weight 650. Dish name on a
  day card: 20px. The Tonight hero's dish stays larger at 26px.
- Big money (amount input, settlement total): Bricolage 36px weight 700,
  tabular.
- Body: Instrument Sans 15px in rows and cards, 16px in every input (under
  16px iOS zooms on focus). Secondary: 13px ink-soft. Labels above inputs:
  13px weight 600 ink-soft, sentence case, never uppercase.
- No tracked uppercase labels anywhere. No middle dots as separators;
  separate with spacing or line breaks. No em or en dashes.

## Surfaces and controls

- One radius family: cards 18px, inputs and buttons 14px, chips and
  avatars full pill. Never 8px anywhere.
- Cards: 14px padding, card colour, 1.5px hairline border, shadow
  `0 1px 2px rgba(26,23,20,0.05), 0 8px 24px rgba(26,23,20,0.06)` (dark:
  black at 0.4/0.5). Card head 8px above its rows; section heads 2px.
- Primary button: 52px tall, full width in sheets, pill, section colour
  background, white label 16px weight 700. Secondary: ink outline 1.5px on
  card colour. Pressed state: background darkens 8 percent (no transforms
  needed, animations are off on the owner's machine).
- Chips (paid-by, split, pool, filters): 34px tall pills, 12px side padding,
  14px label, 1.5px ink outline; selected = ink background with paper text,
  or the section colour when the chip carries that meaning. Chips wrap,
  never scroll horizontally, except the 7-day strip. Chip rows gap 6px.
- Segmented controls: 40px tall overall. Secondary pill buttons (Favorites,
  Archive, a day card's recipe link): 34 to 40px.
- Inputs: 52px tall, 1.5px border, 14px radius, card background, 16px text
  (prevents iOS zoom), focus border in section colour 2px.
- Sheets (mobile): bottom sheet with a 36x4 drag handle, 24px top radius,
  a 52px header row with title and Close, scrollable body, sticky action
  row. Fields stack 10px apart with a 4px gap under each label. Desktop:
  centred dialog 520px. Dismiss through a catch layer element.
- Rows in lists: 48px minimum with 6px vertical padding, 16px gutters,
  hairline between rows, whole row tappable with a chevron at the right.
  Title 15px weight 600, meta line 13px ink-soft with an 18px owner disc.
  A row that carries a control (a month bill's money field) grows to fit
  it; nothing tappable goes under 34px, and inputs stay at 44px or more.
- The 7-day strip: cells about 56px tall, letter 12px over date 17px over
  the dot. Grocery checkbox a 24px circle inside a 34px tap target.
- Icons: a small inline SVG set drawn once in `components/fresh/icons.tsx`,
  24px, 2px stroke, round caps and joins: home, pot, cart, receipt, box,
  key, plus, check, chevron-right, chevron-left, camera, mic, calendar,
  settings, refresh, moon, sun, x. No emoji anywhere in the fresh shell;
  the reused classic modals may be patched to accept an icon slot or
  their emoji hidden with CSS and replaced by text.

## Layout

Mobile (under 720px): sticky top bar 52px with the screen title left and a
pill cluster right (refresh, theme, settings). Bottom nav 56px plus safe
area, five items with icon over label, active in the section colour with
a 3px top indicator. Content has 16px gutters and 12px between blocks.
Primary action: pill FAB bottom-right above the nav, icon plus label
("Add expense"), section colour. Last content block ends with enough
padding to clear the nav and the FAB.

Desktop (720px and up): top bar 60px, left rail 240px with 40px items and
the same destinations plus Household settings, content padded 20px above
and 32px each side inside a 1240px shell. Two columns only on Expenses
(receipts left, settlement right) and Recipes (this week, next week), both
20px apart. Everything else one column at 680px max.

One density everywhere. The shopping list used to carry its own tighter
scale; those sizes are now the shell's, so there are no per-section size
overrides to keep in step.

## Screens

Home. First block is the Tonight card in the Recipes wash: day and date as
a small line, dish name in display type, cook as disc plus name, portions
and ingredient count, whole card tappable. If today has no dinner planned:
"Nothing planned for tonight" with a primary "Plan dinner" button. If a
no-meal day: "No shared dinner tonight" in ink-soft. Second block: Money,
titled "September" (current month), one row per person with disc, name and
the send or withdraw amount coloured by direction, then a footer line with
the household total. Tapping opens Expenses on Month. Third block: three
tappable counters side by side for Meals, House and Personal open grocery
counts, each with its pool colour as a 4px left bar. Fourth: Use soon,
items expiring within 3 days with an owner disc when owned and a day badge.

Recipes. Under the title, a segmented control This week / Next week. Below
it a 7-day strip (S M T W T F S) with the date number under each letter;
today is ringed; a planned day shows a filled dot in the cook's colour, a
no-meal day a hollow dot. Below, one block per day in order. Planned day:
card with a 6px left bar in the cook's colour, day name and date small,
dish name in display type, disc plus cook name, "3 portions", "6
ingredients", and a small secondary button "Add to grocery". Unplanned
day: dashed-outline row "Add dinner" with a quiet "No meal" text button at
the right. No-meal day: a muted row "No shared dinner" with "Plan" at the
right. Section header on the right shows the week's cook tally as person
discs with a count badge. Favorites and Archive as two secondary buttons
under the strip.

Grocery. Filter chips All / Meals / House / Personal. Then sections by pool
in the order Meals, House, Personal, each with its tag and count. Rows: a
24px circular checkbox, name, quantity in grams right-aligned in tabular
numerals, second line with store and requester disc. Checked rows move to
a Bought section at the bottom with a primary "Move n to inventory"
button. FAB "Add item" opens the sheet, which reuses the classic add form
logic with the fresh field styles (scan and dictate become icon buttons
with labels).

Expenses. Segmented Receipts / Month. Receipts: rows grouped by date with
a small date heading, each row store and description, payer disc, split
as small tags (Meals 3, Everyone, Personal), amount right in tabular bold.
Add sheet order: amount as a huge input with a $ prefix, paid-by as a row
of disc chips (disc plus name, selected fills in the person colour), split
chips with the split-receipt expander directly below, receipt as a large
dashed tile with the camera icon, then store, date, description. Month:
the settlement card first (one row per person, send or withdraw, tap a
row to reveal house/meals/bills/rent), then the reused bills editor.

Inventory. Search field, category chips, Use soon pinned when non-empty,
then rows grouped by category with quantity, expiry badge and owner disc.

More (mobile only): Inventory, Passwords, Household settings, Classic look,
each a row with icon and chevron.

## Rules that stand

- Animations are off on the owner's Windows machines; nothing may depend
  on a transition or keyframe.
- Every screen must work at 390x844, 1920x1080 and 2560x1400 at 1.5 scale,
  light and dark. Screenshots go in `smoke/out/fresh/` and get read.
- Both UIs share the data hook; classic stays untouched apart from the
  shared-kitchen fields.
