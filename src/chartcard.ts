// Shared "Leads today" chart card + legend markup (§4.4). Used by the HD
// detail view and — once its sheet has a Cumul. Leads tab — the ED view too.
// Only one detail view is on screen at a time, so the ids stay unique.

import { longDay } from "./compute.ts";

export type ChartMode = "cumulative" | "hourly";

export function chartCardHtml(
  dateDmy: string,
  mode: ChartMode,
  hasBand: boolean,
): string {
  const day = `${longDay(dateDmy)} (in progress)`;
  const subtitle = hasBand ? `vs typical day · ${day}` : day;
  return `
    <section class="card chart-card">
      <div class="card__head">
        <div>
          <div class="card__title">Leads today</div>
          <div class="card__subtitle">${esc(subtitle)}</div>
        </div>
        <div class="toggle" role="group" aria-label="Chart mode">
          <button class="toggle__seg ${mode === "cumulative" ? "is-active" : ""}"
                  data-mode="cumulative" type="button"
                  aria-pressed="${mode === "cumulative"}">Cumulative</button>
          <button class="toggle__seg ${mode === "hourly" ? "is-active" : ""}"
                  data-mode="hourly" type="button"
                  aria-pressed="${mode === "hourly"}">Per hour</button>
        </div>
      </div>
      <div class="chart-box"><canvas id="chart"></canvas></div>
      <div class="legend" id="legend">${legendHtml(mode, hasBand)}</div>
    </section>
  `;
}

export function legendHtml(mode: ChartMode, hasBand: boolean): string {
  if (mode === "cumulative") {
    return `
      <span class="legend__item"><span class="swatch swatch--today"></span>Today</span>
      ${
        hasBand
          ? `<span class="legend__item"><span class="swatch swatch--typical"></span>Typical day</span>
      <span class="legend__item"><span class="swatch swatch--band"></span>Typical range</span>`
          : ""
      }
    `;
  }
  return `
    <span class="legend__item"><span class="swatch swatch--bar"></span>Today / hour</span>
    ${
      hasBand
        ? `<span class="legend__item"><span class="swatch swatch--typical"></span>Typical / hour</span>`
        : ""
    }
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
