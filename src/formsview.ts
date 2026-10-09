// Forms tab view: compares every form's funnel side by side (design:
// "Claude outputs/form-dashboard-mockup.html"). Data is fetched the first time
// the tab is opened and on refresh, never as part of the leads view's load.

import {
  buildFormsView,
  MIN_LEAK_SAMPLE,
  sameQuestions,
  SITE_NAMES,
  siteOf,
  sortRows,
} from "./formscompute.ts";
import { fetchForms } from "./formsdata.ts";
import type { Filters, FormRow, FormsPayload, Mode, SortKey } from "./formscompute.ts";
import type { DataSource, SyncStatus } from "./types.ts";

const STALE_MS = 5 * 60 * 1000;

let payload: FormsPayload | null = null;
let source: DataSource | null = null;
let loadedAt = 0;
let loading = false;
let failed = false;
let root: HTMLElement | null = null;
let onStatus: (() => void) | null = null;

let filters: Filters = { range: 7, site: "", device: "", src: "", camp: "", ad: "" };
let mode: Mode = "reach";
let sort: SortKey = "comp";
let detail = "";

/** Header pill state for the Forms tab. */
export function formsStatus(): { status: SyncStatus; syncedAt: string } {
  if (loading) return { status: "syncing", syncedAt: payload?.syncedAt ?? "" };
  const status: SyncStatus =
    source === "live" ? "live" : source === "cache" ? "cached" : "snapshot";
  return { status, syncedAt: payload?.syncedAt ?? "" };
}

export function isFormsLoading(): boolean {
  return loading;
}

/** Show the Forms tab in `el`. Fetches when there's no data yet or it's stale. */
export function mountForms(el: HTMLElement, statusChanged: () => void): void {
  root = el;
  onStatus = statusChanged;
  draw();
  if (!payload || Date.now() - loadedAt > STALE_MS) void refreshForms();
}

export function unmountForms(): void {
  root = null;
}

export async function refreshForms(): Promise<void> {
  if (loading) return;
  loading = true;
  onStatus?.();
  if (!payload) draw();
  try {
    const r = await fetchForms();
    payload = r.data;
    source = r.source;
    loadedAt = Date.now();
    failed = false;
  } catch (err) {
    console.error("[leads-monitor] forms data unavailable:", err);
    failed = true;
  } finally {
    loading = false;
  }
  onStatus?.();
  draw();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const RAMP = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
  "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b",
];

function cellStyle(p: number): string {
  const i = Math.max(0, Math.min(RAMP.length - 1, Math.round(p * (RAMP.length - 1))));
  return `background:${RAMP[i]};color:${i >= 6 ? "#fff" : "#0b0b0b"}`;
}

/** Long page names differ at the end (-b, -c), so cut the middle, not the end. */
function shortName(name: string, max = 26): string {
  return name.length <= max ? name : `${name.slice(0, 9)}…${name.slice(-(max - 10))}`;
}

const pct = (p: number): string => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
const int = (n: number): string => n.toLocaleString("en-AU");

const HELP: Record<Mode, string> = {
  reach:
    "Cell = % of page visitors who reached that question. When the forms shown ask the same questions in the same order, the names go in the headers; when they differ, columns follow each form's own order and the name is inside each cell. The contact form is always the last column.",
  drop: "Cell = % who quit at that step, out of the people who were shown it. Same automatic layout as % reached.",
  question:
    "One column per question, wherever it sits in each form (#n = its position). Cell = % who quit at that question. Shows whether a question loses people everywhere, or only where it's placed.",
};

function draw(): void {
  if (!root) return;
  if (!payload) {
    root.innerHTML = failed
      ? `<p class="fatal">Couldn't load form data. Tap refresh to try again.</p>`
      : `<div class="skeleton">Loading form funnels…</div>`;
    return;
  }

  const view = buildFormsView(payload, filters);
  filters = view.filters;
  const labels = payload.labels;
  const label = (k: string): string => (k === "lead" ? "Contact form" : labels[k] ?? k);
  const rows = sortRows(view.rows, sort);
  const byQ = mode === "question";
  const simple = !byQ && sameQuestions(rows);
  const maxQ = Math.max(0, ...rows.map((r) => r.qs.length - 1));

  // Columns: question positions, or question keys in compare-by-question mode.
  const keyOrder = [...Object.keys(labels), ...rows.flatMap((r) => r.qs)].filter((k) => k !== "lead");
  const byQKeys = [...new Set(keyOrder)].filter((k) => rows.some((r) => r.qs.includes(k)));
  const cols: (number | string)[] = byQ
    ? [...byQKeys, "lead"]
    : [...Array(simple ? rows[0].qs.length - 1 : maxQ).keys(), "lead"];

  const sites = [...new Set(payload.groups.map((g) => siteOf(g.f)))].sort();
  const tv = rows.reduce((s, r) => s + r.views, 0);
  const tl = rows.reduce((s, r) => s + r.leads, 0);
  const byComp = rows.slice().sort((a, b) => b.comp - a.comp);

  const seg = (name: string, cur: string, opts: [string, string][]): string =>
    `<div class="toggle" data-seg="${name}">${opts
      .map(([v, t]) => `<button type="button" class="toggle__seg${v === cur ? " is-active" : ""}" data-v="${v}" aria-pressed="${v === cur}">${t}</button>`)
      .join("")}</div>`;
  const select = (name: string, all: string, cur: string, opts: [string, string][]): string =>
    `<select class="fselect${cur ? " is-set" : ""}" data-f="${name}" aria-label="${esc(all)}"><option value="">${esc(all)}</option>${opts
      .map(([v, t]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(t)}</option>`)
      .join("")}</select>`;
  const own = (vals: string[]): [string, string][] => vals.map((v) => [v, v]);

  const th = (k: SortKey, text: string, cls = ""): string =>
    `<th data-k="${k}" class="${cls}${sort === k ? " is-sorted" : ""}">${text}</th>`;
  const head =
    th("name", "Form", "fcol-form") + th("views", "Views") + th("started", "Started") +
    cols
      .map((c) =>
        c === "lead" ? `<th class="fstep">Form<span>Contact form</span></th>`
        : byQ ? `<th class="fstep">${esc(label(String(c)))}<span>any position</span></th>`
        : simple ? `<th class="fstep">Q${Number(c) + 1}<span>${esc(label(rows[0].qs[Number(c)]))}</span></th>`
        : `<th class="fstep">Q${Number(c) + 1}<span>position</span></th>`,
      )
      .join("") +
    th("comp", "Completion") + th("leads", "Leads") + th("delta", "Δ");

  const body = rows
    .map((r, ri) => {
      const nq = r.qs.length - 1;
      const cell = (i: number): string => {
        const k = r.qs[i];
        const quit = r.quit[i];
        const sub = byQ ? (k === "lead" ? "last step" : `#${i + 1} of ${nq}`) : label(k);
        const val = mode === "reach" ? pct(r.reach[i]) : quit == null ? "–" : `−${pct(quit)}`;
        const shade = mode === "reach" ? r.reach[i] : quit == null ? 0 : 1 - Math.min(1, quit * 2.5);
        return `<td class="fcell"><button type="button" class="hm${i === r.leak ? " hm--leak" : ""}" style="${cellStyle(shade)}" data-r="${ri}" data-i="${i}">${val}${simple ? "" : `<small>${esc(sub)}</small>`}</button></td>`;
      };
      const na = `<td class="fcell"><div class="hm hm--na">–</div></td>`;
      const cells = cols
        .map((c) => {
          if (c === "lead") return cell(nq);
          if (byQ) {
            const i = r.qs.indexOf(String(c));
            return i < 0 ? na : cell(i);
          }
          return Number(c) < nq ? cell(Number(c)) : na;
        })
        .join("");
      const d = r.delta;
      return `<tr>
        <td class="fcol-form" title="${esc(r.name)}"><span class="site-tag">${esc(r.site)}</span>${esc(shortName(r.name))}</td>
        <td>${int(r.views)}</td>
        <td>${r.started == null ? "–" : pct(r.started)}</td>
        ${cells}
        <td><span class="fcomp">${pct(r.comp)}<span class="fcomp__bar"><i style="width:${Math.min(100, (r.comp * 100) / 0.4)}%"></i></span></span></td>
        <td>${int(r.leads)}</td>
        <td>${d == null ? `<span class="fdelta">–</span>`
          : Math.abs(d) < 0.05 ? `<span class="fdelta">0.0</span>`
          : `<span class="fdelta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲ +" : "▼ −"}${Math.abs(d).toFixed(1)}</span>`}</td>
      </tr>`;
    })
    .join("");

  const kpi = (l: string, v: string, d: string, small = false): string =>
    `<div class="fkpi"><div class="fkpi__l">${l}</div><div class="fkpi__v${small ? " fkpi__v--small" : ""}" title="${esc(v)}">${esc(v)}</div><div class="fkpi__d">${d}</div></div>`;
  const kpis = rows.length
    ? kpi("Page views", int(tv), `${rows.length} form${rows.length > 1 ? "s" : ""}`) +
      kpi("Leads", int(tl), "&nbsp;") +
      kpi("Avg completion", pct(tl / Math.max(1, tv)), "leads ÷ views") +
      (rows.length > 1
        ? kpi("Best form", shortName(byComp[0].name, 30), `<span class="up">▲</span> ${pct(byComp[0].comp)} completion`, true) +
          kpi("Weakest form", shortName(byComp[byComp.length - 1].name, 30), `<span class="down">▼</span> ${pct(byComp[byComp.length - 1].comp)} completion`, true)
        : "")
    : "";

  const badge = byQ
    ? "Layout: compare by question"
    : simple ? `Layout: same questions on all ${rows.length} form${rows.length > 1 ? "s" : ""} (names in headers)`
    : "Layout: forms differ (names inside cells)";
  const ramp = RAMP.filter((_, i) => i % 2 === 0).map((c) => `<span style="background:${c}"></span>`).join("");
  const traffic = Boolean(filters.src || filters.camp || filters.ad);

  root.innerHTML = `
    <section class="forms">
      <div class="fbar">
        ${seg("range", String(filters.range), [["1", "Today"], ["7", "7 days"], ["30", "30 days"]])}
        ${seg("mode", mode, [["reach", "% reached"], ["drop", "Drop-off"], ["question", "By question"]])}
      </div>
      <div class="fbar">
        ${select("site", "All sites", filters.site, sites.map((s) => [s, SITE_NAMES[s] ?? s]))}
        ${select("device", "All devices", filters.device, [["mobile", "Mobile"], ["desktop", "Desktop"]])}
      </div>
      <div class="fbar">
        <span class="flabel">Traffic</span>
        ${select("src", "All sources", filters.src, own(view.options.src))}
        ${select("camp", "All campaigns", filters.camp, own(view.options.camp))}
        ${select("ad", "All ads", filters.ad, own(view.options.ad))}
        ${traffic ? `<button type="button" class="fclear" data-clear>Clear</button>` : ""}
      </div>
      ${view.hidden ? `<p class="fnote">${view.hidden} form${view.hidden > 1 ? "s" : ""} hidden (no traffic matching these filters)</p>` : ""}
      ${rows.length
        ? `<p class="fhelp"><span class="flayout${simple ? " is-simple" : ""}">${badge}</span> ${HELP[mode]}</p>
      <div class="fkpis">${kpis}</div>
      <section class="card ftable-card">
        <div class="fscroll"><table class="ftable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
        <p class="fdetail" id="fdetail">${detail ? esc(detail) : "Tap a cell for the numbers behind it."}</p>
        <div class="flegend">
          <span>${mode === "reach" ? `% reached <span class="framp">${ramp}</span> 0% → 100%` : `Darker = fewer people quit <span class="framp">${ramp}</span>`}</span>
          <span><span class="fleakkey"></span>Biggest leak in that form (min. ${MIN_LEAK_SAMPLE} people)</span>
          <span>Grey = form doesn't have that ${byQ ? "question" : "many questions"}</span>
          <span>Δ = completion vs the previous ${filters.range === 1 ? "day" : `${filters.range} days`}, in points</span>
        </div>
      </section>`
        : `<section class="card"><p class="fempty">No form visits in this period${traffic || filters.site || filters.device ? " with these filters" : " yet"}.</p></section>`}
      <p class="footnote">"Started" = answered the first question. "Completion" = leads ÷ page views. Questions only some people get (e.g. Insurer, only asked to people with insurance) are measured against the people who were shown them. Days are Sydney time; test visits on preview links are excluded.</p>
    </section>`;

  wire(rows, label);
}

function wire(rows: FormRow[], label: (k: string) => string): void {
  if (!root) return;
  root.querySelectorAll<HTMLElement>("[data-seg]").forEach((g) => {
    g.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-v]");
      if (!b) return;
      if (g.dataset.seg === "range") filters = { ...filters, range: Number(b.dataset.v) };
      else mode = b.dataset.v as Mode;
      detail = "";
      draw();
    });
  });
  root.querySelectorAll<HTMLSelectElement>("select[data-f]").forEach((s) => {
    s.addEventListener("change", () => {
      const k = s.dataset.f as keyof Filters;
      filters = { ...filters, [k]: s.value };
      // A new source or campaign resets the choices under it.
      if (k === "src") filters.camp = filters.ad = "";
      if (k === "camp") filters.ad = "";
      detail = "";
      draw();
    });
  });
  root.querySelector("[data-clear]")?.addEventListener("click", () => {
    filters = { ...filters, src: "", camp: "", ad: "" };
    detail = "";
    draw();
  });
  root.querySelectorAll<HTMLElement>("th[data-k]").forEach((h) => {
    h.addEventListener("click", () => {
      sort = h.dataset.k as SortKey;
      draw();
    });
  });
  root.querySelector(".ftable")?.addEventListener("click", (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".hm[data-r]");
    if (!c) return;
    const r = rows[Number(c.dataset.r)];
    const i = Number(c.dataset.i);
    const k = r.qs[i];
    const q = r.quit[i];
    detail =
      `${r.name} · ${k === "lead" ? "Contact form" : `Q${i + 1} ${label(k)}`}: ` +
      `shown to ${int(r.shown[i])} (${pct(r.reach[i])} of visitors), ` +
      `quit here ${int(r.dropped[i])}${q == null ? "" : ` (−${pct(q)})`}` +
      (k === "insurer" ? ". Only asked to people who have insurance." : ".");
    const el = root?.querySelector("#fdetail");
    if (el) el.textContent = detail;
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
