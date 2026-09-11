import assert from "node:assert/strict";
import test from "node:test";

import { mergeAddedBy, normalizeName } from "./normalize";

// The grocery merge rule is "same normalized name": an incoming request tops
// up the open row it matches, whoever asked for it and whatever it is for.
test("the grocery merge key ignores case, spacing and plurals", () => {
  assert.equal(normalizeName("Eggs"), normalizeName("egg"));
  assert.equal(normalizeName("  Bell   Peppers "), normalizeName("bell pepper"));
  assert.equal(normalizeName("Chicken"), normalizeName("chickens"));
  assert.notEqual(normalizeName("Chicken"), normalizeName("Rice"));
});

test("merging a row keeps every requester", () => {
  assert.equal(mergeAddedBy("Arthur", "Eli"), "Arthur, Eli");
  assert.equal(mergeAddedBy("Arthur, Eli", "eli"), "Arthur, Eli");
  assert.equal(mergeAddedBy("", "Minh"), "Minh");
});
