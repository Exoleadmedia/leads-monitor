// All business logic and number formatting (§5). Pure functions, no DOM.

import type { DailyRow } from "./types.ts";

const HOURS = 24;

// ---------------------------------------------------------------------------
// Typical line & cutoff (§5.1)
// ---------------------------------------------------------------------------

/** Band midpoint: typical[h] = (high[h] + low[h]) / 2. */
export function typicalLine(high: number[], low: number[]): number[] {
  return Array.from(
    { length: HOURS },
    (_, h) => ((high[h] ?? 0) + (low[h] ?? 0)) / 2,
  );
}

/**
 * Last hour at which today's cumulative actually increased (the latest hour
 * that received leads). Returns -1 when no leads have been logged today.
 */
export function cutoffHour(today: number[]): number {
  let cutoff = -1;
  let prev = 0;
  for (let h = 0; h < HOURS; h++) {
    const v = today[h] ?? 0;
    if (v > prev) cutoff = h;
    prev = v;
  }
  return cutoff;
}

// ---------------------------------------------------------------------------
// Pace flag (§5.2)
// ---------------------------------------------------------------------------

export type PaceTone = "ahead" | "behind" | "onpace" | "none";

export interface Pace {
  tone: PaceTone;
  variance: number; // signed fraction, e.g. -0.19
  cutoff: number;
  todayAt: number; // today[cutoff]
  typicalAt: number; // round(typical[cutoff])
  headline: string;
  subtext: string;
}

export function computePace(
  today: number[],
  high: number[],
  low: number[],
): Pace {
  const typical = typicalLine(high, low);
  const cutoff = cutoffHour(today);

  if (cutoff < 0) {
    return {
      tone: "none",
      variance: 0,
      cutoff,
      todayAt: 0,
      typicalAt: 0,
      headline: "No leads logged yet today",
      subtext: "Waiting for the first leads to come in.",
    };
  }

  const todayAt = today[cutoff];
  const typAt = typical[cutoff];
  const variance = typAt === 0 ? 0 : (todayAt - typAt) / typAt;
  const pct = Math.round(Math.abs(variance) * 100);
  const typRounded = Math.round(typAt);

  let tone: PaceTone;
  let headline: string;
  if (variance <= -0.1) {
    tone = "behind";
    headline = `Behind pace — ${pct}% below a typical day`;
  } else if (variance >= 0.1) {
    tone = "ahead";
    headline = `Ahead of pace — ${pct}% above a typical day`;
  } else {
    tone = "onpace";
    headline = `On pace — within ${pct}% of typical`;
  }

  const subtext = `${formatInt(todayAt)} leads by ${cutoff}:00 · a typical day is ~${formatInt(
    typRounded,
  )} by now.`;

  return { tone, variance, cutoff, todayAt, typicalAt: typRounded, headline, subtext };
}

// ---------------------------------------------------------------------------
// Per-hour series (difference of cumulative) — for the "Per hour" chart (§4.4)
// ---------------------------------------------------------------------------

export function perHour(cumulative: number[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let h = 0; h < HOURS; h++) {
    const v = cumulative[h] ?? 0;
    out.push(v - prev);
    prev = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// "June so far" strip + table footer aggregates (§5.3)
// ---------------------------------------------------------------------------

export interface Aggregates {
  paid: number; // Σ paidLeads
  revenue: number; // Σ revenue
  spend: number; // Σ spend
  profit: number; // Σ adjProfit
  avgRoas: number | null; // mean of non-null roas
  cplAvg: number | null; // mean of non-zero, non-null cpl
}

export function aggregate(daily: DailyRow[]): Aggregates {
  let paid = 0;
  let revenue = 0;
  let spend = 0;
  let profit = 0;

  const roasVals: number[] = [];
  const cplVals: number[] = [];

  for (const row of daily) {
    paid += row.paidLeads ?? 0;
    revenue += row.revenue ?? 0;
    spend += row.spend ?? 0;
    profit += row.adjProfit ?? 0;
    if (row.roas != null) roasVals.push(row.roas);
    if (row.cpl != null && row.cpl !== 0) cplVals.push(row.cpl);
  }

  return {
    paid,
    revenue,
    spend,
    profit,
    avgRoas: mean(roasVals),
    cplAvg: mean(cplVals),
  };
}

/** Median of the month's non-null ROAS values, used for chip coloring (§5.3). */
export function roasMedian(daily: DailyRow[]): number | null {
  const vals = daily
    .map((r) => r.roas)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
}

export type RoasTone = "green" | "red" | "neutral";

export function roasChipTone(roas: number | null, median: number | null): RoasTone {
  if (roas == null || median == null) return "neutral";
  if (roas >= median) return "green";
  if (roas < median * 0.92) return "red";
  return "neutral";
}

function mean(vals: number[]): number | null {
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// ---------------------------------------------------------------------------
// Number formatting (§5.4)
// ---------------------------------------------------------------------------

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Thousands-separated integer, e.g. 9130 -> "9,130". */
export function formatInt(n: number): string {
  return intFmt.format(Math.round(n));
}

/** Money, rounded thousands-separated, e.g. 6024 -> "$6,024". */
export function formatMoney(n: number | null): string {
  if (n == null) return "—";
  return "$" + intFmt.format(Math.round(n));
}

/** CPL keeps 2 decimals, e.g. 13.69 -> "$13.69". */
export function formatCpl(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toFixed(2);
}

/** Abbreviated money for strip stats, e.g. 216517 -> "$216.5k". */
export function formatMoneyAbbr(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${intFmt.format(Math.round(abs))}`;
}

/** ROAS, 2 decimals, e.g. 1.73 -> "1.73"; null -> "—". */
export function formatRoas(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(2);
}

/** Signed integer percent from a fraction, e.g. -0.19 -> "-19%". */
export function formatSignedPct(fraction: number): string {
  const pct = Math.round(fraction * 100);
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  return `${sign}${Math.abs(pct)}%`;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "DD/MM/YYYY" -> { day, month (1-12), year }, or null if unparseable. */
export function parseDmy(
  s: string,
): { day: number; month: number; year: number } | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return { day: +m[1], month: +m[2], year: +m[3] };
}

/** "30/06/2026" -> "June 2026". Falls back to the raw string if unparseable. */
export function monthLabel(dmy: string): string {
  const p = parseDmy(dmy);
  if (!p) return dmy;
  return `${MONTHS[p.month - 1]} ${p.year}`;
}

/** "30/06/2026" -> "30 Jun" (short, for table rows). */
export function shortDay(dmy: string): string {
  const p = parseDmy(dmy);
  if (!p) return dmy;
  return `${p.day} ${MONTHS[p.month - 1].slice(0, 3)}`;
}

/** "30/06/2026" -> "30 June" (long, for the chart subtitle). */
export function longDay(dmy: string): string {
  const p = parseDmy(dmy);
  if (!p) return dmy;
  return `${p.day} ${MONTHS[p.month - 1]}`;
}

/**
 * ISO timestamp -> "HH:MM" for the status pill. The ISO carries the sheet's
 * wall-clock time + offset (e.g. 2026-06-30T15:25:29+10:00); we show that
 * wall-clock time (the sheet's timezone, per §7.7) so the pill stays consistent
 * with the chart's hours and the pace subtext regardless of the viewer's tz.
 */
export function clockHHMM(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (m) return `${m[1]}:${m[2]}`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export const HOUR_LABELS = Array.from({ length: HOURS }, (_, h) => `${h}:00`);
