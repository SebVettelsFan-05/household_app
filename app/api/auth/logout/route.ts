import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

function clearAndRespond(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}

export async function POST() {
  return clearAndRespond(NextResponse.json({ ok: true }));
}

/** Convenience: navigating to /api/auth/logout signs you out + lands on /login. */
export async function GET(req: NextRequest) {
  return clearAndRespond(NextResponse.redirect(new URL("/login", req.url)));
}
