# leads-monitor

A mobile first dashboard showing **today's incoming leads against a typical
day**, plus a daily performance breakdown for the month, for both verticals.
Built to be opened on a phone.

Static single page app: Vite + vanilla TypeScript + Chart.js v4. No backend. The
only server side piece is a Google Apps Script web app that returns JSON.

> **First time here?** The business context, the lead pipeline this measures and
> the reporting sheets behind it are documented in
> `git clone https://github.com/Exoleadmedia/exolead-ops.git`.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/
node verify.ts     # acceptance check, needs Node >= 22
```

With no data endpoint configured the app runs off the bundled fixture
`public/leads-sample.json` and the status pill reads "Sample data".

## Deploys

Push to `main` builds and publishes to **GitHub Pages** via
`.github/workflows/deploy.yml`. Unlike the `web-*` repos, `README.md` here is
hand written and safe to edit.

The data endpoint is a repo **variable**, `VITE_DATA_URL`, injected at build
time (Settings, Secrets and variables, Actions, Variables). It is never
committed. **If it is unset the build silently falls back to the sample
fixture**, which looks like working software showing stale numbers. That is the
main failure mode of this repo, check the status pill.

`gh variable set VITE_DATA_URL --body "<url>"` then re run the workflow to
repoint it. A **new** Apps Script deployment mints a new `/exec` URL, updating an
existing deployment keeps the same one.

The README records a live URL under a `healthpulse35.github.io` account while the
repo now sits under `Exoleadmedia`. Verify the current Pages URL in repo settings
before quoting it.

## Where the data comes from

`apps-script/Code.gs`, deployed separately from the Google Sheet:
Extensions, Apps Script, paste, then Deploy, New deployment, Web app, execute as
Me, access Anyone.

It reads **two** spreadsheets, HD and ED (`HD_SPREADSHEET_ID`,
`ED_SPREADSHEET_ID`), resolving the monthly tab by name (`"June 2026"`,
`"July 2026"`) so nothing needs bumping each month, plus each sheet's
`Cumul. Leads` tab. It falls back to the most recent month with data.

**It reads only the summary tabs, never the lead level tabs, and parses money and
percent cells to plain numbers server side. No personal data ever reaches the
browser. Keep it that way.**

## Sync resilience

The endpoint opens two sheets and can cold start slowly, so a live fetch gets a
20 second timeout and two attempts. On success the payload is cached to
`localStorage`. On failure the app **replays the last successful live payload
from that device** (pill: "Offline, last synced HH:MM") rather than falling back
to the months old fixture. The fixture only appears when there is no live data
and no cache.

## Layout

```
src/
  main.ts      bootstrap: fetch, state, render. 5 min poll, refetch on tab focus
  data.ts      fetchData(): hit endpoint, validate shape, fall back
  compute.ts   typical / cutoff / variance / aggregates, all formatters
  chart.ts     Chart.js cumulative band and per hour charts
  chartcard.ts tiles.ts flag.ts table.ts edview.ts   view components
  ui.css       design tokens, light mode only
  types.ts     the JSON contract
public/leads-sample.json    bundled fixture
apps-script/Code.gs         the Sheet side endpoint
verify.ts                   asserts all 25 spec numbers against the fixture
```

## Business logic

All of it is in `src/compute.ts`.

- **Typical line** is the midpoint of the benchmark high/low band.
- **Cutoff hour** is the last hour today's cumulative increased. Today's line
  stops there so an in progress day does not render as flat.
- **Pace flag** compares today at cutoff to typical at cutoff: 10% or more below
  is red, 10% or more above is green, otherwise blue.
- **ROAS chips** colour relative to the month's median ROAS.

The two top tiles double as the vertical selector, HD purple and ED amber.
Clicking one switches the detail below it. HD is the default. ED degrades
gracefully on older payloads: with no `Cumul. Leads` tab it shows the whole day
total and no intraday pace, and with no `ed` key at all it shows a dash.

## After changing compute logic

Run `node verify.ts`. It runs the real compute functions against the fixture and
asserts every number in the spec's acceptance criteria. If it passes, the maths
still matches what the dashboard promised.
