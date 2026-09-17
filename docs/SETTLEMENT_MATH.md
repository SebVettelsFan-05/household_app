# Settlement math, and what is proven about it

Every dollar the household settles goes through `computeSettlement` in
`lib/settlement.ts`, fed by the allocation lines validated in
`lib/allocations.ts`. Both are pure. This note states what the numbers
mean and the invariants the tests enforce, so the math can be audited
without reading code.

## Definitions

- A **receipt** has one payer and one or more **lines**. A line is
  `house`, `meals`, `custom` or `personal`, with an amount and a snapshot
  of the names it is split among. Lines must sum to the receipt.
- A **personal** line is the payer's own shopping on a shared receipt. It
  is not shared: nobody is charged for it and the payer is not credited.
- The **roster** for a month is the current members plus any name that
  appears on a snapshot or as a payer that month. Someone who moved out
  still settles the months they were here.
- A **bill** (internet, insurance, utilities) is split over the current
  members; the month's bills are pooled and split once, so the leftover
  cents spread fairly. A bill flagged `paidBy` was fronted by that person.
- **Rent** is per person, never split.

## What each person is charged and credited

```
share(p) = house(p) + meals(p) + bills(p) + rent(p)
paid(p)  = sum of shared lines on receipts p paid  (personal excluded)
         + bills flagged paidBy p
send(p)     = share(p) - paid(p)   when positive
withdraw(p) = paid(p) - share(p)   when positive
```

Lines with the same kind and the same participants are pooled for the
month and split once with largest-remainder rounding: everyone in the pool
gets `floor(total / n)` and the first `total mod n` names in roster order
get one cent more. Pooling keeps each person's rounding error to at most
one cent per pool for the whole month, and makes the result independent
of the order receipts were entered.

## Invariants, each enforced by `lib/settlement.invariants.test.ts` on
## 2000 randomised months against an exact-fraction reference

1. **Conservation.** `sum(share) = shared lines + bills + rent`. Every
   shared cent is charged exactly once. No cent is lost, none doubled.
2. **Credit.** `paid(p)` equals exactly the shared part of the receipts
   `p` fronted plus the bills flagged as fronted by `p`. Credited once.
3. **Only participants pay.** A person outside a line's participants owes
   exactly zero for it. A person on no line has `house + meals = 0`.
4. **Fair rounding.** Within a pool, no two participants differ by more
   than a cent; a person's total is within (number of pools they are in)
   cents of the exact fraction.
5. **Personal lines are invisible.** Removing every personal line from a
   month changes nothing in the settlement.
6. **Order independence.** Reversing the receipt order gives an identical
   result.
7. **Joint account.** `sum(send) - sum(withdraw)` equals rent plus the
   bills nobody fronted: exactly what the joint account pays out, so it
   neither accumulates nor runs short.
8. **Nothing falls through.** A shared line whose snapshot names nobody
   the roster can place is charged to the whole household rather than
   silently eaten by the payer (unreachable through the app, which
   validates every write, but guaranteed anyway).

Plus, on the write path (`normalizeAllocations`, 500 random receipts):
lines always sum to the receipt or the write is refused; `house` resolves
to all members, `meals` to the current meal group (everyone when the
group is empty), `custom` keeps exactly the chosen names, `personal` has
none; unknown names are refused on a new receipt and kept on an edited one
(so a snapshot with a departed member round-trips untouched).

On the edit path (`lib/allocationEditor.test.ts`): an untouched line
sends its stored snapshot back unchanged; re-picking a line's kind sends
no snapshot so the server re-resolves it; a fresh add never sends a
snapshot for house or meals.

## Write gates

The math above only holds if the stored rows stay sane, so the server
refuses the writes that would break it. None of these are client-side
checks: every one is enforced in `lib/repo.ts` or `lib/settingsShape.ts`,
where a hand-rolled request lands too.

- **Lines must sum to the receipt.** `normalizeAllocations` re-checks the
  split against the row's final amount on both add and edit; a total that
  doesn't match is a 400, never a stored row.
- **Dates are in the current month only.** A future date would sit in the
  receipts total but in no settlement month; a past date would land in a
  month already paid. Both are refused, in the household timezone.
- **Past months are immutable.** Editing or deleting a receipt whose month
  has passed answers 400 "Past months are locked" — the settlement for that
  month is what the household actually sent each other.
- **Settings writes are versioned.** `GET /api/settings/:key` returns the
  row's `updatedAt`; a `PUT` that sends it back as `expectedUpdatedAt` is
  applied only against that version, and otherwise answers 409 with the
  value that is stored now. Two housemates saving the bills page at once can
  no longer erase each other.
- **Duplicate bill names are refused.** Two fixed bills whose names match
  case-insensitively would both be charged and could not be told apart, so
  the write is a 400.

## Worked month (also asserted end to end in the smoke suite through the
## real API and both settlement views)

Meal group: Arthur, Eli, Minh. Rent: Arthur 800, Daniel 800, Eli 700,
Ibrahim 700, Minh 700. Internet 89.99 paid by Arthur. Insurance 32.50
from the joint account.

| Receipt | Payer | Lines |
|---|---|---|
| Costco 140.00 | Arthur | meals 90.00, house 30.00, personal 20.00 |
| No Frills 43.80 | Eli | meals 43.80 |
| Pizza 58.20 | Daniel | custom 58.20 among Daniel, Eli, Minh |
| Shoppers 31.45 | Minh | house 31.45 |

Pools: meals(A,E,M) = 133.80 → 44.60 each. house(all) = 61.45 → 12.29 each
(12.29 × 5 = 61.45 exactly). custom(D,E,M) = 58.20 → 19.40 each. Bills
pooled: 89.99 + 32.50 = 122.49 over five = 24.50 / 24.50 / 24.50 / 24.50 /
24.49.

Custom lines count under "house" in the per-person breakdown.

| Person | house | meals | bills | rent | share | paid | result |
|---|---|---|---|---|---|---|---|
| Arthur | 12.29 | 44.60 | 24.50 | 800 | 881.39 | 120.00 + 89.99 = 209.99 | send 671.40 |
| Daniel | 31.69 | 0 | 24.50 | 800 | 856.19 | 58.20 | send 797.99 |
| Eli | 31.69 | 44.60 | 24.50 | 700 | 800.79 | 43.80 | send 756.99 |
| Ibrahim | 12.29 | 0 | 24.50 | 700 | 736.79 | 0 | send 736.79 |
| Minh | 31.69 | 44.60 | 24.49 | 700 | 800.78 | 31.45 | send 769.33 |

Checks: shares sum to 4075.94 = shared 253.45 + bills 122.49 + rent 3700.
Sends sum to 3732.50 = rent 3700 + insurance 32.50, the joint account's
outgoings. Arthur's 20.00 personal line appears nowhere. Ibrahim, outside
the meal group and the pizza, pays only house, bills and rent.

## Bill editing rules (client, `lib/monthlyBills.ts`)

- A bill name is unique across both lists and every month, case-insensitive:
  adding "Parking" as a fixed bill while a "Parking" utility exists, or in
  another month, is refused with a message naming the existing one. Two
  same-named fixed bills that already exist are merged on load (earliest
  survives, schedules merged) so nothing is charged twice. A bill retired
  before the month being edited can be re-added under its name, which
  reactivates it from that month.
- "Stop from this month forward" on a utility drops its amounts for this
  and every later month, then retires the line (or deletes it when no
  earlier month recorded an amount). A retired line is never revived by
  leftover amounts.
- Editing a current or future month rewrites only that month's schedule
  entry; later entries stay.
- Bill saves carry the version they were loaded from. If someone else saved
  first, the save is refused, the screen shows their version, and a toast
  says so; nothing is silently overwritten. Saves from one device queue so
  a device cannot conflict with itself.
- The month is not editable until the shared bills have loaded, so an edit
  can never be made against a stale snapshot.
