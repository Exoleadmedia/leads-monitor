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

The **Form Performance page** does not use the Apps Script. It reads
`https://go.budgetwiseaustralia.com/api/form-stats`, a Cloudflare Pages Function
in `Exoleadmedia/web-budgetwise-australia` that queries the Supabase form
analytics views (schema in that repo's `sql/form-analytics.sql`) with the
Supabase key already held in that Cloudflare project, and returns per day
totals per form, device and UTM, 60 days back. Browsers may only read it from
`exoleadmedia.github.io` and `localhost` (CORS). Local runs without
`VITE_DATA_URL` use `public/forms-sample.json`; `VITE_FORMS_URL` overrides the
endpoint. If it's down that page says so; the Leads Monitor is unaffected.

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
  shell.ts        shared header, status pill and menu (both pages)
  forms-main.ts   Form Performance page bootstrap
  formsdata.ts    form data fetch (/api/form-stats), cache, fixture fallback
  formscompute.ts form funnel maths: filters, per form rows (pure)
  formsview.ts    Form Performance render and interactions
form-performance/index.html     the Form Performance page
public/leads-sample.json    bundled fixture
public/forms-sample.json    made up Form Performance fixture (used with no endpoint)
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

## Two pages, one repo

Split 2026-10-13 per Kevin, so each page only loads its own data:

| Page | URL | Entry |
|---|---|---|
| Leads Monitor | `exoleadmedia.github.io/leads-monitor/` | `index.html` → `src/main.ts` |
| Form Performance | `exoleadmedia.github.io/leads-monitor/form-performance/` | `form-performance/index.html` → `src/forms-main.ts` |

`vite.config.ts` builds both (`rollupOptions.input`). The Leads page never
loads forms code or `/api/form-stats`; Form Performance never loads Chart.js or
the Apps Script. Shared header, pill and menu live in `src/shell.ts`.

The menu (Leads, Forms, **Prompts**) is plain links: Leads and Forms switch
page, Prompts opens the prompt builder (`https://prompt-builder-d1j.pages.dev`,
`PROMPT_BUILDER_URL` in `shell.ts`) in a new tab. On desktop it sits in the
header row, right after the page title (per Kevin, 2026-10-13); on phones (≤700px) a bar fixed to the bottom with icons, and
the page gets extra bottom padding. Note `prompt-builder.pages.dev` without the
suffix is someone else's site.

**Leads Monitor on desktop (≥1100px):** two columns, tiles + month strip + pace
flag + chart on the left, the daily table on the right at the same height
(scrolling inside its card, sticky header and total), so the whole view fits on
one screen. Phones and narrow windows keep the single column.

## Form Performance page

Added 2026-10-09 per Kevin (design: `Claude outputs/form-dashboard-mockup.html`
in the Exolead folder). Compares every tracked lead form side by side: views,
started, % reached or quit at each question, completion, leads and the change
vs the previous period, with filters for range, site, device and UTM source,
campaign and ad (each list only shows what's under the choice before it).

- Its own page (see above); data refreshes every 5 minutes, on refresh and
  when the page becomes visible again.
- Table columns: Form, Views, one per question, Contact form, **Completion**
  (leads ÷ views, as a blue cell like the questions so the last drop-off reads
  the same way), Leads, Δ. "Started" was removed 2026-10-13 per Kevin (it
  duplicated Q2).
- **Layout switches by itself:** when every visible form asks the same
  questions in the same order, question names go in the headers; otherwise
  columns are positions with the name inside each cell. "By question" lines up
  the same question across forms. Question order per form comes from the whole
  60 day payload, so columns don't reshuffle when a filter empties a question.
- **Looks like the mockup on purpose** (Kevin, 2026-10-09: "the mockup looks
  better"): its styles are ported into `ui.css` under `.forms` / `ff-` classes,
  separate from the dashboard's own tokens. It's read mostly on desktop, so the
  tab uses the full window width; question columns share the spare width
  equally (`table-layout: fixed` + `<colgroup>`). Phones scroll the table.
- **Phones (≤700px)** get their own layout (Kevin, 2026-10-09: the squeezed
  desktop view was "horrible"): one card per form instead of the table (stats,
  a coloured strip with a block per question, tap to open the question list),
  a "Sort by" select instead of column headers, traffic filters behind a
  button, short mode labels, no help paragraph. Both layouts are rendered;
  CSS shows one (`.ff-desktop` / `.ff-phone`).
- **Biggest leak** (red outline) needs at least 10 people shown the question.
- Form names are the page path; the site badge comes from the `_c_dt` prefix
  (`goBWA_...` is BWA, `newsAHC_...` is AHC). Add new site codes to
  `SITE_NAMES` and their live domain to `SITE_HOSTS` in `formscompute.ts`.
- The small ↗ after each form name opens the live page in a new tab, tagged
  `?utm_source=dashboard`, so those visits show up as their own source in the
  Traffic filter (pick another source, or exclude it, to keep them out).
- `node verify.ts` includes hand checked form funnel cases.
- Data volume: the payload is per day per UTM combination, paged 1000 rows at
  a time from Supabase by `/api/form-stats`. If it grows slow after the rollout to every site, add a
  pre-aggregated table or a Postgres function rather than widening the range.
