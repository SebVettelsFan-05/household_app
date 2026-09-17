/**
 * Error types shared by the repo layer and the API routes.
 *
 * The rule: anything the user can cause by typing something wrong is a
 * `ValidationError` (400, message shown to the user); anything naming a row
 * that isn't there is a `NotFoundError` (404); everything else is a bug or an
 * outage and must never leak its message — the route logs it and answers with
 * one fixed sentence. A write that lost a race against another housemate is a
 * `ConflictError` (409, message shown, plus whatever the row holds now).
 */

import { NextResponse } from "next/server";
import { ReceiptStorageError } from "./receipts";

/** Bad user input. Safe to show the message to the user. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function isValidationError(e: unknown): e is ValidationError {
  return e instanceof ValidationError;
}

/** The request named a row that does not exist. */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * The write lost a race: the row changed since the client read it.
 *
 * `details` is merged into the error response so the client can show the
 * value that is actually stored (and the version to retry against) instead
 * of silently overwriting whatever the other housemate just saved.
 */
export class ConflictError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ConflictError";
    this.details = details;
  }
}

export const SERVER_ERROR_MESSAGE = "Something went wrong on the server";

/**
 * Status + user-facing message for a thrown error. Pure, so it can be tested
 * without a request context.
 */
export function describeApiError(e: unknown): {
  status: number;
  message: string;
} {
  if (e instanceof ValidationError) return { status: 400, message: e.message };
  if (e instanceof NotFoundError) return { status: 404, message: e.message };
  if (e instanceof ConflictError) return { status: 409, message: e.message };
  if (e instanceof ReceiptStorageError) {
    return { status: 502, message: e.message };
  }
  return { status: 500, message: SERVER_ERROR_MESSAGE };
}

/** The one error response every route's catch block returns. */
export function apiError(e: unknown): NextResponse {
  const { status, message } = describeApiError(e);
  // Only the generic 500 hides what happened, so only it needs a server log.
  if (status === 500) console.error(e);
  const body: Record<string, unknown> = { ok: false, error: message };
  if (e instanceof ConflictError) Object.assign(body, e.details);
  return NextResponse.json(body, { status });
}
