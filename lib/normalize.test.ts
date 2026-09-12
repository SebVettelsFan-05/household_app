import assert from "node:assert/strict";
import test from "node:test";

import { mergeAddedBy, normalizeName, titleCaseName } from "./normalize";

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

test("titleCaseName capitalises after an ampersand", () => {
  assert.equal(titleCaseName("t&t"), "T&T");
  assert.equal(titleCaseName("  no  frills "), "No Frills");
  assert.equal(titleCaseName("costco-wholesale"), "Costco-Wholesale");
});
