import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Constant-time string compare so wrong-length / wrong-content don't time-leak. */
function timingSafeEqual(a: string, b: string): boolean {
  // XOR each char up to the longer length so length doesn't short-circuit.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const expected = process.env.HOUSE_PASSWORD;
  if (!expected) return err("Password sign-in not configured", 500);

  const body = (await req.json().catch(() => null)) as
    | { password?: string }
    | null;
  const provided = (body?.password ?? "").toString();
  if (!provided) return err("Password required");

  if (!timingSafeEqual(provided, expected)) {
    return err("Wrong password", 401);
  }

  const token = await createSessionToken({ sub: "house", method: "password" });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return res;
}
