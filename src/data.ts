// Data fetching: hit the endpoint, validate the shape, fall back to the
// bundled fixture so the screen is never blank (§3.4).

import type { DataSource, EdRow, EdSummary, LeadsData } from "./types.ts";

// Resolved at build time. Empty when no live endpoint is configured.
const DATA_URL = (import.meta.env.VITE_DATA_URL as string | undefined) ?? "";

/** True when a live endpoint is configured (lets the UI schedule self-heal retries). */
export const HAS_LIVE_ENDPOINT = Boolean(DATA_URL);

// Vite serves /public at the root; `base: "./"` makes this relative in builds.
const FIXTURE_URL = `${import.meta.env.BASE_URL}leads-sample.json`;

// Abort a live fetch that stalls. The Apps Script endpoint opens two sheets and
// cold-starts slowly (warm ≈ 5-8s, cold can be 15s+), so give it real headroom
// before falling back — a 12s cap was aborting cold starts and showing the
// stale snapshot on open.
const FETCH_TIMEOUT_MS = 20_000;

// Attempts at the live endpoint before falling back. A cold start's first hit
// warms the instance, so a retry usually returns quickly.
const LIVE_ATTEMPTS = 2;

// Last successful live payload, kept in localStorage so that when a sync fails
// we can replay the most recent data THIS device saw (e.g. from earlier today)
// instead of the months-old bundled sample.
const CACHE_KEY = "leads-monitor:last-live";

export interface FetchResult {
  data: LeadsData;
  source: DataSource;
}

/**
 * Fetch live data when an endpoint is configured. On failure, replay the last
 * successful live payload from localStorage; only if there's none do we fall
 * back to the bundled fixture. Caller surfaces the source via the status pill.
 */
export async function fetchData(): Promise<FetchResult> {
  if (DATA_URL) {
    for (let attempt = 1; attempt <= LIVE_ATTEMPTS; attempt++) {
      try {
        const data = validate(await fetchJson(withCacheBust(DATA_URL)));
        saveCache(data);
        return { data, source: "live" };
      } catch (err) {
        console.warn(
          `[leads-monitor] live fetch attempt ${attempt}/${LIVE_ATTEMPTS} failed:`,
          err,
        );
        if (attempt < LIVE_ATTEMPTS) await delay(700);
      }
    }
    // Live failed — prefer the last good live snapshot from this device.
    const cached = loadCache();
    if (cached) return { data: cached, source: "cache" };
  }
  // No endpoint configured, or live failed with no cache to fall back on.
  const fixture = await fetchJson(withCacheBust(FIXTURE_URL));
  return { data: validate(fixture), source: "fixture" };
}

/** Persist the latest live payload; ignore quota/private-mode errors. */
function saveCache(data: LeadsData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Load and re-validate the cached payload (guards against schema drift). */
function loadCache(): LeadsData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? validate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withCacheBust(url: string): string {
  // Date.now() is fine in the browser; this only runs client-side.
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${Date.now()}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal structural validation so a malformed response falls back cleanly. */
export function validate(raw: unknown): LeadsData {
  if (!raw || typeof raw !== "object") throw new Error("payload is not an object");
  const d = raw as Record<string, unknown>;

  const today = d.today as Record<string, unknown> | undefined;
  const benchmark = d.benchmark as Record<string, unknown> | undefined;

  if (!today || !Array.isArray(today.cumulative)) throw new Error("missing today.cumulative");
  if (!benchmark || !Array.isArray(benchmark.high) || !Array.isArray(benchmark.low)) {
    throw new Error("missing benchmark band");
  }
  if (!Array.isArray(d.daily)) throw new Error("missing daily[]");

  return {
    syncedAt: typeof d.syncedAt === "string" ? d.syncedAt : new Date().toISOString(),
    today: {
      date: typeof today.date === "string" ? today.date : "",
      label: typeof today.label === "string" ? today.label : "Today",
      cumulative: pad24(today.cumulative as unknown[]),
    },
    benchmark: {
      high: pad24(benchmark.high as unknown[]),
      low: pad24(benchmark.low as unknown[]),
    },
    // Drop fully-empty rows defensively (monthly tabs pre-list every date, so a
    // stale payload could carry blank future days). A real day always has at
    // least paid leads or revenue.
    daily: (d.daily as unknown[])
      .map(normalizeRow)
      .filter((r) => r.paidLeads != null || r.revenue != null),
    ed: normalizeEd(d.ed),
  };
}

/** ED tile block — optional; missing/malformed collapses to null (tile shows "—"). */
function normalizeEd(raw: unknown): EdSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const bench = e.benchmark as Record<string, unknown> | null | undefined;
  return {
    date: typeof e.date === "string" ? e.date : "",
    label: typeof e.label === "string" ? e.label : "",
    todayLeads: num(e.todayLeads),
    monthToDate: num(e.monthToDate),
    avgPerDay: num(e.avgPerDay),
    daily: Array.isArray(e.daily)
      ? e.daily.map(normalizeEdRow).filter((r) => r.leads != null || r.revenue != null)
      : [],
    cumulative: Array.isArray(e.cumulative) ? pad24(e.cumulative) : null,
    benchmark:
      bench && Array.isArray(bench.high) && Array.isArray(bench.low)
        ? { high: pad24(bench.high), low: pad24(bench.low) }
        : null,
  };
}

function normalizeEdRow(raw: unknown): EdRow {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    date: typeof r.date === "string" ? r.date : "",
    leads: num(r.leads),
    revenue: num(r.revenue),
    spend: num(r.spend),
    cpl: num(r.cpl),
    adjProfit: num(r.adjProfit),
    roas: num(r.roas),
  };
}

function pad24(a: unknown[]): number[] {
  const nums = a.map((v) => (typeof v === "number" && isFinite(v) ? v : 0));
  const r = nums.slice(0, 24);
  while (r.length < 24) r.push(r.length ? r[r.length - 1] : 0);
  return r;
}

function normalizeRow(raw: unknown): LeadsData["daily"][number] {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    date: typeof r.date === "string" ? r.date : "",
    paidLeads: num(r.paidLeads),
    revenue: num(r.revenue),
    spend: num(r.spend),
    cpl: num(r.cpl),
    adjProfit: num(r.adjProfit),
    roas: num(r.roas),
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}
