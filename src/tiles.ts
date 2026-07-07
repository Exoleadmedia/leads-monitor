// HD / ED "today so far" tiles (top of the page). They double as a selector:
// clicking a tile switches the detail view below to that vertical. Each tile is
// colour-coded so the vertical is obvious at a glance — HD purple, ED amber.
//
// Both tiles show today's cumulative total vs a TIME-OF-DAY typical (via
// computePace, which compares today[cutoff] to the benchmark at the same hour)
// when their sheet has a Cumul. Leads tab. Until the ED sheet grows benchmark
// rows, the ED tile falls back to the whole-day total with month-to-date as
// context — there is no honest intraday pace to show without a band.

import { computePace, formatInt, shortDay } from "./compute.ts";
import type { Pace } from "./compute.ts";
import type { LeadsData, Vertical } from "./types.ts";

const TREND_ICON: Record<string, string> = {
  ahead: "▲",
  behind: "▼",
  onpace: "•",
  none: "•",
};

const TREND_CLASS: Record<string, string> = {
  ahead: "tile__trend--green",
  behind: "tile__trend--red",
  onpace: "tile__trend--blue",
  none: "tile__trend--muted",
};

/** Pace chip + typical-by-hour note, shared by both tiles. */
function paceFootHtml(pace: Pace): string {
  const pct = Math.round(Math.abs(pace.variance) * 100);
  const chip =
    pace.tone === "none"
      ? "no leads yet"
      : `${TREND_ICON[pace.tone]} ${pct}% vs typical`;

  const note =
    pace.tone === "none"
      ? "waiting for the first leads"
      : `typical ~${formatInt(pace.typicalAt)} by ${pace.cutoff}:00`;

  return `
        <span class="tile__trend ${TREND_CLASS[pace.tone]}">${esc(chip)}</span>
        <span class="tile__note">${esc(note)}</span>`;
}

/** The HD tile: today's leads so far + a pace chip against the typical curve. */
function hdTileHtml(data: LeadsData, active: boolean): string {
  const pace = computePace(
    data.today.cumulative,
    data.benchmark.high,
    data.benchmark.low,
  );
  return tileShell(
    "hd", "HD Leads", "today so far", active,
    formatInt(pace.todayAt), paceFootHtml(pace),
  );
}

/** The ED tile: mirrors the HD one when ED cumulative + benchmark data exist. */
function edTileHtml(data: LeadsData, active: boolean): string {
  const ed = data.ed;

  // Show which day the figure is for when it differs from HD's "today" (e.g.
  // during a month/day rollover) so the two tiles are never silently misaligned.
  const tag =
    ed && ed.date && ed.date !== data.today.date ? shortDay(ed.date) : "today so far";

  if (ed?.cumulative && ed.benchmark) {
    const pace = computePace(ed.cumulative, ed.benchmark.high, ed.benchmark.low);
    return tileShell(
      "ed", "ED Leads", tag, active,
      formatInt(pace.todayAt), paceFootHtml(pace),
    );
  }

  // No cumulative/benchmark data yet — whole-day total + month-to-date context.
  const value = ed && ed.todayLeads != null ? formatInt(ed.todayLeads) : "—";
  let note = "no ED data";
  if (ed) {
    if (ed.monthToDate != null) {
      note = `${formatInt(ed.monthToDate)} this month`;
    } else if (ed.date) {
      note = `as of ${shortDay(ed.date)}`;
    }
  }
  return tileShell("ed", "ED Leads", tag, active, value, `
        <span class="tile__note">${esc(note)}</span>`);
}

/** Shared clickable card shell so both tiles stay structurally identical. */
function tileShell(
  vertical: Vertical,
  name: string,
  tag: string,
  active: boolean,
  value: string,
  footInner: string,
): string {
  return `
    <button type="button"
            class="tile tile--${vertical}${active ? " is-active" : ""}"
            data-vertical="${vertical}" aria-pressed="${active}">
      <div class="tile__head">
        <span class="tile__name">${esc(name)}</span>
        <span class="tile__tag">${esc(tag)}</span>
      </div>
      <div class="tile__value">${value}</div>
      <div class="tile__foot">${footInner}</div>
    </button>
  `;
}

export function renderTiles(data: LeadsData, selected: Vertical): string {
  return `
    <div class="tiles" role="group" aria-label="Choose vertical">
      ${hdTileHtml(data, selected === "hd")}
      ${edTileHtml(data, selected === "ed")}
    </div>
  `;
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
