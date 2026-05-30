"use client";

import { useEffect, useState } from "react";

/**
 * Sign-in page — two side-by-side ways in:
 *   • Continue with Google (account must be on the allowlist)
 *   • House password (shared HOUSE_PASSWORD env var)
 *
 * The page reads `next` from the query string so we send the user back to
 * wherever middleware bounced them from, and surfaces any `error` query
 * param the OAuth callback may have redirected with.
 */
export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [next, setNext] = useState("/");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const n = params.get("next");
    if (n && n.startsWith("/")) setNext(n);
    const e = params.get("error");
    if (e) setErr(e);
  }, []);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = next;
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      setErr(body?.error || "Wrong password");
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  const googleHref = `/api/auth/google/start?next=${encodeURIComponent(next)}`;

  return (
    <main className="login-bg">
      <div className="login-card">
        <h1 className="login-title">Household</h1>
        <p className="login-sub">Sign in to continue</p>

        <a className="login-google" href={googleHref}>
          <span className="login-google-glyph" aria-hidden="true">
            G
          </span>
          Continue with Google
        </a>

        <div className="login-divider">
          <span>or</span>
        </div>

        <form className="login-form" onSubmit={submitPassword}>
          <input
            className="login-input"
            type="password"
            placeholder="House password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            disabled={busy}
          />
          <button
            type="submit"
            className="login-btn"
            disabled={busy || !password.trim()}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {err ? <p className="login-error">{err}</p> : null}
      </div>
    </main>
  );
}
