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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
