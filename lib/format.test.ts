import assert from "node:assert/strict";
import { test } from "node:test";
import { daysUntil, expiryStatus, fmtQty } from "./format";

// 23:30 in Toronto on the 10th, already the 11th in UTC. A browser clock
// would call the 11th "today"; the household calendar says tomorrow.
const LATE_EVENING = new Date("2026-09-11T03:30:00Z");
// 00:30 in Toronto on the 11th, still the 10th in UTC.
const AFTER_MIDNIGHT = new Date("2026-09-11T04:30:00Z");

test("fmtQty switches to kg at a kilo", () => {
  assert.deepEqual(fmtQty(750), { num: "750", unit: "g" });
  assert.deepEqual(fmtQty(1000), { num: "1", unit: "kg" });
  assert.deepEqual(fmtQty(1500), { num: "1.5", unit: "kg" });
});

test("days until an expiry are counted in the household timezone", () => {
  assert.equal(daysUntil("2026-09-10", LATE_EVENING), 0);
  assert.equal(daysUntil("2026-09-11", LATE_EVENING), 1);
  assert.equal(daysUntil("2026-09-11", AFTER_MIDNIGHT), 0);
  assert.equal(daysUntil("2026-09-10", AFTER_MIDNIGHT), -1);
  assert.equal(daysUntil("", LATE_EVENING), null);
  assert.equal(daysUntil("not a date", LATE_EVENING), null);
});

test("expiry badges read off the household calendar, not the browser clock", () => {
  // The bug this pins: at 23:30 Toronto the browser is already on the 11th in
  // UTC, and the badge for the 11th used to read "Expires today".
  assert.deepEqual(expiryStatus("2026-09-11", LATE_EVENING), {
    label: "Expires tomorrow",
    cls: "expiring",
  });
  assert.deepEqual(expiryStatus("2026-09-10", LATE_EVENING), {
    label: "Expires today",
    cls: "expiring",
  });
  assert.deepEqual(expiryStatus("2026-09-11", AFTER_MIDNIGHT), {
    label: "Expires today",
    cls: "expiring",
  });
  assert.deepEqual(expiryStatus("2026-09-09", AFTER_MIDNIGHT), {
    label: "Expired 2d ago",
    cls: "expired",
  });
  assert.deepEqual(expiryStatus("2026-09-13", LATE_EVENING), {
    label: "Expires in 3d",
    cls: "expiring",
  });
  assert.deepEqual(expiryStatus("2026-09-30", LATE_EVENING), {
    label: "Expires 2026-09-30",
    cls: "",
  });
  assert.deepEqual(expiryStatus("", LATE_EVENING), { label: "", cls: "" });
});
