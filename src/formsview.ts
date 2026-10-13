// Form Performance view: every form's funnel side by side. Desktop: a summary
// band, then the funnel table (rows open into a detail panel). Phones (design
// "D" from the mobile options canvas): the same band, then one card per form
// that opens into its funnel.

import {
  buildFormsView,
  verticalOf,
  formDetail,
  MIN_LEAK_SAMPLE,
  periodOf,
  sameQuestions,
  SITE_NAMES,
  siteOf,
  sortRows,
} from "./formscompute.ts";
import { fetchForms } from "./formsdata.ts";
import type { Breakdown, Filters, FormRow, FormsPayload, Mode, SortKey, Vertical } from "./formscompute.ts";
import type { DataSource, SyncStatus } from "./types.ts";

const STALE_MS = 5 * 60 * 1000;

let payload: FormsPayload | null = null;
let source: DataSource | null = null;
let loadedAt = 0;
let loading = false;
let failed = false;
let root: HTMLElement | null = null;
let onStatus: (() => void) | null = null;

// Health (HD) or energy (ED) forms; "#ed" in the URL opens straight on energy.
const startVertical: Vertical = location.hash === "#ed" ? "ed" : "hd";
let filters: Filters = { vertical: startVertical, range: 7, site: "", device: "", src: "", camp: "", ad: "" };
let mode: Mode = "reach";
let sort: SortKey = "comp";
let panelOpen = false; // filter panel (desktop dropdown, phone bottom sheet)
// Compare mode (desktop): tick up to 3 forms to see them side by side.
let compareOn = false;
let picked: string[] = [];
let cmpMode: "reach" | "continue" = "reach"; // per Kevin: % of visitors reached by default
const MAX_PICK = 3;
const PICK_COLORS = ["#2a78d6", "#e07b26", "#7a4fc9"];
const openRows = new Set<string>(); // forms whose detail is open (table rows and phone cards)

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

/**
 * Small arrow that opens the live form page in a new tab. Tagged
 * utm_source=dashboard so these visits can be told apart (and filtered out)
 * in the Traffic filter.
 */
function openLink(r: FormRow): string {
  if (!r.url) return "";
  const href = `${r.url}?utm_source=dashboard`;
  return `<a class="ff-open" href="${esc(href)}" target="_blank" rel="noopener" title="Open ${esc(r.name)} in a new tab" aria-label="Open ${esc(r.name)} in a new tab">↗</a>`;
}

const pct = (p: number): string => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
const int = (n: number): string => n.toLocaleString("en-AU");

const HELP: Record<Mode, string> = {
  reach: "% of visitors who reached each question.",
  drop: "% who quit at each step, of the people shown it.",
  question: "The same question across every form, wherever it sits (#n = its position). Cell = % who quit there.",
};

const ICON_FILTER = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18l-7 8v6l-4 2v-8z"/></svg>`;

/** "8 Oct" from "2026-10-08". */
function shortDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
}

function draw(): void {
  if (!root) return;
  if (!payload) {
    root.innerHTML = `<div class="forms"><div class="ff-card"><p class="ff-empty">${
      failed ? "Couldn't load form data. Tap refresh to try again." : "Loading form funnels…"
    }</p></div></div>`;
    return;
  }
  const p = payload;
  const view = buildFormsView(p, filters);
  filters = view.filters;
  const period = periodOf(p, filters);
  const label = (k: string): string => (k === "lead" ? "Contact form" : p.labels[k] ?? k);
  const rows = sortRows(view.rows, sort);
  const byQ = mode === "question";
  const simple = !byQ && sameQuestions(rows);
  const maxQ = Math.max(0, ...rows.map((r) => r.qs.length - 1));
  const keyOrder = [...Object.keys(p.labels), ...rows.flatMap((r) => r.qs)].filter((k) => k !== "lead");
  const byQKeys = [...new Set(keyOrder)].filter((k) => rows.some((r) => r.qs.includes(k)));
  const cols: (number | string)[] = byQ
    ? [...byQKeys, "lead"]
    : [...Array(simple ? rows[0].qs.length - 1 : maxQ).keys(), "lead"];
  const vertical = filters.vertical ?? "hd";
  const sites = [...new Set(p.groups.filter((g) => verticalOf(g.f) === vertical).map((g) => siteOf(g.f)))].sort();
  const tv = rows.reduce((s, r) => s + r.views, 0);
  const tl = rows.reduce((s, r) => s + r.leads, 0);
  const traffic = Boolean(filters.src || filters.camp || filters.ad);
  const filtered = Boolean(filters.site || filters.device || traffic);
  const plural = (n: number, w: string) => `${int(n)} ${w}${n === 1 ? "" : "s"}`;
  const periodText = filters.range === 0
    ? `${shortDate(period.from)} – ${shortDate(period.to)}`
    : filters.range === 1 ? "today" : `the last ${filters.range} days`;
  const prevText = filters.range === 1 ? "previous day" : `previous ${plural(period.days, "day")}`;

  // ---- Band: headline numbers, date and filters -------------------------
  const rangeBtn = (v: string, t: string) => {
    const on = String(filters.range) === v;
    return `<button type="button" data-range="${v}" class="${on ? "on" : ""}" aria-pressed="${on}">${t}</button>`;
  };
  const summary = [
    (periodText.replace(/^the /, "").charAt(0).toUpperCase() + periodText.replace(/^the /, "").slice(1)),
    filters.site ? SITE_NAMES[filters.site] ?? filters.site : "All sites",
    filters.device ? (filters.device === "mobile" ? "Mobile" : "Desktop") : "All devices",
    traffic ? [filters.src, filters.camp, filters.ad].filter(Boolean).join(" › ") : "All traffic",
  ].join(" · ");
  // Health / energy tiles: each shows its own summary for the period and the
  // other filters (a site filter only applies to its own vertical).
  const verticalTile = (v: Vertical, name: string, code: string): string => {
    const t = v === vertical ? { rows, tv, tl } : (() => {
      const other = buildFormsView(p, { ...filters, vertical: v, site: "" }).rows;
      return { rows: other, tv: other.reduce((s, r) => s + r.views, 0), tl: other.reduce((s, r) => s + r.leads, 0) };
    })();
    const on = v === vertical;
    return `<button type="button" class="ff-vtile${on ? " on" : ""}" data-vertical="${v}" aria-pressed="${on}">
      <span class="ff-vtile__name">${name} <span class="ff-vtile__code">${code}</span></span>
      ${t.rows.length
        ? `<span class="ff-vtile__big">${pct(t.tl / Math.max(1, t.tv))}</span><span class="ff-vtile__sub">${plural(t.tl, "lead")} from ${int(t.tv)} views · ${plural(t.rows.length, "form")}</span>`
        : `<span class="ff-vtile__big">–</span><span class="ff-vtile__sub">No tracked forms ${t.rows.length === 0 && filtered ? "match these filters" : "yet"}</span>`}
    </button>`;
  };
  const band = `
    <section class="ff-band">
      <div class="ff-vtiles" role="group" aria-label="Vertical">${verticalTile("hd", "Health", "HD")}${verticalTile("ed", "Energy", "ED")}</div>
      <div class="ff-band__controls">
        <div class="ff-bseg" role="group" aria-label="Period">${rangeBtn("1", "Today")}${rangeBtn("7", "7 days")}${rangeBtn("30", "30 days")}${rangeBtn("0", "Custom")}</div>
        <button type="button" class="ff-bfilter${filtered ? " is-on" : ""}" data-panel aria-expanded="${panelOpen}">${ICON_FILTER}<span class="ff-bfilter__label">Filters</span>${filtered ? `<span class="ff-dot" aria-hidden="true"></span>` : ""}</button>
      </div>
      ${filters.range === 0 ? `
      <div class="ff-band__custom">
        <label>From <input type="date" data-date="from" value="${period.from}" min="${esc(p.since ?? "")}" max="${p.today}"></label>
        <label>To <input type="date" data-date="to" value="${period.to}" min="${esc(p.since ?? "")}" max="${p.today}"></label>
      </div>` : ""}
      <button type="button" class="ff-band__summary" data-panel>${esc(summary)}${view.hidden ? ` · ${plural(view.hidden, "form")} hidden` : ""}</button>
    </section>`;

  // ---- Filter panel (desktop dropdown / phone bottom sheet) -------------
  const chip = (attr: string, v: string, t: string, on: boolean) =>
    `<button type="button" class="ff-chip${on ? " on" : ""}" ${attr}="${esc(v)}" aria-pressed="${on}">${esc(t)}</button>`;
  // Traffic boxes: type or paste a value (e.g. a Facebook ad ID), or pick one
  // of the values seen in this period from the suggestion list.
  const combo = (name: string, all: string, cur: string, opts: string[]) =>
    `<span class="ff-combo${cur ? " active" : ""}"><input type="text" data-t="${name}" list="ff-dl-${name}" value="${esc(cur)}" placeholder="${esc(all)} · paste an ID" aria-label="${esc(all)}" autocomplete="off" autocapitalize="off" spellcheck="false">${
      cur ? `<button type="button" class="ff-combo__x" data-tclear="${name}" aria-label="Clear">×</button>` : ""
    }<datalist id="ff-dl-${name}">${opts.map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist></span>`;
  const panel = panelOpen ? `
    <div class="ff-panel-wrap">
      <button type="button" class="ff-panel-backdrop" data-close aria-label="Close filters"></button>
      <div class="ff-panel" role="dialog" aria-label="Filters">
        <div class="ff-panel__head"><span>Filters</span><button type="button" class="ff-link" data-reset>Reset</button></div>
        <div class="ff-panel__group"><span class="ff-panel__label">Site</span><div class="ff-chips">${chip("data-site", "", "All sites", !filters.site)}${sites.map((x) => chip("data-site", x, SITE_NAMES[x] ?? x, filters.site === x)).join("")}</div></div>
        <div class="ff-panel__group"><span class="ff-panel__label">Device</span><div class="ff-chips">${chip("data-device", "", "All devices", !filters.device)}${chip("data-device", "mobile", "Mobile", filters.device === "mobile")}${chip("data-device", "desktop", "Desktop", filters.device === "desktop")}</div></div>
        <div class="ff-panel__group"><span class="ff-panel__label">Traffic</span>
          <label class="ff-field"><span>Source</span>${combo("src", "All sources", filters.src, view.options.src)}</label>
          <label class="ff-field"><span>Campaign</span>${combo("camp", "All campaigns", filters.camp, view.options.camp)}</label>
          <label class="ff-field"><span>Ad</span>${combo("ad", "All ads", filters.ad, view.options.ad)}</label>
        </div>
        <div class="ff-panel__group ff-phone"><span class="ff-panel__label">Strip shows</span><div class="ff-chips">${chip("data-mode", "reach", "% reached", mode !== "drop")}${chip("data-mode", "drop", "Drop-off", mode === "drop")}</div></div>
        <button type="button" class="ff-panel__done" data-close>Show ${plural(rows.length, "form")}</button>
      </div>
    </div>` : "";

  // ---- Desktop table ------------------------------------------------------
  const th = (k: SortKey, text: string, cls = ""): string =>
    `<th data-k="${k}" class="${cls}${sort === k ? " sorted" : ""}">${text}</th>`;
  const head =
    th("name", "Form", "form l") + th("views", "Views") +
    cols.map((c) =>
      c === "lead" ? `<th class="step">Form<span class="q">Contact form</span></th>`
      : byQ ? `<th class="step">${esc(label(String(c)))}<span class="q">any position</span></th>`
      : simple ? `<th class="step">Q${Number(c) + 1}<span class="q">${esc(label(rows[0].qs[Number(c)]))}</span></th>`
      : `<th class="step">Q${Number(c) + 1}<span class="q">position</span></th>`).join("") +
    th("comp", 'Completion<span class="q">leads ÷ views</span>', "step") + th("leads", "Leads") + th("delta", "Δ");
  const nCols = 2 + cols.length + 3;
  const deltaHtml = (d: number | null): string =>
    d == null ? `<span class="ff-delta">–</span>`
    : Math.abs(d) < 0.05 ? `<span class="ff-delta">0.0</span>`
    : `<span class="ff-delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲ +" : "▼ −"}${Math.abs(d).toFixed(1)}</span>`;

  const leakText = (r: FormRow): string => {
    if (r.leak < 0) return `Not enough visitors yet to call a biggest leak (needs ${MIN_LEAK_SAMPLE} on a step).`;
    const k = r.qs[r.leak];
    const where = k === "lead" ? "the contact form" : `Q${r.leak + 1} ${label(k)}`;
    return `<strong>Biggest leak: ${esc(where)}.</strong> ${pct(r.quit[r.leak] ?? 0)} of the people who reached it left there.`;
  };
  const funnel = (r: FormRow): string =>
    r.qs.map((k, i) => {
      const leak = i === r.leak;
      return `<div class="ff-fstep${leak ? " is-leak" : ""}"><span class="ff-fstep__l">${k === "lead" ? "Contact form" : `Q${i + 1} ${esc(label(k))}`}</span><span class="ff-fstep__bar"><i style="width:${Math.round(r.reach[i] * 100)}%"></i></span><span class="ff-fstep__v">${pct(r.reach[i])}</span></div>`;
    }).join("") +
    `<div class="ff-fstep is-done"><span class="ff-fstep__l">Lead saved</span><span class="ff-fstep__bar"><i style="width:${Math.round(r.comp * 100)}%"></i></span><span class="ff-fstep__v">${pct(r.comp)}</span></div>`;
  const breakdown = (title: string, items: Breakdown[]): string => `
    <div class="ff-bd"><span class="ff-bd__title">${title}</span>
      ${items.length ? `<table class="ff-bd__t"><thead><tr><th></th><th>Views</th><th>Leads</th><th>Completion</th></tr></thead><tbody>${items
        .map((b) => `<tr><td>${esc(b.label)}</td><td>${int(b.views)}</td><td>${int(b.leads)}</td><td>${pct(b.comp)}</td></tr>`).join("")}</tbody></table>`
        : `<p class="ff-bd__none">No visits.</p>`}
    </div>`;

  const body = rows.map((r, ri) => {
    const nq = r.qs.length - 1;
    const open = openRows.has(r.id);
    const cell = (i: number): string => {
      const k = r.qs[i];
      const quit = r.quit[i];
      const sub = byQ ? (k === "lead" ? "last step" : `#${i + 1} of ${nq}`) : label(k);
      const val = mode === "reach" ? pct(r.reach[i]) : quit == null ? "–" : `−${pct(quit)}`;
      const shade = mode === "reach" ? r.reach[i] : quit == null ? 0 : 1 - Math.min(1, quit * 2.5);
      return `<td class="cell"><div class="ff-hm${i === r.leak ? " drop" : ""}" style="${cellStyle(shade)}" data-r="${ri}" data-i="${i}">${val}${simple ? "" : `<small>${esc(sub)}</small>`}</div></td>`;
    };
    const na = `<td class="cell"><div class="ff-hm na">–</div></td>`;
    const cells = cols.map((c) => {
      if (c === "lead") return cell(nq);
      if (byQ) { const i = r.qs.indexOf(String(c)); return i < 0 ? na : cell(i); }
      return Number(c) < nq ? cell(Number(c)) : na;
    }).join("");
    let detail = "";
    if (open) {
      const d = formDetail(p, filters, r.id);
      detail = `<tr class="ff-detail"><td colspan="${nCols}"><div class="ff-detail__in">
        <div class="ff-detail__funnel"><span class="ff-bd__title">Funnel · % of visitors reached</span>${funnel(r)}<p class="ff-leak${r.leak < 0 ? " is-none" : ""}">${leakText(r)}</p></div>
        ${breakdown("By device", d.devices)}
        ${breakdown("Top traffic sources", d.sources)}
      </div></td></tr>`;
    }
    return `<tr class="ff-row${open ? " is-open" : ""}${compareOn && picked.includes(r.id) ? " is-picked" : ""}" data-id="${esc(r.id)}" aria-expanded="${open}">
      <td class="form l" title="${esc(r.name)}"><div class="ff-formcell">${compareOn ? pickBox(r) : ""}<span class="ff-chev" aria-hidden="true">${open ? "▾" : "▸"}</span>${pickDot(r.id)}<span class="ff-site">${esc(r.site)}</span><span class="ff-fname ff-fname--full">${esc(r.name)}</span>${openLink(r)}</div></td>
      <td>${int(r.views)}</td>${cells}
      <td class="cell"><div class="ff-hm ff-hm--comp" style="${cellStyle(r.comp)}">${pct(r.comp)}${simple ? "" : "<small>Completion</small>"}</div></td>
      <td>${int(r.leads)}</td>
      <td>${deltaHtml(r.delta)}</td>
    </tr>${detail}`;
  }).join("");
  const colgroup = `<colgroup><col class="c-form"><col class="c-num">${cols.map(() => "<col>").join("")}<col><col class="c-num"><col class="c-num"></colgroup>`;
  const ramp = RAMP.filter((_, i) => i % 2 === 0).map((c) => `<span style="background:${c}"></span>`).join("");
  const modeBtn = (v: Mode, t: string) => `<button type="button" data-mode="${v}" class="${mode === v ? "on" : ""}" aria-pressed="${mode === v}">${t}</button>`;
  const badge = byQ ? "Compare by question" : simple ? "Same questions on every form" : "Forms differ: names inside cells";

  const shownPicks = picked.filter((id) => rows.some((r) => r.id === id));
  const desktop = `
    <div class="ff-tablebar ff-desktop">
      <div class="ff-seg">${modeBtn("reach", "% reached")}${modeBtn("drop", "Drop-off per step")}${modeBtn("question", "Compare by question")}</div>
      <span class="ff-tablebar__help"><span class="ff-layout${simple ? " is-simple" : ""}">${badge}</span> ${compareOn ? "Tick 2 or 3 forms to compare them below." : `${HELP[mode]} Click a row for details, a header to sort.`}</span>
      <button type="button" class="ff-cmpbtn${compareOn ? " on" : ""}" data-compare aria-pressed="${compareOn}">${compareOn ? "Comparing · pick up to 3" : "Compare forms"}</button>
    </div>
    <div class="ff-card ff-desktop">
      <div class="ff-scroll"><table class="ff-table">${colgroup}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="ff-legend">
        ${mode === "reach" ? `<span>% reached <span class="ff-ramp">${ramp}</span> 0% → 100%</span>` : `<span>Darker = fewer people quit <span class="ff-ramp">${ramp}</span></span>`}
        <span><span class="ff-dropkey"></span>Biggest leak in that form (min. ${MIN_LEAK_SAMPLE} people)</span>
        <span>Grey = form doesn't have that ${byQ ? "question" : "many questions"}</span>
        <span>Δ = completion vs the ${esc(prevText)}, in points</span>
      </div>
    </div>
    ${compareOn ? compareHtml(rows, shownPicks, label, Object.keys(p.labels), periodText) : ""}
    ${compareOn ? `<div class="ff-tray ff-desktop"><div class="ff-tray__in"><span>${shownPicks.length} of ${MAX_PICK} forms selected</span>${
      shownPicks.length >= 2 ? `<a class="ff-tray__go" href="#ff-compare">See comparison ↓</a>` : ""
    }<button type="button" class="ff-tray__done" data-compare>Done</button></div></div>` : ""}`;

  // ---- Phone cards (design D) ---------------------------------------------
  const sortOpts: [SortKey, string][] = [["comp", "by completion"], ["views", "by views"], ["leads", "by leads"], ["delta", "by change"], ["name", "by name"]];
  const quitMode = mode !== "reach";
  const cards = `
    <div class="ff-phone">
      <div class="ff-listbar">
        <label class="ff-listbar__sort">${plural(rows.length, "form")} <select data-sort aria-label="Sort forms">${sortOpts
          .map(([k, t]) => `<option value="${k}"${k === sort ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <span>Tap a form for its funnel</span>
      </div>
      <div class="ff-card ff-cards">${rows.map((r) => {
        const strip = r.qs.map((k, i) => {
          const q = r.quit[i];
          const shade = quitMode ? (q == null ? 0 : 1 - Math.min(1, q * 2.5)) : r.reach[i];
          return `<span class="ff-strip__b${i === r.leak ? " drop" : ""}" style="${cellStyle(shade)}" title="${esc(label(k))}"></span>`;
        }).join("");
        const leakShort = r.leak < 0 ? "" : r.qs[r.leak] === "lead" ? "Leak: contact form" : `Leak: Q${r.leak + 1}`;
        return `<details class="ff-fc" data-id="${esc(r.id)}"${openRows.has(r.id) ? " open" : ""}>
          <summary>
            <div class="ff-fc__head"><span class="ff-site">${esc(r.site)}</span><span class="ff-fc__name">${esc(r.name)}</span><span class="ff-fc__comp">${pct(r.comp)}</span><span class="ff-fc__chev" aria-hidden="true"></span></div>
            <div class="ff-strip" aria-hidden="true">${strip}</div>
            <div class="ff-fc__meta"><span>${plural(r.views, "view")} · ${plural(r.leads, "lead")}${r.delta != null && Math.abs(r.delta) >= 0.05 ? ` · ${deltaHtml(r.delta)}` : ""}</span><span class="ff-fc__leak">${leakShort}</span></div>
          </summary>
          <div class="ff-fc__body">
            <div class="ff-fc__cap"><span>Step</span><span>% of visitors reached</span></div>
            ${funnel(r)}
            <p class="ff-leak${r.leak < 0 ? " is-none" : ""}">${leakText(r)}</p>
            <div class="ff-fc__foot"><span>${plural(r.views, "view")} · ${plural(r.leads, "lead")}</span>${r.url ? `<a class="ff-openbtn" href="${esc(r.url)}?utm_source=dashboard" target="_blank" rel="noopener">Open page ↗</a>` : ""}</div>
          </div>
        </details>`;
      }).join("")}</div>
    </div>`;

  root.innerHTML = `
    <div class="forms">
      ${band}
      ${panel}
      ${rows.length ? desktop + cards : `<div class="ff-card"><p class="ff-empty">No form visits in ${esc(periodText)}${filtered ? " with these filters" : ""}.${traffic ? " If you pasted an ID, check it matches the ad or campaign exactly, or widen the dates." : ""}</p></div>`}
      <p class="ff-notes">"Leads" = leads saved in the leads database (counted only once the save succeeds, on every form). "Completion" = leads ÷ page views. Conditional questions (e.g. Insurer, only asked to people who have insurance) are measured against the people who were actually shown them. Days are Sydney time; test visits on preview links are excluded.</p>
      <div class="ff-tip" id="ff-tip"></div>
    </div>`;

  wire(rows, label);
}

function wire(rows: FormRow[], label: (k: string) => string): void {
  if (!root) return;
  const r0 = root;
  const on = (sel: string, ev: string, fn: (el: HTMLElement, e: Event) => void) =>
    r0.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener(ev, (e) => fn(el, e)));

  on("[data-range]", "click", (el) => {
    const v = Number(el.dataset.range);
    if (v === 0) {
      // Custom starts from whatever was showing, so the dates make sense.
      const cur = periodOf(payload as FormsPayload, filters);
      filters = { ...filters, range: 0, from: filters.from ?? cur.from, to: filters.to ?? cur.to };
    } else {
      filters = { ...filters, range: v };
    }
    draw();
  });
  on("input[data-date]", "change", (el) => {
    const v = (el as HTMLInputElement).value;
    if (!v) return;
    filters = { ...filters, [el.dataset.date as "from" | "to"]: v };
    draw();
  });
  on("[data-vertical]", "click", (el) => {
    const v = el.dataset.vertical as Vertical;
    if (v === (filters.vertical ?? "hd")) return;
    // A site, campaign or ad from the other vertical would match nothing here.
    filters = { ...filters, vertical: v, site: "", src: "", camp: "", ad: "" };
    history.replaceState(null, "", v === "ed" ? "#ed" : location.pathname + location.search);
    draw();
  });
  on("[data-panel]", "click", () => { panelOpen = !panelOpen; draw(); });
  on("[data-close]", "click", () => { panelOpen = false; draw(); });
  on("[data-reset]", "click", () => {
    filters = { ...filters, site: "", device: "", src: "", camp: "", ad: "" };
    mode = "reach";
    draw();
  });
  on("[data-site]", "click", (el) => { filters = { ...filters, site: el.dataset.site ?? "" }; draw(); });
  on("[data-device]", "click", (el) => { filters = { ...filters, device: el.dataset.device ?? "" }; draw(); });
  on("[data-mode]", "click", (el) => { mode = el.dataset.mode as Mode; draw(); });
  const setTraffic = (k: "src" | "camp" | "ad", raw: string) => {
    const v = raw.trim();
    if (v === (filters[k] ?? "")) return;
    filters = { ...filters, [k]: v };
    // A new source or campaign resets the choices under it.
    if (k === "src") filters.camp = filters.ad = "";
    if (k === "camp") filters.ad = "";
    draw();
  };
  // Applies on Enter, on leaving the box, or on picking a suggestion.
  on("input[data-t]", "change", (el) => setTraffic(el.dataset.t as "src" | "camp" | "ad", (el as HTMLInputElement).value));
  on("input[data-t]", "keydown", (el, e) => {
    if ((e as KeyboardEvent).key === "Enter") setTraffic(el.dataset.t as "src" | "camp" | "ad", (el as HTMLInputElement).value);
  });
  on("[data-tclear]", "click", (el) => setTraffic(el.dataset.tclear as "src" | "camp" | "ad", ""));
  on("select[data-sort]", "change", (el) => { sort = (el as HTMLSelectElement).value as SortKey; draw(); });
  on("th[data-k]", "click", (el) => { sort = el.dataset.k as SortKey; draw(); });
  // Desktop rows open into their detail panel (the open-page arrow still just opens the page).
  on("[data-compare]", "click", () => { compareOn = !compareOn; draw(); });
  on("input[data-pick]", "change", (el) => {
    const id = el.dataset.pick ?? "";
    if (picked.includes(id)) picked = picked.filter((x) => x !== id);
    else if (picked.length < MAX_PICK) picked = [...picked, id];
    draw();
  });
  on("[data-cmpmode]", "click", (el) => { cmpMode = el.dataset.cmpmode as "reach" | "continue"; draw(); });
  on("[data-cmpclear]", "click", () => { picked = []; draw(); });
  on("tr.ff-row", "click", (el, e) => {
    if ((e.target as HTMLElement).closest("a, label, input")) return;
    const id = el.dataset.id ?? "";
    if (openRows.has(id)) openRows.delete(id);
    else openRows.add(id);
    draw();
  });
  r0.querySelectorAll<HTMLDetailsElement>("details.ff-fc").forEach((d) => {
    d.addEventListener("toggle", () => {
      const id = d.dataset.id ?? "";
      if (d.open) openRows.add(id);
      else openRows.delete(id);
    });
  });

  // Desktop tooltip on the heat cells.
  const tip = r0.querySelector<HTMLElement>("#ff-tip");
  if (!tip) return;
  r0.querySelectorAll<HTMLElement>(".ff-hm[data-r]").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const r = rows[Number(el.dataset.r)];
      const i = Number(el.dataset.i);
      const k = r.qs[i];
      const q = r.quit[i];
      tip.innerHTML =
        `<b>${esc(r.name)}</b>${k === "lead" ? "Contact form" : `Q${i + 1} · ${esc(label(k))}`}<br>` +
        `Shown to: ${int(r.shown[i])} (${pct(r.reach[i])} of visitors)<br>` +
        `Quit here: ${int(r.dropped[i])}${q == null ? "" : ` (−${pct(q)})`}` +
        (k === "insurer" ? "<br><i>Only asked to people who have insurance</i>" : "");
      tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 270)}px`;
      tip.style.top = `${e.clientY + 14}px`;
      tip.style.opacity = "1";
    });
    el.addEventListener("mouseleave", () => (tip.style.opacity = "0"));
  });
}

function pickBox(r: FormRow): string {
  const on = picked.includes(r.id);
  const full = !on && picked.length >= MAX_PICK;
  const title = on ? `Remove ${r.name} from the comparison` : full ? `Up to ${MAX_PICK} forms` : `Add ${r.name} to the comparison`;
  return `<label class="ff-pick" title="${esc(title)}"><input type="checkbox" data-pick="${esc(r.id)}"${on ? " checked" : ""}${full ? " disabled" : ""} aria-label="${esc(title)}"></label>`;
}

function pickDot(id: string): string {
  const i = compareOn ? picked.indexOf(id) : -1;
  return i < 0 ? "" : `<span class="ff-pdot" style="background:${PICK_COLORS[i]}" aria-hidden="true"></span>`;
}

/**
 * Side-by-side comparison of 2 or 3 forms (design: "Desktop · compare forms" on
 * the mobile options canvas). Completion is the verdict; then every question,
 * lined up by question rather than position, with the best value in green and
 * the weakest in red.
 */
function compareHtml(rows: FormRow[], ids: string[], label: (k: string) => string, keyOrder: string[], periodText: string): string {
  if (ids.length < 2) {
    return `<section class="ff-cmp-hint ff-desktop">${ids.length ? "Tick one more form to start the comparison." : "Tick 2 or 3 forms in the table to see them side by side here."}</section>`;
  }
  const forms = ids.map((id) => rows.find((r) => r.id === id) as FormRow);
  const color = (f: FormRow) => PICK_COLORS[picked.indexOf(f.id)];
  const dot = (f: FormRow) => `<span class="ff-pdot" style="background:${color(f)}" aria-hidden="true"></span>`;
  const r1 = (x: number) => Math.round(x * 1000) / 10; // fraction -> % with one decimal
  const n = forms.length;
  const cols = `190px repeat(${n}, minmax(0, 1fr)) 260px`;

  // Verdict: completion.
  const comps = forms.map((f) => r1(f.comp));
  const best = Math.max(...comps);
  const tie = comps.filter((c) => c === best).length > 1;
  const second = [...comps].sort((a, b) => b - a)[1];
  const verdicts = forms.map((f, j) => {
    const isBest = !tie && comps[j] === best;
    const gap = isBest
      ? `+${(best - second).toFixed(1)} pts${second > 0 ? ` · ${(best / second).toFixed(1)}× the next form` : ""}`
      : best - comps[j] > 0 ? `${(best - comps[j]).toFixed(1)} pts behind` : "";
    return `<div class="ff-verdict${isBest ? " is-best" : ""}">
      <div class="ff-verdict__head"><span class="ff-verdict__name">${dot(f)}<span class="ff-site">${esc(f.site)}</span>${esc(f.name)}</span>${isBest ? `<span class="ff-verdict__badge">Best completion</span>` : tie && comps[j] === best ? `<span class="ff-verdict__tie">Tied</span>` : ""}</div>
      <div class="ff-verdict__big"><span>${pct(f.comp)}</span> completion</div>
      <span class="ff-verdict__bar"><i style="width:${best ? Math.max(2, (comps[j] / best) * 100) : 0}%"></i></span>
      <div class="ff-verdict__foot"><span>${int(f.leads)} leads from ${int(f.views)} views</span><span class="${isBest ? "ff-good" : "ff-bad"}">${gap}</span></div>
    </div>`;
  }).join("");

  // Step by step, lined up by question.
  const order = [...new Set([...keyOrder, ...forms.flatMap((f) => f.qs)])].filter((k) => k !== "lead");
  const keys = [...order.filter((k) => forms.some((f) => f.qs.includes(k))), "lead"];
  const wins = forms.map(() => 0);
  const value = (f: FormRow, i: number): number | null =>
    cmpMode === "reach" ? f.reach[i] : f.quit[i] == null ? null : 1 - (f.quit[i] as number);
  const row = (name: string, vals: (number | null)[], pos: string[], total: boolean, someOnly: boolean): string => {
    const pcts = vals.map((v) => (v == null ? null : r1(v)));
    const ok = pcts.filter((v): v is number => v != null);
    const hi = ok.length >= 2 ? Math.max(...ok) : null;
    const lo = ok.length >= 2 ? Math.min(...ok) : null;
    const winner = hi != null && lo != null && hi - lo >= 0.5 && pcts.filter((v) => v === hi).length === 1 ? pcts.indexOf(hi) : -1;
    if (winner >= 0 && !total) wins[winner]++;
    const gap = winner >= 0 ? (hi as number) - (lo as number) : 0;
    const cells = pcts.map((v, j) => {
      if (v == null) return `<span class="ff-ccell is-na">Not asked</span>`;
      const cls = j === winner ? " is-win" : winner >= 0 && v === lo ? " is-low" : "";
      return `<span class="ff-ccell${cls}"><span class="ff-ccell__v">${pct((vals[j] as number))}</span><span class="ff-ccell__p">${esc(pos[j])}</span></span>`;
    }).join("");
    const lead = winner >= 0
      ? `<span class="ff-gap__bar"><i style="width:${Math.min(100, gap * 3)}%"></i></span><span class="ff-gap__t ff-good">${dot(forms[winner])}+${gap.toFixed(1)} pts</span>`
      : `<span class="ff-gap__bar"></span><span class="ff-gap__t">${ok.length >= 2 ? "Level" : ""}</span>`;
    return `<div class="ff-crow${total ? " is-total" : ""}" style="grid-template-columns:${cols}"><span class="ff-crow__l">${esc(name)}${someOnly ? " *" : ""}</span>${cells}<span class="ff-gap">${lead}</span></div>`;
  };
  const steps = keys.map((k) => {
    const idx = forms.map((f) => f.qs.indexOf(k));
    return row(
      label(k),
      forms.map((f, j) => (idx[j] < 0 ? null : value(f, idx[j]))),
      forms.map((_, j) => (idx[j] < 0 ? "" : k === "lead" ? "last" : `#${idx[j] + 1}`)),
      false,
      idx.some((i) => i < 0),
    );
  }).join("") + row("Completion", forms.map((f) => f.comp), forms.map(() => "leads ÷ views"), true, false);
  const score = forms.map((f, j) => `<span class="ff-score">${dot(f)}${esc(f.name)} leads on ${wins[j]} ${wins[j] === 1 ? "step" : "steps"}</span>`).join("");
  const modeBtn = (v: "reach" | "continue", t: string) => `<button type="button" data-cmpmode="${v}" class="${cmpMode === v ? "on" : ""}" aria-pressed="${cmpMode === v}">${t}</button>`;

  return `<section class="ff-compare ff-desktop" id="ff-compare">
    <div class="ff-compare__head"><div><h2>Comparing ${n} forms</h2><span>${esc(periodText.charAt(0).toUpperCase() + periodText.slice(1))} · same filters as the table</span></div><button type="button" class="ff-link" data-cmpclear>Clear</button></div>
    <div class="ff-verdicts" style="grid-template-columns:repeat(${n}, minmax(0, 1fr))">${verdicts}</div>
    <div class="ff-compare__bar">
      <div class="ff-compare__score"><h3>Step by step</h3>${score}</div>
      <div class="ff-seg">${modeBtn("reach", "% of visitors reached")}${modeBtn("continue", "Continued past each step")}</div>
    </div>
    <p class="ff-compare__help">${cmpMode === "reach" ? "Share of all visitors who got as far as each question; early losses carry through to later steps." : "Of the people shown each question, the share who went on (contact form: who became a lead), so every step is judged on its own."} Green = best on that step, red = weakest. * = not asked on every form.</p>
    <div class="ff-ctable">
      <div class="ff-crow is-head" style="grid-template-columns:${cols}"><span>Question</span>${forms.map((f) => `<span class="ff-ccol">${dot(f)}<span>${esc(f.name)}</span></span>`).join("")}<span>Who leads, by how much</span></div>
      ${steps}
    </div>
  </section>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
