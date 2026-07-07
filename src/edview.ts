// ED detail view: an "ED · <month> so far" summary strip, then — when the ED
// sheet has a Cumul. Leads tab — the same pace flag + "Leads today" chart the
// HD view shows, and finally the ED daily table. Without cumulative data it
// degrades to just the monthly rollup and the day-by-day breakdown.

import { chartCardHtml } from "./chartcard.ts";
import type { ChartMode } from "./chartcard.ts";
import {
  formatCpl,
  formatInt,
  formatMoney,
  formatMoneyAbbr,
  formatRoas,
  roasChipTone,
  shortDay,
} from "./compute.ts";
import { renderFlag } from "./flag.ts";
import type { EdRow, EdSummary, LeadsData } from "./types.ts";

interface EdAgg {
  leads: number;
  revenue: number;
  spend: number;
  profit: number;
  avgRoas: number | null;
  cplAvg: number | null;
}

function edAggregate(rows: EdRow[]): EdAgg {
  let leads = 0;
  let revenue = 0;
  let spend = 0;
  let profit = 0;
  const roas: number[] = [];
  const cpl: number[] = [];
  for (const r of rows) {
    leads += r.leads ?? 0;
    revenue += r.revenue ?? 0;
    spend += r.spend ?? 0;
    profit += r.adjProfit ?? 0;
    if (r.roas != null) roas.push(r.roas);
    if (r.cpl != null && r.cpl !== 0) cpl.push(r.cpl);
  }
  return {
    leads,
    revenue,
    spend,
    profit,
    avgRoas: roas.length ? roas.reduce((s, v) => s + v, 0) / roas.length : null,
    cplAvg: cpl.length ? cpl.reduce((s, v) => s + v, 0) / cpl.length : null,
  };
}

/** Median ED ROAS for chip colouring (same rule as the HD table). */
function edRoasMedian(rows: EdRow[]): number | null {
  const vals = rows
    .map((r) => r.roas)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
}

function stripHtml(ed: EdSummary, agg: EdAgg): string {
  const month = ed.label || "ED";
  const cells = [
    { label: "Leads", value: formatInt(agg.leads) },
    { label: "Revenue", value: formatMoneyAbbr(agg.revenue) },
    { label: "Profit", value: formatMoneyAbbr(agg.profit) },
    { label: "Avg ROAS", value: formatRoas(agg.avgRoas) },
  ];
  return `
    <section class="card strip-card">
      <div class="card__title">ED · ${esc(month)} so far</div>
      <div class="strip">
        ${cells
          .map(
            (c) => `
          <div class="stat">
            <div class="stat__value">${c.value}</div>
            <div class="stat__label">${esc(c.label)}</div>
          </div>`,
          )
          .join("")}
      </div>
    </section>
  `;
}

function tableHtml(ed: EdSummary, agg: EdAgg): string {
  const rows = ed.daily;
  const median = edRoasMedian(rows);
  // Highlight today's row; until the monthly tab has one (early in the day),
  // fall back to the latest row.
  const hasToday = rows.some((r) => r.date === ed.date);
  const highlight = hasToday
    ? ed.date
    : rows.length
      ? rows[rows.length - 1].date
      : "";
  const body = [...rows]
    .reverse()
    .map((row) => rowHtml(row, median, row.date === highlight))
    .join("");

  return `
    <section class="card">
      <div class="card__title">
        Daily breakdown <span class="card__hint">ED · newest first · ${rows.length} days</span>
      </div>
      <div class="table-wrap">
        <table class="daily">
          <thead>
            <tr>
              <th class="num--left">Date</th>
              <th>Leads</th>
              <th>Spend</th>
              <th>CPL</th>
              <th>Profit</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr>
              <td class="num--left">Total</td>
              <td>${formatInt(agg.leads)}</td>
              <td>${formatMoney(agg.spend)}</td>
              <td>${formatCpl(agg.cplAvg)}</td>
              <td>${formatMoney(agg.profit)}</td>
              <td>${formatRoas(agg.avgRoas)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  `;
}

function rowHtml(row: EdRow, median: number | null, isToday: boolean): string {
  const tone = roasChipTone(row.roas, median);
  return `
    <tr class="${isToday ? "row--today" : ""}">
      <td class="num--left">${esc(shortDay(row.date))}</td>
      <td>${row.leads == null ? "—" : formatInt(row.leads)}</td>
      <td>${formatMoney(row.spend)}</td>
      <td>${formatCpl(row.cpl)}</td>
      <td>${formatMoney(row.adjProfit)}</td>
      <td><span class="chip chip--${tone}">${formatRoas(row.roas)}</span></td>
    </tr>
  `;
}

export function renderEdView(data: LeadsData, chartMode: ChartMode): string {
  const ed = data.ed;
  if (!ed || ed.daily.length === 0) {
    return `
      <section class="card">
        <div class="card__title">ED Leads</div>
        <p class="footnote" style="text-align:left;margin-top:6px">
          No ED data available yet. Deploy the updated Apps Script (it reads the
          ED sheet's current month tab) to populate this view.
        </p>
      </section>
    `;
  }
  const agg = edAggregate(ed.daily);
  const flag = ed.cumulative && ed.benchmark
    ? renderFlag(ed.cumulative, ed.benchmark.high, ed.benchmark.low)
    : "";
  const chart = ed.cumulative
    ? chartCardHtml(ed.date || data.today.date, chartMode, ed.benchmark != null)
    : "";
  return `${stripHtml(ed, agg)}${flag}${chart}${tableHtml(ed, agg)}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
