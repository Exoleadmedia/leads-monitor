# Leads Monitor

A mobile-first dashboard that tracks **today's incoming leads vs a typical day**
and shows a daily performance breakdown for the month. Built to be opened from a
phone, refreshing automatically (~5-minute freshness) from a Google Sheet.

Static single-page app: **Vite + vanilla TypeScript + Chart.js v4**. No backend
runtime — the only server-side piece is a small Google Apps Script that returns
JSON (so no Sheet credentials or PII ever reach the browser).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/  (static; deploy anywhere)
npm run preview    # serve the production build locally
```

With no data endpoint configured the app runs entirely off the bundled fixture
(`public/leads-sample.json`) and the status pill reads **"Sample data"** —
useful for local dev. Once live data has loaded at least once, an offline/failed
sync instead replays the last live payload from `localStorage` (see
[Sync resilience](#live-data)).

## Live data

1. Open the Google Sheet → **Extensions ▸ Apps Script**, paste
   [`apps-script/Code.gs`](apps-script/Code.gs). Monthly tabs are resolved
   automatically by name (`"June 2026"`, `"July 2026"`, …) for **both** the HD
   and ED sheets — no constant to bump each month. It reads the current month's
   tab, falling back to the most recent month that has data. Confirm the two
   spreadsheet IDs (`HD_SPREADSHEET_ID`, `ED_SPREADSHEET_ID`) and `CUMUL_TAB`.
   Deploy *Execute as: Me* so it can read both sheets you own.
2. **Deploy ▸ New deployment ▸ Web app**, *Execute as: Me*, *Who has access:
   Anyone*. Copy the resulting `…/exec` URL.
3. Put it in `.env`:
   ```
   VITE_DATA_URL=https://script.google.com/macros/s/XXXX/exec
   ```
4. `npm run build` (or `npm run dev`). The app now fetches live JSON, polls
   every 5 minutes, and re-fetches when the tab regains focus.

**Sync resilience (`src/data.ts` / `src/main.ts`).** The Apps Script endpoint
opens two sheets and can cold-start slowly, so a live fetch gets a 20s timeout
and two attempts. On success the payload is cached to `localStorage`. When a
sync fails, the app **replays the last successful live payload from this device**
(pill: *"Offline · last synced HH:MM"*) rather than the months-old bundled
sample — the sample (*"Sample data"*) only appears with no live data and no
cache. If a load still lands on non-live while an endpoint is configured, it
self-heals with a few quick retries instead of waiting the full 5-minute poll.

The Apps Script reads **only** each sheet's daily-summary (monthly) tab and its
`Cumul. Leads` tab, and parses money/percent cells to plain numbers server-side.
It never touches the lead-level/PII tabs (including the ED sheet's lead-level
tab). See `apps-script/Code.gs` and the build spec for the JSON contract.

The two top-of-page tiles read from this same payload and **double as a vertical
selector** (colour-coded — HD purple, ED amber): both show today's cumulative
total vs the time-of-day typical (HD from `today.cumulative` + `benchmark`, ED
from `ed.cumulative` + `ed.benchmark`). If the ED sheet has no `Cumul. Leads`
tab yet, the ED tile falls back to the whole-day total (`ed.todayLeads`, with
`ed.monthToDate` as context) and shows no intraday pace. If `ed` is absent
(older endpoint) the tile shows "—".

Clicking a tile switches the detail below it (`vertical` state in `main.ts`):
each vertical shows its "…so far" strip + pace flag + "Leads today" chart +
daily table (`src/edview.ts` for ED). HD is the default. The ED flag/chart only
render when `ed.cumulative`/`ed.benchmark` are present, so the view degrades to
strip + table on older payloads.

## Deploy

**Live:** https://healthpulse35.github.io/leads-monitor/

Deployment is automated via GitHub Actions (`.github/workflows/deploy.yml`):
every push to `main` builds the app and publishes `dist/` to GitHub Pages. The
build-time `VITE_DATA_URL` is stored as a repo **variable** (Settings → Secrets
and variables → Actions → Variables), so it's not committed to source; if it's
unset the build falls back to the bundled fixture.

`npm run build` also emits a standalone static `dist/` you can drop on any host
(Netlify, Vercel, …). `vite.config.ts` uses `base: "./"` so relative asset paths
work on project-subpath hosts like GitHub Pages.

To point at a different endpoint, update the `VITE_DATA_URL` repo variable
(`gh variable set VITE_DATA_URL --body "<url>"`) and re-run the workflow — note a
*new* Apps Script deployment mints a *new* `/exec` URL, while updating an existing
deployment keeps the same one.

## Project layout

```
src/
  main.ts      bootstrap: fetch → state → render; 5-min poll; visibilitychange; toggle
  data.ts      fetchData(): hit endpoint, validate shape, fall back to fixture
  compute.ts   typical/cutoff/variance/aggregates + all number & date formatters
  chart.ts     Chart.js cumulative-band and per-hour charts
  flag.ts      pace flag banner
  table.ts     daily breakdown table
  ui.css       design tokens + components (light mode only)
  types.ts     the JSON contract types
public/
  leads-sample.json   bundled fixture / offline fallback
apps-script/Code.gs   the Sheet-side data endpoint (deployed separately)
verify.ts             acceptance check — `node verify.ts` runs the compute
                      functions against the fixture (all 25 spec numbers)
```

## Verifying the numbers

```bash
node verify.ts
```

Runs the real `compute.ts` functions against the fixture and asserts every
number in the spec's acceptance criteria — paid-leads total (9,130), revenue
($216,517 / $216.5k), profit ($90,674), avg ROAS (1.70), cutoff hour (13),
`typical[13]` (147), variance (−19%), median ROAS (1.71), and the ROAS chip
colors. Requires Node ≥ 22 (runs TypeScript directly).

## Business logic (where to look)

All calculations live in `src/compute.ts` and follow the build spec §5:

- **Typical line** = midpoint of the benchmark high/low band.
- **Cutoff hour** = last hour today's cumulative increased; the "Today" line/bars
  stop there so an in-progress day doesn't show a flat future.
- **Pace flag** compares `today[cutoff]` to `typical[cutoff]`: ≤ −10% red
  (behind), ≥ +10% green (ahead), else blue (on pace).
- **ROAS chips** color relative to the month's median ROAS.
