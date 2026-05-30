import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * Edge middleware that gates the entire app behind a session cookie.
 *
 * Public paths (excluded via `config.matcher` below):
 *   - /login                     — the sign-in page itself
 *   - /api/auth/*                — password + Google OAuth endpoints
 *   - /_next/*                   — Next's static assets
 *   - anything with a "." in it  — favicon, icons, robots.txt, …
 *
 * Everything else demands a valid `hh_session` cookie. Page requests get
 * redirected to /login (with ?next=<path>) so the user lands back where they
 * came from after signing in. API requests get a plain 401 so the client can
 * decide what to do.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (session) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  const loginUrl = new URL("/login", req.url);
  if (pathname && pathname !== "/") {
    loginUrl.searchParams.set("next", pathname + (search || ""));
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Everything EXCEPT auth endpoints, the login page, Next's asset pipeline,
    // and any path that looks like a static file (contains a dot).
    "/((?!api/auth/|login|_next/|.*\\..*).*)",
  ],
};
