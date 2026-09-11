# Shared kitchen model

Why this exists: the household stopped being one food-sharing group. Some
members buy their own groceries, so a grocery receipt is no longer a
five-way expense, and the week's dinners no longer map to five cooks. Rent, utilities,
internet, insurance and house supplies are still shared by everyone.

The fix is two pieces of state, and everything else follows from them:

1. **Every expense carries allocations.** One receipt, one payer, one or more
   allocation lines. Each line says how much and who it was for, with the
   participant names snapshotted at entry time.
2. **One household setting, the meal group.** The current list of members
   who share dinners. It only provides defaults (the "Meals" preset and the
   cook dropdown). Because expense rows snapshot names, changing the group
   never rewrites history and no effective dates are needed.

## Data model (all additive, via `ensureTables`)

### expenses.allocations `JSONB NULL`

```ts
type AllocationKind = "house" | "meals" | "personal" | "custom";
type ExpenseAllocation = {
  kind: AllocationKind;
  amountCents: number;   // integer > 0
  splitAmong: string[];  // member names, deduped; [] when kind === "personal"
};
```

Invariants, enforced server-side in `lib/allocations.ts`:

- `sum(amountCents) === expense.amountCents`, every line `> 0`.
- `personal` lines have `splitAmong: []`. They are the payer's own items on
  a shared receipt: excluded from settlement entirely, and the payer is not
  credited for them.
- Every other kind needs a non-empty subset of `BUYERS`. If the client omits
  `splitAmong`, the server resolves it: `house` = all members, `meals` = the
  current meal group (an empty group means everyone), `custom` = error.
  If the client sends it, the server keeps it (this is what preserves an
  edited row's original snapshot). Names on that snapshot stay valid on
  edit even after the person has left the household, and a month's
  settlement roster is the current members plus anyone on its snapshots.
- `paidBy` must be a member.
- Legacy rows (`allocations IS NULL`) read as one `house` line for the full
  amount split among all members, which is exactly the old behaviour.

### household_settings key `meal_group`

`{ members: string[] }`. Empty or missing means "everyone", so the app
degrades to the old five-way model.

### grocery_items.pool `TEXT NOT NULL DEFAULT 'house'` and items.owner `TEXT NULL`

Both columns exist but are **unused**. Grocery and inventory went back to
the original model: one shared list and one shared shelf, grouped and
sorted by item category, with no per-pool or per-person tagging. Nothing in
the UI sets either field, so every grocery row is `house` and every item's
owner is empty. Merging ignores both — a grocery request merges into any
open row with the same normalized name, and an inventory add merges into
any row with the same normalized name. The columns stay because dropping
them is not additive; the API still accepts the fields.

Per-person accounting lives entirely in expense allocations (above).

### recipes: `portions INTEGER NULL`, `servings INTEGER NULL`, `no_meal BOOLEAN NOT NULL DEFAULT FALSE`; favorite_recipes: `servings INTEGER NULL`

- `servings` is the base the ingredient grams were written for (scraper
  reads `recipeYield`; otherwise the user fills it in).
- `portions` is how many are being cooked. Pushing to the grocery list
  scales grams by `portions / servings` when both are known. The recipe's
  own ingredient list is never rewritten.
- `no_meal` marks a day with no shared dinner. Such a row has an empty
  name/cook/ingredients, is hidden from the archive and favorites, and
  renders as a quiet card instead of an empty "add recipe" slot.

## Settlement (`lib/settlement.ts`, pure)

Per person, per month:

```
share = Σ allocation shares (largest-remainder cents over splitAmong)
      + share of recurring bills (largest-remainder over all members)
      + rent allocation
paid  = Σ (expense amount − personal lines) for expenses they paid
      + recurring bills flagged paidBy them
```

Send/withdraw against the joint account is unchanged: `share − paid`.
Sum of shares equals sum of paid plus what the joint account itself must
collect (rent and bills nobody fronted), to the cent.

Lines with the same participants are pooled for the month and split once,
so the rounding remainder is at most one cent per person per month rather
than accumulating across receipts. Against the household's real history
this keeps every past month within one cent of what the old five-way
formula displayed (verified on a restored copy, see
`docs/BACKUP_RESTORE.md`).

Per-person lines expose `house`, `meals`, `bills`, `rent` sub-totals so the
settlement card can show why shares differ.

## Worked example

Three meal-group members shop together, one pays $120. Receipt has $90 of
dinner groceries and $30 of house supplies.

| Line  | Amount | Split among    | Per head |
|-------|--------|----------------|----------|
| meals | $90    | the 3 diners   | $30      |
| house | $30    | all 5          | $6       |

Payer credited $120. The two non-diners owe $6 each. Co-shoppers owe $36.

Same trip, but the payer also bought $20 of their own snacks: add a
`personal` $20 line. Receipt total is $140, payer credited $120, nothing
else changes.

## Local development

`npm run dev:local` runs the app on :3100 against a throwaway Postgres in
Docker (`household-dev-pg`, port 5433) with a stub for the Apps Script
receipt/mirror webhook. Add `-- --reset` to drop the schema first. The
production Neon database is never touched by this process tree.
