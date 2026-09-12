import assert from "node:assert/strict";
import test from "node:test";

import {
  describeApiError,
  isValidationError,
  NotFoundError,
  SERVER_ERROR_MESSAGE,
  ValidationError,
} from "./errors";
import { ReceiptStorageError } from "./receipts";

test("validation errors answer 400 with their own message", () => {
  const d = describeApiError(new ValidationError("Quantity must be > 0"));
  assert.equal(d.status, 400);
  assert.equal(d.message, "Quantity must be > 0");
});

test("missing rows answer 404", () => {
  assert.deepEqual(describeApiError(new NotFoundError()), {
    status: 404,
    message: "Not found",
  });
});

test("receipt storage outages answer 502 with their message", () => {
  const d = describeApiError(new ReceiptStorageError("Drive is down"));
  assert.equal(d.status, 502);
  assert.equal(d.message, "Drive is down");
});

test("anything else answers 500 and never leaks the real message", () => {
  const sql = new Error('invalid input syntax for type uuid: "nope"');
  const d = describeApiError(sql);
  assert.equal(d.status, 500);
  assert.equal(d.message, SERVER_ERROR_MESSAGE);
  assert.ok(!d.message.includes("uuid"));
});

test("non-Error throws still answer 500", () => {
  assert.deepEqual(describeApiError("boom"), {
    status: 500,
    message: SERVER_ERROR_MESSAGE,
  });
});

test("isValidationError only recognises validation errors", () => {
  assert.equal(isValidationError(new ValidationError("x")), true);
  assert.equal(isValidationError(new Error("x")), false);
  assert.equal(isValidationError(new NotFoundError()), false);
});
