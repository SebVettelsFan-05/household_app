import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  AXIS_LOCK_PX,
  DELETE_MAX_PX,
  DELETE_MIN_PX,
  REVEAL_WIDTH,
  axisDecision,
  buttonRight,
  clampOffset,
  deleteThreshold,
  isArmed,
  maxOffset,
  releaseOutcome,
} from "./swipe";

test("nothing is decided inside the lock distance", () => {
  assert.equal(axisDecision(0, 0), "pending");
  assert.equal(axisDecision(-9, 0), "pending");
  assert.equal(axisDecision(0, 9), "pending");
  assert.equal(axisDecision(-6, 6), "pending");
});

test("past the lock distance the larger travel wins", () => {
  assert.equal(axisDecision(-AXIS_LOCK_PX, 0), "horizontal");
  assert.equal(axisDecision(-30, 10), "horizontal");
  // A rightward swipe locks horizontally too: it is how an open row shuts.
  assert.equal(axisDecision(30, 10), "horizontal");
  assert.equal(axisDecision(-10, 40), "abandon");
  assert.equal(axisDecision(0, -12), "abandon");
  // A perfect diagonal is not horizontal, so the page keeps scrolling.
  assert.equal(axisDecision(-20, 20), "abandon");
});

test("the delete threshold is 45 percent of the row, clamped both ends", () => {
  // 45% lands between the clamps on a phone-width row.
  assert.equal(deleteThreshold(390), 175.5);
  assert.equal(deleteThreshold(400), 180);
  // Narrow rows float up to the minimum.
  assert.equal(deleteThreshold(200), DELETE_MIN_PX);
  assert.equal(deleteThreshold(0), DELETE_MIN_PX);
  // Wide desktop rows stop at the maximum rather than half the screen.
  assert.equal(deleteThreshold(1200), DELETE_MAX_PX);
  assert.equal(deleteThreshold(680), DELETE_MAX_PX);
  // The clamp boundaries themselves.
  assert.equal(deleteThreshold(DELETE_MIN_PX / 0.45), DELETE_MIN_PX);
  assert.equal(deleteThreshold(DELETE_MAX_PX / 0.45), DELETE_MAX_PX);
});

test("a row never travels further than one reveal past the threshold", () => {
  assert.equal(maxOffset(390), 175.5 + REVEAL_WIDTH);
  // Even a row narrower than the minimum threshold can still reach it.
  assert.ok(maxOffset(120) > deleteThreshold(120));
});

test("offsets clamp at nothing and at the row's travel", () => {
  assert.equal(clampOffset(-50, 390), 0);
  assert.equal(clampOffset(0, 390), 0);
  assert.equal(clampOffset(40, 390), 40);
  assert.equal(clampOffset(9999, 390), maxOffset(390));
});

test("releasing snaps shut, snaps open, or deletes", () => {
  const w = 390;
  assert.equal(releaseOutcome(0, w), "closed");
  assert.equal(releaseOutcome(27.9, w), "closed");
  assert.equal(releaseOutcome(28, w), "open");
  assert.equal(releaseOutcome(REVEAL_WIDTH, w), "open");
  assert.equal(releaseOutcome(175.4, w), "open");
  assert.equal(releaseOutcome(175.5, w), "delete");
  assert.equal(releaseOutcome(maxOffset(w), w), "delete");
});

test("a wide row needs the clamped 220px, not 45 percent of itself", () => {
  const w = 1200;
  assert.equal(releaseOutcome(219, w), "open");
  assert.equal(releaseOutcome(220, w), "delete");
});

test("armed is exactly the range that deletes on release", () => {
  const w = 390;
  assert.equal(isArmed(0, w), false);
  assert.equal(isArmed(REVEAL_WIDTH, w), false);
  assert.equal(isArmed(175.4, w), false);
  assert.equal(isArmed(175.5, w), true);
  assert.equal(isArmed(240, w), true);
});

test("the button centres in the strip, then rides the row's edge", () => {
  // Centred: (64 - 44) / 2.
  assert.equal(buttonRight(0), 10);
  assert.equal(buttonRight(REVEAL_WIDTH), 10);
  // Past the strip it keeps the same 10px gap from the trailing edge.
  assert.equal(buttonRight(100), 46);
  assert.equal(buttonRight(200), 146);
});
