// Acceptance check (§8) — runs the real compute functions against the fixture.
// Not part of the build; run with `node verify.ts`, delete when done.
import { readFileSync } from "node:fs";
import {
  aggregate,
  computePace,
  cutoffHour,
  formatMoneyAbbr,
  formatRoas,
  formatMoney,
  formatCpl,
  formatInt,
  roasMedian,
  roasChipTone,
  typicalLine,
} from "./src/compute.ts";
import type { LeadsData } from "./src/types.ts";
import { buildFormsView, NONE, sameQuestions, siteOf, sortRows } from "./src/formscompute.ts";
import type { Filters, FormsPayload } from "./src/formscompute.ts";

const data: LeadsData = JSON.parse(
  readFileSync(new URL("./public/leads-sample.json", import.meta.url), "utf8"),
);

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? "✅" : "❌"} ${name}: ${actual}${ok ? "" : `  (expected ${expected})`}`);
  ok ? pass++ : fail++;
}

// Shape
check("daily length", data.daily.length, 30);
check("cumulative length", data.today.cumulative.length, 24);
check("high length", data.benchmark.high.length, 24);
check("low length", data.benchmark.low.length, 24);
check("30/06 roas null -> —", formatRoas(data.daily[29].roas), "—");

// Strip
const agg = aggregate(data.daily);
check("paid total", formatInt(agg.paid), "9,130");
check("revenue total", formatMoney(agg.revenue), "$216,517");
check("revenue abbr", formatMoneyAbbr(agg.revenue), "$216.5k");
check("profit total", formatMoney(agg.profit), "$90,674");
check("profit abbr", formatMoneyAbbr(agg.profit), "$90.7k");
check("avg roas", formatRoas(agg.avgRoas), "1.70");
check("footer CPL", formatCpl(agg.cplAvg), "$14.02");

// Pace / chart
const cutoff = cutoffHour(data.today.cumulative);
const typ = typicalLine(data.benchmark.high, data.benchmark.low);
check("cutoff hour", cutoff, 13);
check("typical[13]", typ[13], 147);
check("today[13]", data.today.cumulative[13], 119);
const pace = computePace(data.today.cumulative, data.benchmark.high, data.benchmark.low);
check("pace tone", pace.tone, "behind");
check("pace headline", pace.headline, "Behind pace — 19% below a typical day");
check("pace subtext", pace.subtext, "119 leads by 13:00 · a typical day is ~147 by now.");

// ROAS chips
const med = roasMedian(data.daily);
check("roas median", med, 1.71);
check("29/06 (2.11) chip", roasChipTone(2.11, med), "green");
check("17/06 (1.46) chip", roasChipTone(1.46, med), "red");
check("18/06 (1.71) chip", roasChipTone(1.71, med), "green");
check("01/06 (1.73) chip", roasChipTone(1.73, med), "green");
check("06/06 (1.71) chip", roasChipTone(1.71, med), "green");
check("mid (1.65) chip neutral", roasChipTone(1.65, med), "neutral");

// ED tile
check("ed today leads", formatInt(data.ed!.todayLeads!), "152");
check("ed month-to-date", formatInt(data.ed!.monthToDate!), "6,520");
check("ed date", data.ed!.date, "30/06/2026");
check("ed daily length", data.ed!.daily.length, 30);
check("ed daily leads sum", formatInt(data.ed!.daily.reduce((s, r) => s + (r.leads ?? 0), 0)), "6,520");

// Spend column (tables show spend instead of revenue)
check("spend total", formatMoney(agg.spend), "$125,843");
check("ed spend sum", formatMoney(data.ed!.daily.reduce((s, r) => s + (r.spend ?? 0), 0)), "$36,275");
check("30/06 spend null -> —", formatMoney(data.daily[29].spend), "—");

// ED cumulative chart/pace (mirrors the HD logic on the ED series)
check("ed cumulative length", data.ed!.cumulative!.length, 24);
check("ed cumulative matches todayLeads", data.ed!.cumulative![23], data.ed!.todayLeads);
const edCutoff = cutoffHour(data.ed!.cumulative!);
check("ed cutoff hour", edCutoff, 13);
const edPace = computePace(
  data.ed!.cumulative!,
  data.ed!.benchmark!.high,
  data.ed!.benchmark!.low,
);
check("ed pace tone", edPace.tone, "ahead");
check("ed pace today", edPace.todayAt, 152);
check("ed typical[13]", edPace.typicalAt, 138);

// Forms tab (hand-built payload; every expected value worked out by hand).
// Form A asks the insurer question only to people with insurance; B is a
// different form with different questions. 2026-10-01 falls in the previous
// 7 days, so it only feeds the change column.
const fp: FormsPayload = {
  syncedAt: "2026-10-09T12:00:00+11:00",
  today: "2026-10-09",
  labels: { over60: "Over 60?", hasInsurance: "Has health insurance", insurer: "Current insurer" },
  forms: [{ id: "goBWA_cl_a", path: "/a" }, { id: "goASH_cl_b", path: null }],
  groups: [
    { f: "goBWA_cl_a", d: "2026-10-09", dev: "mobile", src: "fb", camp: "c1", ad: "ad1", v: 10, l: 2,
      s: { over60: [10, 2, 1], hasInsurance: [8, 0, 2], insurer: [5, 1, 3], coverFor: [7, 1, 3.6], lead: [6, 4, 4.6] } },
    { f: "goBWA_cl_a", d: "2026-10-08", dev: "desktop", src: null, camp: null, ad: null, v: 4, l: 1,
      s: { over60: [4, 1, 1], hasInsurance: [3, 0, 2], coverFor: [3, 0, 3], lead: [3, 2, 4] } },
    { f: "goBWA_cl_a", d: "2026-10-01", dev: "mobile", src: "fb", camp: "c1", ad: "ad1", v: 10, l: 5,
      s: { over60: [10, 0, 1], hasInsurance: [10, 0, 2], coverFor: [10, 0, 3], lead: [10, 5, 4] } },
    { f: "goASH_cl_b", d: "2026-10-09", dev: "mobile", src: "fb", camp: "c2", ad: "ad2", v: 20, l: 10,
      s: { age: [20, 5, 1], state: [15, 0, 2], lead: [15, 5, 3] } },
  ],
};
const all: Filters = { range: 7, site: "", device: "", src: "", camp: "", ad: "" };
const fv = buildFormsView(fp, all);
const A = fv.rows.find((r) => r.id === "goBWA_cl_a")!;
const B = fv.rows.find((r) => r.id === "goASH_cl_b")!;
check("forms: site code", siteOf("goBWA_cl_compareb"), "BWA");
check("forms: A name from page path", A.name, "a");
check("forms: B name falls back to id", B.name, "goASH_cl_b");
check("forms: A question order (insurer before coverFor)", A.qs.join(), "over60,hasInsurance,insurer,coverFor,lead");
check("forms: A views/leads (7 days)", `${A.views}/${A.leads}`, "14/3");
check("forms: A shown", A.shown.join(), "14,11,5,10,9");
check("forms: A dropped", A.dropped.join(), "3,0,1,1,6");
check("forms: A started", A.started!.toFixed(4), (11 / 14).toFixed(4));
check("forms: A biggest leak = over60 (insurer/lead under 10 people)", A.leak, 0);
check("forms: A change vs previous 7 days", A.delta!.toFixed(2), "-28.57");
check("forms: B leak = contact form", B.leak, 2);
check("forms: B no previous period", B.delta, null);
check("forms: layouts differ", sameQuestions(fv.rows), false);
check("forms: sort by completion", sortRows(fv.rows, "comp").map((r) => r.id).join(), "goASH_cl_b,goBWA_cl_a");
check("forms: source options", fv.options.src.join(), `${NONE},fb`);
const none = buildFormsView(fp, { ...all, src: NONE });
check("forms: no-UTM traffic only", none.rows.map((r) => `${r.id}:${r.views}`).join(), "goBWA_cl_a:4");
check("forms: hidden by traffic filter", none.hidden, 1);
check("forms: campaign options under fb", buildFormsView(fp, { ...all, src: "fb" }).options.camp.join(), "c1,c2");
check("forms: stale campaign cleared", buildFormsView(fp, { ...all, src: NONE, camp: "c1" }).filters.camp, "");
check("forms: site filter", buildFormsView(fp, { ...all, site: "ASH" }).rows.map((r) => r.id).join(), "goASH_cl_b");
check("forms: desktop only", buildFormsView(fp, { ...all, device: "desktop" }).rows.map((r) => r.views).join(), "4");
const today = buildFormsView(fp, { ...all, range: 1 }).rows.find((r) => r.id === "goBWA_cl_a")!;
check("forms: today vs yesterday", `${today.views}/${today.leads} ${today.delta!.toFixed(1)}`, "10/2 -5.0");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
