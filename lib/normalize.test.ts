import assert from "node:assert/strict";
import test from "node:test";

import {
  addedByIncludes,
  firstAddedBy,
  groceryRowsMerge,
  normalizeName,
} from "./normalize";

const row = (norm: string, pool: string, addedBy: string) => ({
  norm,
  pool,
  addedBy,
});

test("grocery merge is scoped to the pool", () => {
  const chicken = normalizeName("Chicken");
  // Same name, different pools: two separate lines. This is the whole point
  // of the pool — the dinner chicken and the house chicken are not one row.
  assert.equal(
    groceryRowsMerge(row(chicken, "meals", "Arthur"), row(chicken, "house", "Eli")),
    false
  );
  assert.equal(
    groceryRowsMerge(row(chicken, "meals", "Arthur"), row(chicken, "meals", "Eli")),
    true
  );
  assert.equal(
    groceryRowsMerge(row(chicken, "house", "Arthur"), row(normalizeName("Rice"), "house", "Eli")),
    false
  );
});

test("personal rows merge only for someone already on the row", () => {
  const chicken = normalizeName("Chicken");
  // Eli's own chicken must not absorb Minh's own chicken...
  assert.equal(
    groceryRowsMerge(row(chicken, "personal", "Minh"), row(chicken, "personal", "Eli")),
    false
  );
  // ...but Eli asking twice tops up the line he already has.
  assert.equal(
    groceryRowsMerge(row(chicken, "personal", "Eli"), row(chicken, "personal", "Eli")),
    true
  );
  // A row two people already share accepts either of them.
  assert.equal(
    groceryRowsMerge(row(chicken, "personal", "Minh"), row(chicken, "personal", "Eli, Minh")),
    true
  );
});

test("plural and case differences still merge within a pool", () => {
  assert.equal(
    groceryRowsMerge(
      row(normalizeName("Eggs"), "house", "Arthur"),
      row(normalizeName("egg"), "house", "Daniel")
    ),
    true
  );
});

test("addedBy list helpers", () => {
  assert.equal(addedByIncludes("Arthur, Eli", "eli"), true);
  assert.equal(addedByIncludes("Arthur, Eli", "Minh"), false);
  assert.equal(addedByIncludes("Arthur", ""), false);
  assert.equal(firstAddedBy("Eli, Minh"), "Eli");
  assert.equal(firstAddedBy(" , Minh"), "Minh");
  assert.equal(firstAddedBy(""), "");
});
