// The JSON contract returned by the data endpoint (§3.2). `leads-sample.json`
// is a real example of this shape and the offline fallback.

export interface DailyRow {
  date: string; // "DD/MM/YYYY"
  paidLeads: number | null;
  revenue: number | null;
  spend: number | null; // ad spend (the daily table shows this, not revenue)
  cpl: number | null;
  adjProfit: number | null;
  roas: number | null;
}

/** One ED day (mirrors DailyRow, but leads = Social + Email). */
export interface EdRow {
  date: string; // "DD/MM/YYYY"
  leads: number | null; // Social + Email leads
  revenue: number | null;
  spend: number | null;
  cpl: number | null;
  adjProfit: number | null;
  roas: number | null;
}

/**
 * ED leads summary (§ tiles). Optional so the dashboard degrades gracefully
 * when the endpoint predates this field or the ED sheet is unreachable.
 * `cumulative`/`benchmark` mirror the HD contract and come from the ED sheet's
 * Cumul. Leads tab; they're null when that tab doesn't exist yet, in which
 * case the ED view falls back to whole-day figures (no chart, no pace).
 */
export interface EdSummary {
  date: string; // "DD/MM/YYYY" — the day todayLeads is for (latest ED day)
  label: string; // source tab, e.g. "June 2026"
  todayLeads: number | null; // leads for that day (live intraday when cumulative exists)
  monthToDate: number | null; // Σ leads for the month so far
  avgPerDay: number | null; // monthToDate / days elapsed
  daily: EdRow[]; // one per day, oldest -> newest (drives the ED table/strip)
  cumulative: number[] | null; // length 24, today's cumulative leads by hour
  benchmark: { high: number[]; low: number[] } | null; // length-24 cumulative band
}

export interface LeadsData {
  syncedAt: string; // ISO timestamp, sheet timezone
  today: {
    date: string; // "DD/MM/YYYY"
    label: string;
    cumulative: number[]; // length 24, cumulative leads by hour
  };
  benchmark: {
    high: number[]; // length 24, cumulative
    low: number[]; // length 24, cumulative
  };
  daily: DailyRow[]; // one per day, oldest -> newest
  ed?: EdSummary | null; // ED leads tile source (optional)
}

export type SyncStatus = "syncing" | "live" | "cached" | "snapshot";

/**
 * Where the currently-shown data came from:
 * - live: fresh from the endpoint
 * - cache: the last successful live payload, replayed from localStorage
 * - fixture: the bundled sample (only when there's no live data or cache)
 */
export type DataSource = "live" | "cache" | "fixture";

/** Which vertical's detail (graph/table) is shown below the tiles. */
export type Vertical = "hd" | "ed";

export interface AppState {
  data: LeadsData;
  source: DataSource;
  syncedAt: string; // ISO of the data currently shown
  chartMode: "cumulative" | "hourly";
}
