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
let trafficOpen = false; // phones: traffic dropdowns tucked behind a button
const openCards = new Set<string>(); // phones: form cards showing their question list

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

// Wording from the mockup.
const HELP: Record<Mode, string> = {
  reach:
    "Switches automatically: when all the forms shown ask the same questions in the same order, question names go in the headers; when they differ, columns follow each form's own order and the question name is printed inside each cell. The contact form always lines up in the last column.",
  drop: "Same automatic layout, but each cell shows the % who quit at that step (of the people who were shown it).",
  question:
    "Columns = the same question across every form, wherever it sits in that form (#n = its position). Cell = % who quit at that question. Use this to see if a question loses people on every form, or only where it's placed.",
};

function draw(): void {
  if (!root) return;
  if (!payload) {
    root.innerHTML = `<div class="forms">${
      failed
        ? `<div class="ff-card"><p class="ff-empty">Couldn't load form data. Tap refresh to try again.</p></div>`
        : `<div class="ff-card"><p class="ff-empty">Loading form funnels…</p></div>`
    }</div>`;
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
  const traffic = Boolean(filters.src || filters.camp || filters.ad);

  const seg = (name: string, cur: string, opts: [string, string, string?][]): string =>
    `<div class="ff-seg" data-seg="${name}">${opts
      .map(([v, t, short]) => `<button type="button" data-v="${v}" class="${v === cur ? "on" : ""}" aria-pressed="${v === cur}">${
        short ? `<span class="ff-lg">${t}</span><span class="ff-sm">${short}</span>` : t
      }</button>`)
      .join("")}</div>`;
  const select = (name: string, all: string, cur: string, opts: [string, string][]): string =>
    `<select data-f="${name}" class="${cur ? "active" : ""}" aria-label="${esc(all)}"><option value="">${esc(all)}</option>${opts
      .map(([v, t]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(t)}</option>`)
      .join("")}</select>`;
  const own = (vals: string[]): [string, string][] => vals.map((v) => [v, v]);

  const th = (k: SortKey, text: string, cls = ""): string =>
    `<th data-k="${k}" class="${cls}${sort === k ? " sorted" : ""}">${text}</th>`;
  const head =
    th("name", "Form", "form l") + th("views", "Views") + th("started", "Started") +
    cols
      .map((c) =>
        c === "lead" ? `<th class="step">Form<span class="q">Contact form</span></th>`
        : byQ ? `<th class="step">${esc(label(String(c)))}<span class="q">any position</span></th>`
        : simple ? `<th class="step">Q${Number(c) + 1}<span class="q">${esc(label(rows[0].qs[Number(c)]))}</span></th>`
        : `<th class="step">Q${Number(c) + 1}<span class="q">position</span></th>`,
      )
      .join("") +
    th("leads", "Leads") + th("comp", "Completion") + th("delta", "Δ");

  const body = rows
    .map((r, ri) => {
      const nq = r.qs.length - 1;
      const cell = (i: number): string => {
        const k = r.qs[i];
        const quit = r.quit[i];
        const sub = byQ ? (k === "lead" ? "last step" : `#${i + 1} of ${nq}`) : label(k);
        const val = mode === "reach" ? pct(r.reach[i]) : quit == null ? "–" : `−${pct(quit)}`;
        const shade = mode === "reach" ? r.reach[i] : quit == null ? 0 : 1 - Math.min(1, quit * 2.5);
        return `<td class="cell"><div class="ff-hm${i === r.leak ? " drop" : ""}" style="${cellStyle(shade)}" data-r="${ri}" data-i="${i}">${val}${simple ? "" : `<small>${esc(sub)}</small>`}</div></td>`;
      };
      const na = `<td class="cell"><div class="ff-hm na">–</div></td>`;
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
      const delta =
        d == null ? `<span class="ff-delta">–</span>`
        : Math.abs(d) < 0.05 ? `<span class="ff-delta">0.0</span>`
        : `<span class="ff-delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲ +" : "▼ −"}${Math.abs(d).toFixed(1)}</span>`;
      return `<tr>
        <td class="form l" title="${esc(r.name)}"><span class="ff-site">${esc(r.site)}</span><span class="ff-fname ff-fname--full">${esc(r.name)}</span><span class="ff-fname ff-fname--short">${esc(shortName(r.name))}</span></td>
        <td>${int(r.views)}</td><td>${r.started == null ? "–" : pct(r.started)}</td>${cells}
        <td>${int(r.leads)}</td>
        <td><div class="ff-comp"><span>${pct(r.comp)}</span><span class="ff-bar"><i style="width:${Math.min(100, (r.comp * 100) / 0.4)}%"></i></span></div></td>
        <td>${delta}</td>
      </tr>`;
    })
    .join("");

  // Fixed widths for the number columns; the question columns share whatever
  // is left equally, so a bigger monitor gives every question cell more room.
  const colgroup =
    `<colgroup><col class="c-form"><col class="c-num"><col class="c-num">` +
    cols.map(() => `<col>`).join("") +
    `<col class="c-num"><col class="c-comp"><col class="c-num"></colgroup>`;

  // Phones: one card per form instead of the wide table. The strip has one
  // block per question (same colours as the table); tapping opens the list.
  const sortOpts: [SortKey, string][] = [["comp", "Completion"], ["views", "Views"], ["leads", "Leads"], ["started", "Started"], ["delta", "Change"], ["name", "Name"]];
  const cards = `<div class="ff-cards ff-phone">
      <label class="ff-sort">Sort by <select data-sort>${sortOpts
        .map(([k, t]) => `<option value="${k}"${k === sort ? " selected" : ""}>${t}</option>`)
        .join("")}</select></label>
      ${rows
        .map((r) => {
          const quitMode = mode !== "reach";
          const strip = r.qs
            .map((k, i) => {
              const quit = r.quit[i];
              const val = quitMode ? (quit == null ? "–" : pct(quit)) : pct(r.reach[i]);
              const shade = quitMode ? (quit == null ? 0 : 1 - Math.min(1, quit * 2.5)) : r.reach[i];
              return `<span class="ff-strip__b${i === r.leak ? " drop" : ""}" style="${cellStyle(shade)}" title="${esc(label(k))}">${val}</span>`;
            })
            .join("");
          const steps = r.qs
            .map((k, i) => {
              const quit = r.quit[i];
              return `<div class="ff-step${i === r.leak ? " is-leak" : ""}">
                <span class="ff-step__n">${k === "lead" ? "Form" : `Q${i + 1}`}</span>
                <span class="ff-step__l">${esc(label(k))}</span>
                <span class="ff-step__bar"><i style="width:${Math.round(r.reach[i] * 100)}%"></i></span>
                <span class="ff-step__v">${pct(r.reach[i])}</span>
                <span class="ff-step__q">${quit == null ? "–" : `−${pct(quit)}`}</span>
              </div>`;
            })
            .join("");
          const d = r.delta;
          const delta =
            d == null ? "" : Math.abs(d) < 0.05 ? `<span class="ff-delta">0.0</span>`
            : `<span class="ff-delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲ +" : "▼ −"}${Math.abs(d).toFixed(1)}</span>`;
          return `<details class="ff-fc" data-id="${esc(r.id)}"${openCards.has(r.id) ? " open" : ""}>
            <summary>
              <div class="ff-fc__head"><span class="ff-site">${esc(r.site)}</span><span class="ff-fc__name">${esc(r.name)}</span>${delta}</div>
              <div class="ff-fc__stats">
                <span><b>${int(r.views)}</b> views</span>
                <span><b>${r.started == null ? "–" : pct(r.started)}</b> started</span>
                <span><b>${int(r.leads)}</b> leads</span>
                <span class="ff-fc__comp"><b>${pct(r.comp)}</b><span class="ff-bar"><i style="width:${Math.min(100, (r.comp * 100) / 0.4)}%"></i></span></span>
              </div>
              <div class="ff-strip">${strip}</div>
            </summary>
            <div class="ff-steps">
              <div class="ff-step ff-step--head"><span></span><span>Question</span><span></span><span>Reached</span><span>Quit</span></div>
              ${steps}
            </div>
          </details>`;
        })
        .join("")}
    </div>`;

  const kpi = (l: string, v: string, d: string, small = false): string =>
    `<div class="ff-kpi"><div class="l">${l}</div><div class="v${small ? " small" : ""}" title="${esc(v)}">${esc(v)}</div><div class="d">${d}</div></div>`;
  const best = byComp[0];
  const worst = byComp[byComp.length - 1];
  const kpis =
    kpi("Page views", int(tv), `${rows.length} form${rows.length === 1 ? "" : "s"}`) +
    kpi("Leads", int(tl), "&nbsp;") +
    kpi("Avg completion", pct(tl / Math.max(1, tv)), "leads ÷ views") +
    (best
      ? kpi("Best form", best.name, `<span class="up">▲</span> ${pct(best.comp)} completion`, true) +
        kpi("Weakest form", worst.name, `<span class="down">▼</span> ${pct(worst.comp)} completion`, true)
      : kpi("Best form", "–", "&nbsp;", true) + kpi("Weakest form", "–", "&nbsp;", true));

  const badge = byQ
    ? "Layout: compare by question"
    : simple ? `Layout: same questions on all ${rows.length} form${rows.length === 1 ? "" : "s"} (names in headers)`
    : "Layout: forms differ (names inside cells)";
  const ramp = RAMP.filter((_, i) => i % 2 === 0).map((c) => `<span style="background:${c}"></span>`).join("");
  const range = filters.range === 1 ? "day" : `${filters.range} days`;

  root.innerHTML = `
    <div class="forms">
      <div class="ff-filters">
        ${seg("range", String(filters.range), [["1", "Today"], ["7", "7 days"], ["30", "30 days"]])}
        ${seg("mode", mode, [["reach", "% reached"], ["drop", "Drop-off per step", "Drop-off"], ["question", "Compare by question", "By question"]])}
        ${select("site", "All sites", filters.site, sites.map((x) => [x, SITE_NAMES[x] ?? x]))}
        ${select("device", "All devices", filters.device, [["mobile", "Mobile"], ["desktop", "Desktop"]])}
        <span class="ff-spacer"></span>
        <span class="ff-sub ff-desktop">Click a column header to sort</span>
      </div>
      <button type="button" class="ff-traffic-toggle${traffic ? " is-set" : ""}" data-traffic aria-expanded="${trafficOpen}">
        Traffic filters${traffic ? ` (${[filters.src, filters.camp, filters.ad].filter(Boolean).length})` : ""} <span aria-hidden="true">${trafficOpen ? "▴" : "▾"}</span>
      </button>
      <div class="ff-filters ff-traffic${trafficOpen ? " is-open" : ""}">
        <span class="ff-flabel">Traffic</span>
        <label class="ff-f"><span>Source</span>${select("src", "All sources", filters.src, own(view.options.src))}</label>
        <label class="ff-f"><span>Campaign</span>${select("camp", "All campaigns", filters.camp, own(view.options.camp))}</label>
        <label class="ff-f"><span>Ad</span>${select("ad", "All ads", filters.ad, own(view.options.ad))}</label>
        ${traffic ? `<button type="button" class="ff-clear" data-clear>Clear traffic filters</button>` : ""}
        <span class="ff-sub">${view.hidden ? `${view.hidden} form${view.hidden > 1 ? "s" : ""} hidden (no traffic matching these filters)` : ""}</span>
      </div>
      <p class="ff-modehelp"><span class="ff-layout${simple ? " is-simple" : ""}">${badge}</span> <span class="ff-desktop">${HELP[mode]}</span></p>
      <div class="ff-kpis">${kpis}</div>
      <div class="ff-card">
        ${rows.length
          ? `<div class="ff-scroll ff-desktop"><table class="ff-table">${colgroup}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${cards}`
          : `<p class="ff-empty">No form visits in this period${traffic || filters.site || filters.device ? " with these filters" : " yet"}.</p>`}
        <div class="ff-legend">
          ${mode === "reach" ? `<span>% reached <span class="ff-ramp">${ramp}</span> 0% → 100%</span>` : `<span>Darker = fewer people quit <span class="ff-ramp">${ramp}</span></span>`}
          <span><span class="ff-dropkey"></span>Biggest leak in that form (min. ${MIN_LEAK_SAMPLE} people)</span>
          <span>Grey = form doesn't have that ${byQ ? "question" : "many questions"}</span>
          <span>Δ = completion vs previous ${range}, in points</span>
        </div>
      </div>
      <p class="ff-notes">"Started" = answered the first question. "Leads" = leads saved in the leads database (counted only once the save succeeds, on every form). "Completion" = leads ÷ page views. Conditional questions (e.g. Insurer, only asked to people who have insurance) are measured against the people who were actually shown them. Days are Sydney time; test visits on preview links are excluded.</p>
      <div class="ff-tip" id="ff-tip"></div>
    </div>`;

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
      draw();
    });
  });
  root.querySelector("[data-traffic]")?.addEventListener("click", () => {
    trafficOpen = !trafficOpen;
    draw();
  });
  root.querySelector<HTMLSelectElement>("select[data-sort]")?.addEventListener("change", (e) => {
    sort = (e.target as HTMLSelectElement).value as SortKey;
    draw();
  });
  root.querySelectorAll<HTMLDetailsElement>("details.ff-fc").forEach((d) => {
    d.addEventListener("toggle", () => {
      const id = d.dataset.id ?? "";
      if (d.open) openCards.add(id);
      else openCards.delete(id);
    });
  });
  root.querySelector("[data-clear]")?.addEventListener("click", () => {
    filters = { ...filters, src: "", camp: "", ad: "" };
    draw();
  });
  root.querySelectorAll<HTMLElement>("th[data-k]").forEach((h) => {
    h.addEventListener("click", () => {
      sort = h.dataset.k as SortKey;
      draw();
    });
  });

  // Tooltip: hover on desktop, tap on a phone.
  const tip = root.querySelector<HTMLElement>("#ff-tip");
  if (!tip) return;
  const show = (el: HTMLElement, x: number, y: number): void => {
    const r = rows[Number(el.dataset.r)];
    const i = Number(el.dataset.i);
    const k = r.qs[i];
    const q = r.quit[i];
    tip.innerHTML =
      `<b>${esc(r.name)}</b>${k === "lead" ? "Contact form" : `Q${i + 1} · ${esc(label(k))}`}<br>` +
      `Shown to: ${int(r.shown[i])} (${pct(r.reach[i])} of visitors)<br>` +
      `Quit here: ${int(r.dropped[i])}${q == null ? "" : ` (−${pct(q)})`}` +
      (k === "insurer" ? "<br><i>Only asked to people who have insurance</i>" : "");
    tip.style.left = `${Math.min(x + 14, innerWidth - 270)}px`;
    tip.style.top = `${y + 14}px`;
    tip.style.opacity = "1";
  };
  root.querySelectorAll<HTMLElement>(".ff-hm[data-r]").forEach((el) => {
    el.addEventListener("mousemove", (e) => show(el, e.clientX, e.clientY));
    el.addEventListener("mouseleave", () => (tip.style.opacity = "0"));
    el.addEventListener("click", (e) => show(el, e.clientX, e.clientY));
  });
  root.querySelector(".ff-scroll")?.addEventListener("scroll", () => (tip.style.opacity = "0"));
  // Phones never fire mouseleave: a tap anywhere else closes the tooltip.
  root.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".ff-hm[data-r]")) tip.style.opacity = "0";
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
