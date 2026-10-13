// Forms tab maths: turn the /api/form-stats payload into one funnel row per form
// for the chosen filters. No browser or build-time dependencies, so verify.ts
// can run it under plain Node.

/** One form/day/device/traffic-source bucket. s[step] = [shown, dropped, sort order]. */
export interface FormsGroup {
  f: string;
  d: string; // "YYYY-MM-DD", Sydney day
  dev: string | null;
  src: string | null;
  camp: string | null;
  ad: string | null;
  v: number; // sessions that viewed the page
  l: number; // sessions that submitted the lead form
  s: Record<string, [number, number, number]>;
}

export interface FormsPayload {
  syncedAt: string;
  today: string; // "YYYY-MM-DD", Sydney
  since?: string; // first day the payload covers (custom range lower bound)
  labels: Record<string, string>; // question key -> display label
  forms: { id: string; path: string | null }[];
  groups: FormsGroup[];
}

export function validateForms(raw: unknown): FormsPayload {
  if (!raw || typeof raw !== "object") throw new Error("forms payload is not an object");
  const d = raw as Record<string, unknown>;
  if (typeof d.error === "string") throw new Error(`forms endpoint: ${d.error}`);
  if (!Array.isArray(d.groups) || !Array.isArray(d.forms) || typeof d.today !== "string") {
    throw new Error("forms payload is missing groups/forms/today");
  }
  return {
    syncedAt: typeof d.syncedAt === "string" ? d.syncedAt : new Date().toISOString(),
    today: d.today,
    since: typeof d.since === "string" ? d.since : undefined,
    labels: (d.labels && typeof d.labels === "object" ? d.labels : {}) as Record<string, string>,
    forms: d.forms as FormsPayload["forms"],
    groups: d.groups as FormsGroup[],
  };
}


// ---------------------------------------------------------------------------
// Filters and per-form rows
// ---------------------------------------------------------------------------

/** Filter value for a traffic field that was empty in the URL. */
export const NONE = "(none)";

export type Mode = "reach" | "drop" | "question";
export type SortKey = "name" | "views" | "comp" | "leads" | "delta";

export interface Filters {
  range: number; // days ending today (1, 7 or 30); 0 = custom from/to
  from?: string; // custom range start, "YYYY-MM-DD" (Sydney day)
  to?: string; // custom range end, inclusive
  site: string; // "" = all
  device: string; // "" = all, "mobile", "desktop"
  src: string; // "" = all, NONE = no utm_source
  camp: string;
  ad: string;
}

export interface FormRow {
  id: string;
  site: string; // short code, e.g. "BWA"
  name: string; // page path without the leading slash
  url: string | null; // the live page, when its site's domain is known
  views: number;
  leads: number;
  comp: number; // leads / views
  qs: string[]; // question keys in this form's order, "lead" last
  shown: number[]; // sessions shown each question
  dropped: number[]; // sessions whose last question was this one (no submit)
  reach: number[]; // shown / views
  quit: (number | null)[]; // dropped / shown
  leak: number; // index of the biggest leak, -1 when no question has enough people
  delta: number | null; // completion vs the previous period, in points
}

// A question needs this many people shown it before it can be "the biggest leak".
export const MIN_LEAK_SAMPLE = 10;

/** Live domain per site code, for the "open the page" links. */
export const SITE_HOSTS: Record<string, string> = {
  BWA: "go.budgetwiseaustralia.com",
  ASH: "go.australianseniorhealth.com",
  AHC: "news.australiahealthcare.org",
};

export const SITE_NAMES: Record<string, string> = {
  BWA: "BudgetWise",
  ASH: "Aus Senior Health",
  ASC: "Aus Senior Cover",
  AHC: "AustraliaHealthcare",
  PC: "PlainCover",
};

/** Site code from a _c_dt: goBWA_cl_compareb -> "BWA", newsAHC_cl_compare -> "AHC". */
export function siteOf(formId: string): string {
  const head = formId.split("_")[0];
  return head.replace(/^(go|news)(?=[A-Z])/, "").toUpperCase();
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function trafficValue(v: string | null): string {
  return v == null || v === "" ? NONE : v;
}

/** Groups in [from, to] matching site and device (not traffic). */
function inWindow(p: FormsPayload, f: Filters, from: string, to: string): FormsGroup[] {
  return p.groups.filter(
    (g) =>
      g.d >= from &&
      g.d <= to &&
      (!f.site || siteOf(g.f) === f.site) &&
      (!f.device || g.dev === f.device),
  );
}

function matchesTraffic(g: FormsGroup, f: Filters): boolean {
  return (
    (!f.src || trafficValue(g.src) === f.src) &&
    (!f.camp || trafficValue(g.camp) === f.camp) &&
    (!f.ad || trafficValue(g.ad) === f.ad)
  );
}

/**
 * Question order per form, from every bucket in the payload (all dates, all
 * traffic), so a form's columns don't reshuffle when a filter leaves a question
 * with nobody on it. Ordered by average position; the contact form is last.
 */
export function questionOrder(p: FormsPayload): Map<string, string[]> {
  const acc = new Map<string, Map<string, { w: number; n: number }>>();
  for (const g of p.groups) {
    let m = acc.get(g.f);
    if (!m) acc.set(g.f, (m = new Map()));
    for (const [step, [shown, , sort]] of Object.entries(g.s)) {
      const a = m.get(step) ?? { w: 0, n: 0 };
      a.w += sort * shown;
      a.n += shown;
      m.set(step, a);
    }
  }
  const out = new Map<string, string[]>();
  for (const [form, m] of acc) {
    const qs = [...m.entries()]
      .filter(([step]) => step !== "lead")
      .sort((a, b) => a[1].w / Math.max(1, a[1].n) - b[1].w / Math.max(1, b[1].n))
      .map(([step]) => step);
    qs.push("lead");
    out.set(form, qs);
  }
  return out;
}

interface Totals {
  views: number;
  leads: number;
  steps: Map<string, { shown: number; dropped: number }>;
}

function totalsByForm(groups: FormsGroup[]): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const g of groups) {
    let t = out.get(g.f);
    if (!t) out.set(g.f, (t = { views: 0, leads: 0, steps: new Map() }));
    t.views += g.v;
    t.leads += g.l;
    for (const [step, [shown, dropped]] of Object.entries(g.s)) {
      const s = t.steps.get(step) ?? { shown: 0, dropped: 0 };
      s.shown += shown;
      s.dropped += dropped;
      t.steps.set(step, s);
    }
  }
  return out;
}

export interface FormsView {
  rows: FormRow[];
  hidden: number; // forms with traffic in the period but none matching the traffic filters
  options: { src: string[]; camp: string[]; ad: string[] };
  filters: Filters; // with traffic selections that no longer exist cleared
}

/** Days between two "YYYY-MM-DD" dates, inclusive of both. */
function spanDays(from: string, to: string): number {
  const ms = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((ms(to) - ms(from)) / 864e5) + 1;
}

/**
 * The selected period and the one just before it, the same length. A custom
 * range with its ends swapped is read the right way round.
 */
export function periodOf(p: FormsPayload, f: Filters): { from: string; to: string; prevFrom: string; prevTo: string; days: number } {
  let from: string, to: string;
  if (f.range === 0 && f.from && f.to) {
    [from, to] = f.from <= f.to ? [f.from, f.to] : [f.to, f.from];
  } else {
    to = p.today;
    from = addDays(p.today, -(Math.max(1, f.range) - 1));
  }
  const days = spanDays(from, to);
  return { from, to, prevFrom: addDays(from, -days), prevTo: addDays(from, -1), days };
}

/** Everything the Forms tab shows for the given filters. */
export function buildFormsView(p: FormsPayload, filters: Filters): FormsView {
  const f = { ...filters };
  const { from, to, prevFrom, prevTo } = periodOf(p, f);

  // Traffic suggestions, each limited to what's under the choice before it.
  // A typed or pasted value is kept even when nothing matches it (the page then
  // says so), so a Facebook ad or campaign ID can be checked as-is.
  const base = inWindow(p, f, from, to);
  const uniq = (a: string[]) => [...new Set(a)].sort((x, y) => x.localeCompare(y));
  const src = uniq(base.map((g) => trafficValue(g.src)));
  const bySrc = base.filter((g) => !f.src || trafficValue(g.src) === f.src);
  const camp = uniq(bySrc.map((g) => trafficValue(g.camp)));
  const byCamp = bySrc.filter((g) => !f.camp || trafficValue(g.camp) === f.camp);
  const ad = uniq(byCamp.map((g) => trafficValue(g.ad)));

  const cur = totalsByForm(base.filter((g) => matchesTraffic(g, f)));
  const prev = totalsByForm(inWindow(p, f, prevFrom, prevTo).filter((g) => matchesTraffic(g, f)));
  const order = questionOrder(p);
  const paths = new Map(p.forms.map((x) => [x.id, x.path]));
  const before = new Set(base.filter((g) => g.v > 0).map((g) => g.f));

  const rows: FormRow[] = [];
  for (const [id, t] of cur) {
    if (t.views <= 0) continue;
    const qs = order.get(id) ?? ["lead"];
    const shown = qs.map((q) => t.steps.get(q)?.shown ?? 0);
    const dropped = qs.map((q) => t.steps.get(q)?.dropped ?? 0);
    const quit = qs.map((_, i) => (shown[i] > 0 ? dropped[i] / shown[i] : null));
    let leak = -1;
    let worst = 0;
    quit.forEach((q, i) => {
      if (q != null && shown[i] >= MIN_LEAK_SAMPLE && q > worst) {
        worst = q;
        leak = i;
      }
    });
    const comp = t.leads / t.views;
    const pt = prev.get(id);
    const path = paths.get(id);
    const host = SITE_HOSTS[siteOf(id)];
    rows.push({
      id,
      site: siteOf(id),
      name: path ? path.replace(/^\//, "") : id,
      url: path && host ? `https://${host}${path}` : null,
      views: t.views,
      leads: t.leads,
      comp,
      qs,
      shown,
      dropped,
      reach: shown.map((s) => s / t.views),
      quit,
      leak,
      delta: pt && pt.views > 0 ? (comp - pt.leads / pt.views) * 100 : null,
    });
  }

  return {
    rows,
    hidden: [...before].filter((id) => !rows.some((r) => r.id === id)).length,
    options: { src, camp, ad },
    filters: f,
  };
}

export function sortRows(rows: FormRow[], key: SortKey): FormRow[] {
  const val = (r: FormRow): number =>
    key === "views" ? r.views
    : key === "leads" ? r.leads
    : key === "delta" ? r.delta ?? -Infinity
    : r.comp;
  return rows
    .slice()
    .sort((a, b) => (key === "name" ? a.name.localeCompare(b.name) : val(b) - val(a) || a.name.localeCompare(b.name)));
}

/** True when every row asks the same questions in the same order. */
export function sameQuestions(rows: FormRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.qs.join() === rows[0].qs.join());
}

export interface Breakdown {
  label: string;
  views: number;
  leads: number;
  comp: number; // leads / views
}

/**
 * Extra detail for one form in the selected period: its traffic split by
 * device (ignoring the device filter) and its top traffic sources (ignoring the
 * traffic filters), each with completion. Other filters still apply.
 */
export function formDetail(p: FormsPayload, f: Filters, formId: string): { devices: Breakdown[]; sources: Breakdown[] } {
  const { from, to } = periodOf(p, f);
  const mine = p.groups.filter((g) => g.f === formId && g.d >= from && g.d <= to && (!f.site || siteOf(g.f) === f.site));
  const sum = (groups: FormsGroup[], key: (g: FormsGroup) => string): Breakdown[] => {
    const m = new Map<string, Breakdown>();
    for (const g of groups) {
      const k = key(g);
      const b = m.get(k) ?? { label: k, views: 0, leads: 0, comp: 0 };
      b.views += g.v;
      b.leads += g.l;
      m.set(k, b);
    }
    return [...m.values()]
      .map((b) => ({ ...b, comp: b.views ? b.leads / b.views : 0 }))
      .sort((a, b) => b.views - a.views);
  };
  const devLabel = (d: string | null) => (d === "mobile" ? "Mobile" : d === "desktop" ? "Desktop" : "Unknown");
  return {
    devices: sum(mine.filter((g) => matchesTraffic(g, f)), (g) => devLabel(g.dev)),
    sources: sum(mine.filter((g) => !f.device || g.dev === f.device), (g) => trafficValue(g.src)).slice(0, 4),
  };
}

