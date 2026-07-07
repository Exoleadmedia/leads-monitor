// Daily breakdown table (§4.5, §5.3).

import {
  aggregate,
  formatCpl,
  formatInt,
  formatMoney,
  formatRoas,
  roasChipTone,
  roasMedian,
  shortDay,
} from "./compute.ts";
import type { DailyRow, LeadsData } from "./types.ts";

export function renderTable(data: LeadsData): string {
  const { daily } = data;
  const median = roasMedian(daily);
  const totals = aggregate(daily);

  // Highlight today's row; until the monthly tab has one (early in the day),
  // fall back to the latest row.
  const hasToday = daily.some((r) => r.date === data.today.date);
  const highlightDate = hasToday ? data.today.date : lastDate(daily);

  // Newest first.
  const rows = [...daily].reverse();

  const body = rows
    .map((row) => renderRow(row, median, row.date === highlightDate))
    .join("");

  return `
    <section class="card">
      <div class="card__title">
        Daily breakdown
        <span class="card__hint">newest first · ${rows.length} days</span>
      </div>
      <div class="table-wrap">
        <table class="daily">
          <thead>
            <tr>
              <th class="num--left">Date</th>
              <th>Paid</th>
              <th>Revenue</th>
              <th>CPL</th>
              <th>Profit</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr>
              <td class="num--left">Total</td>
              <td>${formatInt(totals.paid)}</td>
              <td>${formatMoney(totals.revenue)}</td>
              <td>${formatCpl(totals.cplAvg)}</td>
              <td>${formatMoney(totals.profit)}</td>
              <td>${formatRoas(totals.avgRoas)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  `;
}

function renderRow(row: DailyRow, median: number | null, isToday: boolean): string {
  const tone = roasChipTone(row.roas, median);
  const chip = `<span class="chip chip--${tone}">${formatRoas(row.roas)}</span>`;
  return `
    <tr class="${isToday ? "row--today" : ""}">
      <td class="num--left">${esc(shortDay(row.date))}</td>
      <td>${row.paidLeads == null ? "—" : formatInt(row.paidLeads)}</td>
      <td>${formatMoney(row.revenue)}</td>
      <td>${formatCpl(row.cpl)}</td>
      <td>${formatMoney(row.adjProfit)}</td>
      <td>${chip}</td>
    </tr>
  `;
}

function lastDate(daily: DailyRow[]): string {
  return daily.length ? daily[daily.length - 1].date : "";
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
