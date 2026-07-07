// Bootstrap: fetch -> state -> render; 5-min poll; refresh on tab focus (§3.4).

import "./ui.css";
import { fetchData, HAS_LIVE_ENDPOINT } from "./data.ts";
import {
  aggregate,
  clockHHMM,
  cutoffHour,
  formatInt,
  formatMoneyAbbr,
  formatRoas,
  monthLabel,
} from "./compute.ts";
import { destroyChart, renderChart } from "./chart.ts";
import type { ChartSeries } from "./chart.ts";
import { chartCardHtml, legendHtml } from "./chartcard.ts";
import { renderFlag } from "./flag.ts";
import { renderTable } from "./table.ts";
import { renderTiles } from "./tiles.ts";
import { renderEdView } from "./edview.ts";
import type { AppState, LeadsData, SyncStatus, Vertical } from "./types.ts";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (§3.4)

// Self-heal: if a load lands on the stale snapshot while a live endpoint exists
// (e.g. the endpoint was mid cold-start), retry a few times quickly instead of
// waiting the full 5-minute poll — so opening the app reliably reaches "Live".
const HEAL_DELAY_MS = 6_000;
const MAX_HEAL_ATTEMPTS = 3;

const app = document.getElementById("app") as HTMLElement;

let state: AppState | null = null;
let chartMode: "cumulative" | "hourly" = "cumulative";
let vertical: Vertical = "hd"; // which tile's detail is shown below
let fetching = false;
let healTimer: number | undefined; // pending self-heal retry
let healAttempts = 0; // fast retries used since the last successful live sync

// ---------------------------------------------------------------------------
// Status pill (§6)
// ---------------------------------------------------------------------------

function pillHtml(status: SyncStatus, syncedAt: string): string {
  const t = clockHHMM(syncedAt);
  let cls = "pill--live";
  let text = `Live · synced ${t}`;
  if (status === "syncing") {
    cls = "pill--syncing";
    text = "Syncing…";
  } else if (status === "cached") {
    // Last good live data replayed from this device (sync is currently failing).
    cls = "pill--snapshot";
    text = `Offline · last synced${t ? ` ${t}` : ""}`;
  } else if (status === "snapshot") {
    // Bundled sample — only shown when there's no live data or cache at all.
    cls = "pill--snapshot";
    text = "Sample data";
  }
  return `<span class="pill ${cls}"><span class="pill__dot"></span>${text}</span>`;
}

function sourceToStatus(source: AppState["source"]): SyncStatus {
  return source === "live" ? "live" : source === "cache" ? "cached" : "snapshot";
}

function setPill(status: SyncStatus): void {
  const el = document.getElementById("pill");
  if (el) el.innerHTML = pillHtml(status, state?.syncedAt ?? "");
}

/** Top-right header cluster: status pill + manual "force sync" button. */
function headerActions(status: SyncStatus, syncedAt: string): string {
  return `
    <div class="header__actions">
      <div id="pill">${pillHtml(status, syncedAt)}</div>
      <button id="refresh" class="refresh-btn" type="button"
              aria-label="Refresh now" title="Refresh now">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function stripHtml(data: LeadsData): string {
  const a = aggregate(data.daily);
  const cells = [
    { label: "Paid leads", value: formatInt(a.paid) },
    { label: "Revenue", value: formatMoneyAbbr(a.revenue) },
    { label: "Profit", value: formatMoneyAbbr(a.profit) },
    { label: "Avg ROAS", value: formatRoas(a.avgRoas) },
  ];
  const month = monthLabel(data.today.date);
  return `
    <section class="card strip-card">
      <div class="card__title">${esc(month)} so far</div>
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

function footnoteHtml(s: AppState): string {
  let source: string;
  if (s.source === "live") {
    source = "Source: Google Sheet (Cumul. Leads + monthly tab)";
  } else if (s.source === "cache") {
    source = "Source: last live sync on this device (offline)";
  } else {
    source = "Source: bundled sample (no live data yet)";
  }
  const when = s.syncedAt ? ` · last sync ${clockHHMM(s.syncedAt)}` : "";
  return `<p class="footnote">${esc(source)}${esc(when)}</p>`;
}

function render(): void {
  if (!state) return;
  const s = state;
  const month = monthLabel(s.data.today.date);

  const detail =
    vertical === "ed"
      ? renderEdView(s.data, chartMode)
      : `${stripHtml(s.data)}${renderFlag(
          s.data.today.cumulative,
          s.data.benchmark.high,
          s.data.benchmark.low,
        )}${chartCardHtml(s.data.today.date, chartMode, true)}${renderTable(s.data)}`;

  app.innerHTML = `
    <header class="header">
      <div>
        <h1 class="header__title">Leads Monitor</h1>
        <p class="header__subtitle">${esc(month)} · today vs typical day</p>
      </div>
      ${headerActions(sourceToStatus(s.source), s.syncedAt)}
    </header>
    ${renderTiles(s.data, vertical)}
    ${detail}
    ${footnoteHtml(s)}
  `;

  // No-ops when the current detail view has no chart (e.g. ED without a
  // Cumul. Leads tab yet — the canvas simply isn't in the DOM).
  drawChart();
  wireToggle();
  wireTiles();
  wireRefresh();
}

/** Clicking a tile switches which vertical's detail (graph/table) is shown. */
function wireTiles(): void {
  const tiles = app.querySelectorAll<HTMLButtonElement>(".tile[data-vertical]");
  tiles.forEach((tile) => {
    tile.addEventListener("click", () => {
      const v = tile.dataset.vertical as Vertical;
      if (v === vertical) return;
      vertical = v;
      render();
    });
  });
}

/** Wire the manual "force sync" button. Spins while a fetch is in flight. */
function wireRefresh(): void {
  const btn = document.getElementById("refresh") as HTMLButtonElement | null;
  if (!btn) return;
  if (fetching) {
    btn.classList.add("is-spinning");
    btn.disabled = true;
  }
  btn.addEventListener("click", () => {
    if (fetching) return;
    btn.classList.add("is-spinning");
    btn.disabled = true;
    void refresh(); // re-renders on completion, restoring the button
  });
}

/** The cumulative series the current detail view charts, or null if none. */
function chartSeries(): ChartSeries | null {
  if (!state) return null;
  if (vertical === "hd") {
    return {
      cumulative: state.data.today.cumulative,
      high: state.data.benchmark.high,
      low: state.data.benchmark.low,
    };
  }
  const ed = state.data.ed;
  if (!ed?.cumulative) return null;
  return {
    cumulative: ed.cumulative,
    high: ed.benchmark?.high ?? null,
    low: ed.benchmark?.low ?? null,
  };
}

function drawChart(): void {
  const canvas = document.getElementById("chart") as HTMLCanvasElement | null;
  const series = chartSeries();
  if (!canvas || !series) return;
  renderChart(canvas, series, chartMode, cutoffHour(series.cumulative));
}

function wireToggle(): void {
  const segs = app.querySelectorAll<HTMLButtonElement>(".toggle__seg");
  segs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode as "cumulative" | "hourly";
      if (mode === chartMode) return;
      chartMode = mode;
      segs.forEach((b) => {
        const active = b.dataset.mode === mode;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", String(active));
      });
      const legend = document.getElementById("legend");
      if (legend) legend.innerHTML = legendHtml(chartMode, chartSeries()?.high != null);
      drawChart();
    });
  });
}

// ---------------------------------------------------------------------------
// Data lifecycle
// ---------------------------------------------------------------------------

async function refresh(): Promise<void> {
  if (fetching) return;
  fetching = true;
  if (state) setPill("syncing");

  try {
    const { data, source } = await fetchData();
    state = { data, source, syncedAt: data.syncedAt, chartMode };
  } catch (err) {
    // validate() can still throw if even the fixture is malformed.
    console.error("[leads-monitor] failed to load any data:", err);
    if (state) {
      // Keep showing the last good data we already have.
    } else {
      app.innerHTML = `<p class="fatal">Couldn't load leads data. Check the data source and reload.</p>`;
      fetching = false;
      return;
    }
  } finally {
    fetching = false;
  }
  render();
  scheduleSelfHeal();
}

/**
 * When we're showing the snapshot but a live endpoint exists, retry soon (a few
 * times) so a cold-start miss upgrades to live within seconds. A successful live
 * sync resets the budget; the regular 5-min poll keeps trying after that.
 */
function scheduleSelfHeal(): void {
  if (healTimer !== undefined) {
    clearTimeout(healTimer);
    healTimer = undefined;
  }
  if (!state || !HAS_LIVE_ENDPOINT) return;
  if (state.source === "live") {
    healAttempts = 0; // reached live — reset the budget
    return;
  }
  if (healAttempts >= MAX_HEAL_ATTEMPTS) return; // give up fast retries; poll continues
  healAttempts++;
  healTimer = window.setTimeout(() => {
    healTimer = undefined;
    void refresh();
  }, HEAL_DELAY_MS);
}

function init(): void {
  // Initial shell so the screen is never blank while the first fetch runs.
  app.innerHTML = `
    <header class="header">
      <div>
        <h1 class="header__title">Leads Monitor</h1>
        <p class="header__subtitle">loading…</p>
      </div>
      ${headerActions("syncing", "")}
    </header>
    <div class="skeleton">Loading leads…</div>
  `;

  wireRefresh();
  void refresh();

  // Poll every 5 minutes.
  setInterval(() => void refresh(), POLL_INTERVAL_MS);

  // Refresh when the tab becomes visible again (reopening the phone). Reset the
  // self-heal budget so every reopen gets a fresh set of quick retries.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      healAttempts = 0;
      void refresh();
    }
  });

  // Clean up the chart on unload (avoids leaks on bfcache restores).
  window.addEventListener("pagehide", () => destroyChart());
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

init();
