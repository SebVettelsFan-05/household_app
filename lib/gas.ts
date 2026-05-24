import type { ApiResponse } from "./types";

const GAS_URL = process.env.GAS_API_URL;

if (!GAS_URL) {
  // Surfaces at first request if env is missing — easier to debug than a silent fetch failure.
  console.warn("[gas] GAS_API_URL is not set. Configure it in .env.local");
}

type Params = Record<string, string | number | undefined>;

export async function callGas<T>(
  action: string,
  params: Params = {}
): Promise<ApiResponse<T>> {
  if (!GAS_URL) {
    return { ok: false, error: "Server is missing GAS_API_URL env variable." };
  }
  const qs = new URLSearchParams({ action });
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const s = String(v);
    if (s === "") continue;
    qs.set(k, s);
  }
  // Apps Script returns a 302 to a googleusercontent.com URL; fetch follows it by default.
  const res = await fetch(`${GAS_URL}?${qs.toString()}`, {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
  });
  if (!res.ok) {
    return { ok: false, error: `Upstream HTTP ${res.status}` };
  }
  const data = (await res.json()) as ApiResponse<T>;
  return data;
}
