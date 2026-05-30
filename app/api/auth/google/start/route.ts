import { NextRequest, NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Kicks off the Google OAuth dance. We:
 *   1. Mint a random `state` to bind start ↔ callback (CSRF protection).
 *   2. Stash {state, next} in a short-lived httpOnly cookie so the callback
 *      can verify state and know where to send the user once signed in.
 *   3. 302 to Google's consent screen.
 *
 * The redirect_uri is derived from the request origin so localhost dev and
 * Vercel prod both work without an env var — just register both URLs in the
 * OAuth client.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new NextResponse("Google sign-in not configured", { status: 500 });
  }

  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const next = req.nextUrl.searchParams.get("next") || "/";
  const cookieValue = JSON.stringify({ state, next });

  const redirectUri = `${req.nextUrl.origin}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    // `select_account` shows the chooser even if the user is already signed
    // in to a single Google account — useful on shared phones.
    prompt: "select_account",
  });

  const res = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
  res.cookies.set(OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes — plenty for the consent screen
    path: "/api/auth",
  });
  return res;
}
