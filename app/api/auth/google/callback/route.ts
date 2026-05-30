import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  isAllowedEmail,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Handles Google's redirect back from the consent screen:
 *   1. Verifies the state cookie matches the ?state param (CSRF).
 *   2. Exchanges the authorization code for an id_token.
 *   3. Decodes the id_token, checks iss/aud, then matches email against the
 *      hardcoded allowlist. (We received the token directly from Google over
 *      HTTPS in response to our own auth-code request, so we trust the
 *      payload without re-verifying the JWT signature against JWKS.)
 *   4. Issues the same session cookie shape the password flow uses.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return loginErrorRedirect(req, "Google sign-in not configured");
  }

  const params = req.nextUrl.searchParams;
  const errorParam = params.get("error");
  if (errorParam) {
    return loginErrorRedirect(req, `Google denied (${errorParam})`);
  }
  const code = params.get("code");
  const stateParam = params.get("state");
  if (!code || !stateParam) {
    return loginErrorRedirect(req, "Bad OAuth response");
  }

  const stateCookie = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!stateCookie) {
    return loginErrorRedirect(req, "Sign-in expired — try again");
  }
  let parsedState: { state: string; next: string };
  try {
    parsedState = JSON.parse(stateCookie);
  } catch {
    return loginErrorRedirect(req, "Bad state cookie");
  }
  if (parsedState.state !== stateParam) {
    return loginErrorRedirect(req, "State mismatch");
  }

  // Exchange the auth code for an id_token.
  const redirectUri = `${req.nextUrl.origin}/api/auth/google/callback`;
  let tokenJson: { id_token?: string; error?: string };
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    tokenJson = (await tokenRes.json()) as typeof tokenJson;
    if (!tokenRes.ok) {
      return loginErrorRedirect(
        req,
        `Google token exchange failed: ${tokenJson.error || tokenRes.status}`
      );
    }
  } catch (e) {
    return loginErrorRedirect(
      req,
      `Couldn't reach Google: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (!tokenJson.id_token) {
    return loginErrorRedirect(req, "Google didn't return an id_token");
  }

  // Decode the id_token payload.
  const parts = tokenJson.id_token.split(".");
  if (parts.length !== 3) {
    return loginErrorRedirect(req, "Malformed id_token");
  }
  let idPayload: {
    email?: string;
    email_verified?: boolean;
    iss?: string;
    aud?: string;
  };
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 ? 4 - (padded.length % 4) : 0;
    idPayload = JSON.parse(atob(padded + "=".repeat(pad)));
  } catch {
    return loginErrorRedirect(req, "Couldn't decode id_token");
  }

  if (
    idPayload.iss !== "https://accounts.google.com" &&
    idPayload.iss !== "accounts.google.com"
  ) {
    return loginErrorRedirect(req, "Unexpected issuer");
  }
  if (idPayload.aud !== clientId) {
    return loginErrorRedirect(req, "Wrong audience");
  }

  const email = (idPayload.email || "").toLowerCase().trim();
  if (!idPayload.email_verified || !email) {
    return loginErrorRedirect(req, "Email not verified");
  }
  if (!isAllowedEmail(email)) {
    return loginErrorRedirect(req, "This Google account isn't on the allowlist");
  }

  const token = await createSessionToken({ sub: email, method: "google" });
  // Resolve `next` relative to our origin so a malicious cookie can't redirect
  // off-site after a successful sign-in.
  const safeNext =
    parsedState.next && parsedState.next.startsWith("/") ? parsedState.next : "/";
  const res = NextResponse.redirect(new URL(safeNext, req.url));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}

function loginErrorRedirect(req: NextRequest, reason: string): NextResponse {
  const url = new URL("/login", req.url);
  url.searchParams.set("error", reason);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
