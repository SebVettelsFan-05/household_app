/**
 * Auth primitives — session token (HMAC-signed cookie) + email allowlist for
 * the Google OAuth path. Designed to work in Edge runtime (middleware) and
 * Node runtime (route handlers) without changes.
 *
 * Two ways in:
 *   1. House password — anyone with HOUSE_PASSWORD gets a "house" session.
 *   2. Google OAuth — email must match ALLOWED_EMAILS exactly.
 * Both write the same cookie shape, so middleware doesn't care which was used.
 */

export type Session = {
  sub: string; // "house" for shared password, or the verified email
  method: "password" | "google";
  exp: number; // unix seconds
};

export const SESSION_COOKIE = "hh_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const OAUTH_STATE_COOKIE = "hh_oauth_state";

// Allowlist for the Google OAuth path. Lowercase compare. Anyone signing in
// with Google whose email isn't in here gets bounced back to /login.
const ALLOWED_EMAILS = new Set<string>([
  "arthur.susanto@gmail.com",
  "andywang671738@gmail.com",
  "elisheldrake@gmail.com",
  "ibrkhalid11@gmail.com",
  "mtdminhtuando@gmail.com",
]);

export function isAllowedEmail(email: string): boolean {
  return ALLOWED_EMAILS.has(email.toLowerCase().trim());
}

const enc = new TextEncoder();

function b64urlEncodeBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlEncodeStr(str: string): string {
  return b64urlEncodeBytes(enc.encode(str));
}

function b64urlDecodeStr(b64: string): string {
  const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return atob(padded);
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64urlEncodeBytes(new Uint8Array(sig));
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short (need at least 16 chars). " +
        "Generate one with `openssl rand -base64 32` and set it in Vercel + .env.local."
    );
  }
  return s;
}

export async function createSessionToken(
  s: Omit<Session, "exp">,
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  const payload: Session = {
    ...s,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = b64urlEncodeStr(JSON.stringify(payload));
  const sig = await hmacSign(getSecret(), payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifySessionToken(
  token: string | undefined | null
): Promise<Session | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  let expected: string;
  try {
    expected = await hmacSign(getSecret(), payloadB64);
  } catch {
    // Secret missing — fail closed.
    return null;
  }
  if (!constantTimeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(b64urlDecodeStr(payloadB64)) as Session;
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    if (payload.method !== "password" && payload.method !== "google") return null;
    return payload;
  } catch {
    return null;
  }
}

/** Constant-time string compare for HMAC sigs. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
