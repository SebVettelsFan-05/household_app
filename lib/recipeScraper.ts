/**
 * Recipe link → structured data scraper.
 *
 * Two layered problems, two layered answers:
 *
 * 1. FETCHING. Lots of recipe sites sit behind WAFs that 403 anything that
 *    smells automated. We try, in order:
 *      a. realistic browser headers (fixes plain UA-sniffing sites)
 *      b. the honest FridgeBot UA (some WAFs allow declared bots)
 *      c. the Wayback Machine's newest snapshot (rescues hard blockers like
 *         the Dotdash sites, whose TLS fingerprinting we can't beat directly)
 *
 * 2. EXTRACTING. JSON-LD covers most sites but not all, and is frequently
 *    malformed. Strategies, in order of trustworthiness:
 *      a. JSON-LD (tolerant parsing + deep walk, not just @graph)
 *      b. schema.org microdata (itemprop="recipeIngredient")
 *      c. embedded app-state JSON (__NEXT_DATA__ and friends)
 *      d. recipe-plugin HTML (WPRM / Tasty Recipes / Mediavine / generic li)
 *
 * If everything fails we throw a RecipeScrapeError whose message tells the
 * user what actually happened (blocked vs. missing vs. timeout) and points
 * them at the paste-ingredients fallback.
 */

import { lookup } from "node:dns/promises";

import { decodeHtmlEntities, htmlToText } from "./htmlText";

export type RecipeSource =
  | "json-ld"
  | "microdata"
  | "embedded-json"
  | "recipe-html"
  | "page-meta";

export type ScrapedRecipe = {
  name?: string;
  description?: string;
  // Raw ingredient strings as they appeared on the site, e.g. "2 tbsp olive
  // oil" or "500g chicken thighs". Quantity parsing happens elsewhere.
  ingredients: string[];
  // Base servings the ingredient amounts were written for, from
  // schema.org `recipeYield`. Undefined when the site didn't say.
  servings?: number;
  // Which extraction strategy produced the data — handy when debugging a
  // problem site, and surfaced to the client for transparency.
  source?: RecipeSource;
};

/**
 * Servings out of a schema.org `recipeYield`, which is one of the least
 * disciplined fields on the web: "4 servings", "Serves 6", ["4", "4 rolls"],
 * 4, "4-6 servings". We take the first integer we can find and ignore
 * anything outside a plausible household range, so a yield of "24 cookies"
 * never turns into a 24× ingredient scale-up by accident.
 */
export function parseServings(raw: unknown): number | undefined {
  const candidates = Array.isArray(raw) ? raw : [raw];
  for (const candidate of candidates) {
    if (typeof candidate === "number") {
      if (Number.isInteger(candidate) && candidate >= 1 && candidate <= 100) {
        return candidate;
      }
      continue;
    }
    if (typeof candidate !== "string") continue;
    const m = /\d+/.exec(candidate);
    if (!m) continue;
    const n = Number(m[0]);
    if (n < 1 || n > 100) continue;
    // "24 cookies" or "12 muffins" is a piece count, not people fed. Only
    // trust large numbers when the text says it is about servings.
    const aboutPeople = /serv|people|person|portion|feeds|yield/i.test(candidate);
    if (n > 12 && !aboutPeople) continue;
    return n;
  }
  return undefined;
}

export class RecipeScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeScrapeError";
  }
}

// Cap how much HTML we're willing to chew through. Recipe pages are big
// (ads, inlined CSS) but legitimate ones stay under ~2–3 MB.
const MAX_HTML = 5_000_000;

// Cap on what we're willing to pull off the wire, enforced while reading
// rather than after: `res.text()` buffers the whole body first, so a URL
// pointing at a multi-gigabyte file would be fully downloaded into memory
// before anything got truncated.
const MAX_BODY_BYTES = 4_000_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BOT_UA =
  "Mozilla/5.0 (compatible; FridgeBot/1.0; +https://github.com/SebVettelsFan-05/household_app)";

function browserHeaders(): Record<string, string> {
  return {
    "user-agent": BROWSER_UA,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "sec-ch-ua":
      '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "cross-site",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    referer: "https://www.google.com/",
  };
}

function botHeaders(): Record<string, string> {
  return {
    "user-agent": BOT_UA,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
}

/* ========================= Outbound address guard ========================= */

/**
 * The scraper fetches a URL the user typed, from inside our network. Without
 * a guard that is a server-side request forgery hole: "http://127.0.0.1:4321/"
 * or "http://10.0.0.1/" would have us fetch an internal service and hand the
 * response back. Every outbound request — each ladder level and every
 * redirect hop — goes through `assertPublicUrl` first.
 */
export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAddressError";
  }
}

// Plain web ports only. Anything else is a service, not a recipe site.
const ALLOWED_PORTS = new Set(["", "80", "443"]);

// Redirect chains are followed by hand so each hop can be re-checked; a site
// that needs more than this many hops is broken, not shy.
const MAX_REDIRECTS = 5;

function parseIpv4(input: string): number[] | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function parseIpv6(input: string): number[] | null {
  let text = input;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(":")) return null;

  // A trailing dotted quad ("::ffff:127.0.0.1") is two more 16-bit groups.
  if (text.includes(".")) {
    const cut = text.lastIndexOf(":");
    const v4 = parseIpv4(text.slice(cut + 1));
    if (!v4) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, cut + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let parts: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    parts = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    parts = [...head, ...Array<string>(fill).fill("0"), ...tail];
  }

  const out: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    out.push(parseInt(part, 16));
  }
  return out;
}

function isPrivateIpv4(a: number[]): boolean {
  if (a[0] === 0) return true; // 0.0.0.0/8 — "this network"
  if (a[0] === 10) return true; // private
  if (a[0] === 127) return true; // loopback
  if (a[0] === 100 && a[1] >= 64 && a[1] <= 127) return true; // 100.64/10 CGNAT
  if (a[0] === 169 && a[1] === 254) return true; // link-local (incl. metadata)
  if (a[0] === 172 && a[1] >= 16 && a[1] <= 31) return true; // private
  if (a[0] === 192 && a[1] === 168) return true; // private
  if (a[0] >= 224) return true; // 224/4 multicast and 240/4 reserved
  return false;
}

/** The IPv4 address embedded in the two 16-bit groups `hi`:`lo`. */
function embeddedIpv4(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function isPrivateIpv6(g: number[]): boolean {
  // ::ffff:a.b.c.d (IPv4-mapped) and the deprecated ::a.b.c.d both smuggle an
  // IPv4 address through an IPv6 literal — judge them by the address inside.
  const firstFiveZero = g.slice(0, 5).every((x) => x === 0);
  if (firstFiveZero && (g[5] === 0xffff || g[5] === 0)) {
    const embedded = embeddedIpv4(g[6], g[7]);
    if (g[5] === 0xffff) return isPrivateIpv4(embedded);
    // ::  and ::1 are the unspecified and loopback addresses.
    if (g[6] === 0 && g[7] <= 1) return true;
    if (g[6] !== 0 || g[7] !== 0) return isPrivateIpv4(embedded);
  }
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // 6to4: 2002:<v4>::/16 reaches the embedded IPv4 address, so a 6to4
  // address wrapping 10.0.0.1 is just another way to spell 10.0.0.1.
  if (g[0] === 0x2002) return isPrivateIpv4(embeddedIpv4(g[1], g[2]));
  // NAT64: 64:ff9b::/96 carries the IPv4 destination in the low 32 bits.
  if (
    g[0] === 0x0064 &&
    g[1] === 0xff9b &&
    g[2] === 0 &&
    g[3] === 0 &&
    g[4] === 0 &&
    g[5] === 0
  ) {
    return isPrivateIpv4(embeddedIpv4(g[6], g[7]));
  }
  return false;
}

/**
 * True when an IP address literal is one a server must never fetch from.
 * Pure and synchronous — the same test is applied to a literal in the URL and
 * to every address DNS resolves a hostname to. Anything unparseable counts as
 * blocked: this is only ever called with something meant to be an address.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) return isPrivateIpv4(v4);
  const v6 = parseIpv6(ip);
  if (v6) return isPrivateIpv6(v6);
  return true;
}

/** The address inside a URL hostname, or null when the host is a name. */
function hostAsIpLiteral(hostname: string): string | null {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  return null;
}

/**
 * Everything about a URL that can be judged without touching the network:
 * scheme, port, and a hostname that is either a loopback name or an address
 * literal. Returns the reason it is refused, or null when it looks public.
 * Pure, so the whole policy is unit-testable.
 */
export function publicUrlBlockReason(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "that is not a valid URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return "only http and https addresses can be fetched";
  }
  if (!ALLOWED_PORTS.has(u.port)) {
    return `port ${u.port} is not a web port`;
  }
  const host = u.hostname.toLowerCase();
  if (!host) return "that URL has no host";
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "localhost is not a public website";
  }
  const literal = hostAsIpLiteral(host);
  if (literal && isPrivateAddress(literal)) {
    return "that address is on a private network";
  }
  return null;
}

/**
 * Full check, including DNS: a public-looking hostname that resolves to a
 * private address is refused too. A lookup that fails is NOT a policy
 * refusal — it is an unreachable site, so the plain Error falls through to
 * the caller's normal "couldn't reach it" handling.
 */
async function assertPublicUrl(raw: string): Promise<void> {
  const reason = publicUrlBlockReason(raw);
  if (reason) throw new BlockedAddressError(reason);

  const host = new URL(raw).hostname.toLowerCase();
  if (hostAsIpLiteral(host)) return; // already judged above

  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0) {
    throw new BlockedAddressError("that host does not resolve to an address");
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new BlockedAddressError("that address is on a private network");
    }
  }
}

/**
 * fetch(), with every hop of the redirect chain re-checked. `redirect:
 * "manual"` is the whole point: letting undici follow redirects itself would
 * hand a public URL the ability to bounce us into the private network.
 */
async function guardedFetch(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<Response> {
  let target = url;
  for (let hop = 0; ; hop += 1) {
    await assertPublicUrl(target);
    const res = await fetch(target, { headers, redirect: "manual", signal });
    const location =
      res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location || hop >= MAX_REDIRECTS) return res;
    // Release the socket before the next hop. Cancel rather than read: a
    // redirect's body is never used, and reading it would buffer whatever
    // the server chose to attach.
    await res.body?.cancel().catch(() => undefined);
    target = new URL(location, target).toString();
  }
}

/** The charset the server declared, defaulting to UTF-8 like `res.text()`. */
function bodyCharset(res: Response): string {
  const m = /charset=([^;]+)/i.exec(res.headers.get("content-type") || "");
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "utf-8";
}

/**
 * The response body as text, but read in chunks and abandoned once
 * MAX_BODY_BYTES have arrived: `res.text()` buffers the entire body first,
 * so a URL that happens to point at a huge file would be downloaded whole
 * before anything truncated it. Decoding is incremental, so a multi-byte
 * character straddling two chunks still comes out in one piece.
 *
 * Exported for the tests — the cap is the only thing standing between a
 * mistyped link and a few gigabytes of memory.
 */
export async function readCappedText(res: Response): Promise<string> {
  if (!res.body) return "";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(bodyCharset(res));
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  const reader = res.body.getReader();
  let out = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = MAX_BODY_BYTES - bytes;
      if (value.byteLength >= room) {
        out += decoder.decode(value.subarray(0, room));
        await reader.cancel().catch(() => undefined);
        return out;
      }
      bytes += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return out;
}

type FetchOutcome =
  | { kind: "ok"; html: string }
  | { kind: "blocked"; status: number }
  | { kind: "notfound"; status: number }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

// Bot walls that return 200 with an interstitial instead of an error code.
function looksLikeChallengePage(html: string): boolean {
  if (html.length > 30_000) return false;
  return /just a moment|cf-browser-verification|cf-challenge|attention required|access denied|verify you are human|are you a robot|captcha|enable javascript and cookies/i.test(
    html
  );
}

async function fetchHtml(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<FetchOutcome> {
  try {
    const res = await guardedFetch(url, headers, AbortSignal.timeout(timeoutMs));
    if (res.status === 404 || res.status === 410) {
      return { kind: "notfound", status: res.status };
    }
    if (!res.ok) {
      return { kind: "blocked", status: res.status };
    }
    const html = await readCappedText(res);
    if (looksLikeChallengePage(html)) {
      return { kind: "blocked", status: res.status };
    }
    return { kind: "ok", html };
  } catch (err) {
    // A refused address is a verdict about the request, not a failed
    // attempt — it must stop the ladder rather than fall through to the
    // next layer.
    if (err instanceof BlockedAddressError) throw err;
    if (isAbortError(err)) return { kind: "timeout" };
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Newest Wayback Machine snapshot of the page, as original bytes (the `id_`
 * flag skips archive.org's HTML rewriting). Returns null on any miss — this
 * is strictly best-effort.
 */
async function fetchWaybackHtml(
  url: string,
  budgetMs: number
): Promise<string | null> {
  try {
    const availRes = await guardedFetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      botHeaders(),
      AbortSignal.timeout(Math.min(6_000, budgetMs))
    );
    if (!availRes.ok) return null;
    const avail = (await availRes.json()) as {
      archived_snapshots?: {
        closest?: { url?: string; available?: boolean };
      };
    };
    const closest = avail.archived_snapshots?.closest;
    if (!closest?.available || !closest.url) return null;

    const snapUrl = String(closest.url)
      .replace(/^http:/i, "https:")
      .replace(/\/web\/(\d+)\//, "/web/$1id_/");
    const res = await guardedFetch(
      snapUrl,
      botHeaders(),
      AbortSignal.timeout(Math.max(4_000, budgetMs - 6_000))
    );
    if (!res.ok) return null;
    return await readCappedText(res);
  } catch {
    return null;
  }
}

export async function scrapeRecipe(
  url: string,
  opts: { totalBudgetMs?: number } = {}
): Promise<ScrapedRecipe> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RecipeScrapeError("That doesn't look like a valid URL.");
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new RecipeScrapeError("URL must start with http:// or https://");
  }
  parsed.hash = "";
  const target = parsed.toString();

  // Judged before anything is fetched, so an obviously internal address
  // never costs a round trip.
  const blocked = publicUrlBlockReason(target);
  if (blocked) throw new BlockedAddressError(blocked);

  const deadline = Date.now() + (opts.totalBudgetMs ?? 40_000);
  const remaining = () => deadline - Date.now();
  const attemptBudget = (cap: number) =>
    Math.min(cap, Math.max(4_000, remaining() - 1_000));

  let sawBlocked = false;
  let sawNotFound = false;
  let sawTimeout = false;
  let fetchedSomething = false;
  let weak: ScrapedRecipe | null = null;

  const tryExtract = (html: string): ScrapedRecipe | null => {
    fetchedSomething = true;
    const found = extractRecipeFromHtml(html);
    if (found && found.ingredients.length > 0) return found;
    if (found && !weak) weak = found;
    return null;
  };

  // Layer 1: direct fetch, browser-shaped.
  const direct = await fetchHtml(target, browserHeaders(), attemptBudget(10_000));
  if (direct.kind === "ok") {
    const full = tryExtract(direct.html);
    if (full) return full;
  } else if (direct.kind === "blocked") {
    sawBlocked = true;
  } else if (direct.kind === "notfound") {
    sawNotFound = true;
  } else if (direct.kind === "timeout") {
    sawTimeout = true;
  }

  // Layer 2: honest bot UA — only worth a shot when the browser-shaped
  // request was refused (some WAFs allow declared bots; a clean 200 that
  // simply lacked recipe data will lack it for the bot too).
  if ((sawBlocked || direct.kind === "error") && remaining() > 6_000) {
    const asBot = await fetchHtml(target, botHeaders(), attemptBudget(8_000));
    if (asBot.kind === "ok") {
      const full = tryExtract(asBot.html);
      if (full) return full;
    } else if (asBot.kind === "notfound") {
      sawNotFound = true;
    } else if (asBot.kind === "timeout") {
      sawTimeout = true;
    }
  }

  // Layer 3: Wayback Machine. Covers hard bot-blockers AND pages that have
  // since been taken down — the snapshot usually carries the same JSON-LD.
  if (remaining() > 7_000) {
    const archived = await fetchWaybackHtml(target, attemptBudget(20_000));
    if (archived) {
      const full = tryExtract(archived);
      if (full) return full;
    }
  }

  // No strategy produced ingredients. A name-only result is still worth
  // returning — the UI can prefill the title and steer the user to paste.
  if (weak) return weak;

  if (fetchedSomething) {
    throw new RecipeScrapeError(
      "Couldn't find structured recipe data on this page. Use “Paste list” to add the ingredients from your clipboard."
    );
  }
  if (sawNotFound) {
    throw new RecipeScrapeError(
      "The recipe page wasn't found (HTTP 404) — double-check the link."
    );
  }
  if (sawBlocked) {
    throw new RecipeScrapeError(
      "This site is blocking automated access. Open the recipe in your browser and use “Paste list” to add the ingredients."
    );
  }
  if (sawTimeout) {
    throw new RecipeScrapeError(
      "The recipe site took too long to respond. Try again in a moment, or use “Paste list”."
    );
  }
  throw new RecipeScrapeError(
    "Couldn't reach the recipe site. Check the link, or use “Paste list” to add the ingredients."
  );
}

/* ============================ Extraction ============================ */

/**
 * Pure HTML → recipe extraction across all strategies. Exported so tests can
 * exercise it without any network involvement.
 */
export function extractRecipeFromHtml(html: string): ScrapedRecipe | null {
  const doc = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;

  const strategies: Array<(h: string) => ScrapedRecipe | null> = [
    extractJsonLd,
    extractMicrodata,
    extractEmbeddedJson,
    extractPluginHtml,
  ];

  let weak: ScrapedRecipe | null = null;
  for (const strategy of strategies) {
    const found = strategy(doc);
    if (!found) continue;
    if (found.ingredients.length > 0) {
      // An earlier strategy may have found the real recipe name even though
      // it lacked ingredients (e.g. a thin JSON-LD block) — prefer that over
      // the raw page title.
      const merged: ScrapedRecipe = {
        ...found,
        name: found.name || weak?.name || undefined,
        description: found.description || weak?.description || undefined,
        servings: found.servings || weak?.servings || undefined,
      };
      return enrichWithPageMeta(merged, doc);
    }
    if (!weak) weak = found;
  }
  if (weak) return enrichWithPageMeta(weak, doc);

  // Last resort: at least give the user the page title to work from.
  const meta = pageMeta(doc);
  if (meta.name) {
    return {
      name: meta.name,
      description: meta.description || undefined,
      ingredients: [],
      source: "page-meta",
    };
  }
  return null;
}

function enrichWithPageMeta(recipe: ScrapedRecipe, html: string): ScrapedRecipe {
  if (recipe.name && recipe.description) return recipe;
  const meta = pageMeta(html);
  return {
    ...recipe,
    name: recipe.name || meta.name || undefined,
    description: recipe.description || meta.description || undefined,
  };
}

/* ---------- Strategy 1: JSON-LD ---------- */

function extractJsonLd(html: string): ScrapedRecipe | null {
  const re =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let weak: ScrapedRecipe | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    const parsedJson = tolerantJsonParse(raw);
    if (parsedJson === undefined) continue;

    const nodes: Record<string, unknown>[] = [];
    collectNodes(parsedJson, 0, nodes, (obj) => isRecipeType(obj["@type"]));
    for (const node of nodes) {
      const recipe = toScrapedRecipe(node, "json-ld");
      if (recipe.ingredients.length > 0) return recipe;
      if (!weak && recipe.name) weak = recipe;
    }
  }
  return weak;
}

/**
 * JSON.parse with fallbacks for the malformed-but-recoverable JSON-LD that
 * real sites emit: literal control characters inside strings, HTML-entity
 * encoded blocks, CDATA/comment wrappers, trailing commas.
 */
function tolerantJsonParse(text: string): unknown {
  const unwrapped = text
    .replace(/^\s*<!--/, "")
    .replace(/-->\s*$/, "")
    .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\//, "")
    .replace(/\/\*\s*\]\]>\s*\*\/\s*$/, "")
    .replace(/^\s*<!\[CDATA\[/, "")
    .replace(/\]\]>\s*$/, "")
    .trim();

  const candidates = [unwrapped];
  // A block with entity-escaped quotes and no real ones was HTML-encoded
  // wholesale — decode and retry.
  if (!unwrapped.includes('"') && /&quot;|&#0*34;|&#x0*22;/i.test(unwrapped)) {
    candidates.push(decodeHtmlEntities(unwrapped));
  }

  for (const candidate of candidates) {
    const fixups: Array<(s: string) => string> = [
      (s) => s,
      stripControlChars,
      (s) => stripTrailingCommas(stripControlChars(s)),
    ];
    for (const fix of fixups) {
      try {
        return JSON.parse(fix(candidate));
      } catch {
        // try the next fixup
      }
    }
  }
  return undefined;
}

function stripControlChars(s: string): string {
  // Literal newlines/tabs inside JSON strings are invalid JSON but common in
  // WordPress plugin output. Replacing every control char with a space fixes
  // the strings and is harmless between tokens.
  return s.replace(/[\u0000-\u001f]+/g, " ");
}

function stripTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, "$1");
}

/** Walk every value (arrays, objects, any key — not just @graph). */
function collectNodes(
  node: unknown,
  depth: number,
  out: Record<string, unknown>[],
  want: (obj: Record<string, unknown>) => boolean
): void {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) {
    for (const child of node) collectNodes(child, depth + 1, out, want);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (want(obj)) out.push(obj);
  for (const value of Object.values(obj)) {
    collectNodes(value, depth + 1, out, want);
  }
}

function isRecipeType(t: unknown): boolean {
  if (typeof t === "string") {
    // Accept "Recipe", "schema:Recipe", and full-URL forms.
    const last = t.split(/[/:]/).pop() ?? t;
    return last.trim().toLowerCase() === "recipe";
  }
  if (Array.isArray(t)) return t.some((x) => isRecipeType(x));
  return false;
}

function toScrapedRecipe(
  obj: Record<string, unknown>,
  source: RecipeSource
): ScrapedRecipe {
  const name = textField(obj.name) || textField(obj.headline);
  const description = textField(obj.description);
  const rawIngredients =
    obj.recipeIngredient !== undefined ? obj.recipeIngredient : obj.ingredients;
  const ingredients = toStringArray(rawIngredients)
    .map((s) => htmlToText(s))
    .filter(Boolean);
  return {
    name: name || undefined,
    description: description || undefined,
    ingredients,
    servings: parseServings(obj.recipeYield ?? obj.yield),
    source,
  };
}

function textField(v: unknown): string {
  if (typeof v === "string") return htmlToText(v);
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") {
    return htmlToText(v[0]);
  }
  // Schema.org sometimes nests text as {"@value": "..."} or {"text": "..."}.
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj["@value"] === "string") return htmlToText(obj["@value"]);
    if (typeof obj.text === "string") return htmlToText(obj.text);
  }
  return "";
}

function toStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === "string") {
        out.push(item);
      } else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const text =
          (typeof obj.name === "string" && obj.name) ||
          (typeof obj.text === "string" && obj.text) ||
          "";
        if (text) out.push(text);
      }
    }
    return out;
  }
  if (typeof v === "string") {
    // A single newline-separated blob is a list in disguise.
    return v.includes("\n") ? v.split(/\r?\n/) : [v];
  }
  return [];
}

/* ---------- Strategy 2: schema.org microdata ---------- */

function extractMicrodata(html: string): ScrapedRecipe | null {
  const ingredients: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const text = htmlToText(raw);
    if (!text || text.length > 300) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ingredients.push(text);
  };

  // <meta itemprop="recipeIngredient" content="..."> form.
  const metaRe =
    /<meta\b[^>]*\bitemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const content = attrValue(m[0], "content");
    if (content) push(content);
  }

  // <li itemprop="recipeIngredient">...</li> element form (any tag).
  const elRe =
    /<([a-z][a-z0-9]*)\b[^>]*\bitemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  while ((m = elRe.exec(html)) !== null) {
    push(m[2]);
  }

  // A lone match is more likely stray markup than a recipe.
  if (ingredients.length < 2) return null;
  return {
    ingredients,
    servings: parseServings(microdataValue(html, "recipeYield")),
    source: "microdata",
  };
}

/** First `itemprop="<name>"` value on the page (meta content or element text). */
function microdataValue(html: string, name: string): string | undefined {
  const metaRe = new RegExp(
    `<meta\\b[^>]*\\bitemprop=["']${name}["'][^>]*>`,
    "i"
  );
  const meta = metaRe.exec(html);
  if (meta) {
    const content = attrValue(meta[0], "content");
    if (content) return content;
  }
  const elRe = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*\\bitemprop=["']${name}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    "i"
  );
  const el = elRe.exec(html);
  return el ? htmlToText(el[2]) || undefined : undefined;
}

function attrValue(tagHtml: string, attr: string): string {
  const re = new RegExp(
    `\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const m = re.exec(tagHtml);
  if (!m) return "";
  return m[2] ?? m[3] ?? m[4] ?? "";
}

/* ---------- Strategy 3: embedded app-state JSON ---------- */

function extractEmbeddedJson(html: string): ScrapedRecipe | null {
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    // JSON-LD already had its chance in strategy 1.
    if (/type=["']application\/ld\+json["']/i.test(attrs)) continue;
    if (!body.includes("recipeIngredient")) continue;

    const text = body.trim();
    const candidates: string[] = [text];
    // `window.__STATE__ = {...};` → try the right-hand side.
    const eq = text.indexOf("=");
    if (eq > 0 && eq < 200) {
      candidates.push(text.slice(eq + 1).trim().replace(/;\s*$/, ""));
    }
    // Or just the outermost object literal.
    const braceStart = text.indexOf("{");
    const braceEnd = text.lastIndexOf("}");
    if (braceStart >= 0 && braceEnd > braceStart) {
      candidates.push(text.slice(braceStart, braceEnd + 1));
    }

    for (const candidate of candidates) {
      const parsedJson = tolerantJsonParse(candidate);
      if (parsedJson === undefined) continue;
      const nodes: Record<string, unknown>[] = [];
      collectNodes(
        parsedJson,
        0,
        nodes,
        (obj) =>
          toStringArray(obj.recipeIngredient).length > 0 ||
          (isRecipeType(obj["@type"]) && toStringArray(obj.ingredients).length > 0)
      );
      // Prefer a node that also carries a name.
      nodes.sort(
        (a, b) => (textField(b.name) ? 1 : 0) - (textField(a.name) ? 1 : 0)
      );
      for (const node of nodes) {
        const recipe = toScrapedRecipe(node, "embedded-json");
        if (recipe.ingredients.length > 0) return recipe;
      }
    }

    // Double-encoded JSON-LD inside a JS string: unescape then bracket-match
    // the recipeIngredient array directly.
    const sources = body.includes('\\"recipeIngredient\\"')
      ? [body.replace(/\\(["\\/])/g, "$1")]
      : [body];
    for (const source of sources) {
      const arr = extractKeyedStringArray(source, "recipeIngredient");
      if (arr && arr.length > 0) {
        return {
          ingredients: arr.map((s) => htmlToText(s)).filter(Boolean),
          source: "embedded-json",
        };
      }
    }
  }
  return null;
}

/**
 * Find `"key": [ ... ]` in raw text and JSON.parse just that array, using a
 * quote-aware bracket matcher. Survives hosts whose surrounding JSON is
 * unparseable.
 */
function extractKeyedStringArray(text: string, key: string): string[] | null {
  const keyRe = new RegExp(`"${key}"\\s*:\\s*\\[`, "g");
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(text)) !== null) {
    const start = m.index + m[0].length - 1; // position of '['
    const end = matchBracket(text, start);
    if (end < 0) continue;
    try {
      const arr = JSON.parse(stripControlChars(text.slice(start, end + 1)));
      if (Array.isArray(arr)) {
        const strings = arr.filter((x): x is string => typeof x === "string");
        if (strings.length > 0) return strings;
      }
    } catch {
      // fall through to the next occurrence
    }
  }
  return null;
}

/** Index of the bracket matching text[start] ('[' or '{'), or -1. */
function matchBracket(text: string, start: number): number {
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length && i < start + 200_000; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* ---------- Strategy 4: recipe-plugin HTML ---------- */

function extractPluginHtml(html: string): ScrapedRecipe | null {
  const ingredients: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const text = htmlToText(raw);
    // Instructions/steps masquerading as list items are long; skip them.
    if (!text || text.length > 250) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ingredients.push(text);
  };

  // li-level classes used by the big WordPress recipe plugins, plus the
  // generic "ingredient" token used by EasyRecipe and countless themes.
  const liPatterns = [
    /<li\b[^>]*class=["'][^"']*\bwprm-recipe-ingredient\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /<li\b[^>]*data-tr-ingredient-checkbox[^>]*>([\s\S]*?)<\/li>/gi,
    /<li\b[^>]*class=["'][^"']*\bjetpack-recipe-ingredient\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /<li\b[^>]*class=["'][^"']*\bingredient\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
  ];
  for (const re of liPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) push(m[1]);
    if (ingredients.length >= 2) break;
  }

  // Container-scoped fallback (older Tasty Recipes / Mediavine themes whose
  // list items carry no distinctive class of their own).
  if (ingredients.length < 2) {
    const containerRe =
      /<(?:div|ul)\b[^>]*class=["'][^"']*\b(?:tasty-recipes?-ingredients|mv-create-ingredients|recipe-ingredients)\b[^"']*["'][^>]*>/gi;
    let c: RegExpExecArray | null;
    while ((c = containerRe.exec(html)) !== null) {
      const window = html.slice(c.index, c.index + 40_000);
      const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let m: RegExpExecArray | null;
      while ((m = liRe.exec(window)) !== null) push(m[1]);
      if (ingredients.length >= 2) break;
    }
  }

  if (ingredients.length < 2) return null;
  return { ingredients, source: "recipe-html" };
}

/* ---------- Page metadata (name/description fallback) ---------- */

function pageMeta(html: string): { name: string; description: string } {
  const name =
    metaContent(html, "property", "og:title") ||
    metaContent(html, "name", "twitter:title") ||
    titleTag(html);
  const description =
    metaContent(html, "property", "og:description") ||
    metaContent(html, "name", "description");
  return { name, description };
}

function metaContent(html: string, keyAttr: string, keyValue: string): string {
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0];
    if (attrValue(tag, keyAttr).toLowerCase() !== keyValue.toLowerCase()) {
      continue;
    }
    const content = attrValue(tag, "content");
    if (content) return htmlToText(content);
  }
  return "";
}

function titleTag(html: string): string {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? htmlToText(m[1]) : "";
}
