/**
 * Leads Monitor - Apps Script data endpoint (3.2).
 *
 * Reads ONLY aggregate tabs (the HD and ED daily summaries + each sheet's
 * Cumul. Leads tab) and returns the JSON contract the dashboard expects. It
 * never touches the lead-level/PII tabs (e.g. each sheet's first tab).
 *
 * Monthly tabs are resolved automatically: each month's tab is named like
 * "June 2026" / "July 2026", and the script uses the current month's tab,
 * falling back to the most recent month that actually has data (so nothing
 * breaks on the 1st of a month before that tab is populated). No hand-editing.
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New deployment
 *   - Type: Web app
 *   - Execute as: Me            (so it can read both sheets you own)
 *   - Who has access: Anyone
 * Copy the resulting /exec URL into the dashboard's .env as VITE_DATA_URL.
 * (Updating an EXISTING deployment keeps the same URL; a NEW deployment mints
 *  a new one - update .env if it changes.)
 */

// ==== CONFIG ====
const HD_SPREADSHEET_ID = '1CH7e50P8ZWeK1uL6GQyWdhFobPUDROmThzE2vmXSxxo';
const ED_SPREADSHEET_ID = '1XG7lUIMbX7jgGAfTS4HTrTwUE8uZacCgJv0hlo2SNAI';
const CUMUL_TAB = 'Cumul. Leads';   // the HD cumulative dashboard tab
// The ED sheet's cumulative tab was cloned from the HD one; accept the common
// name variants so a rename doesn't silently kill the ED chart.
const ED_CUMUL_TABS = ['Cumul. Leads', 'Cumulative Leads', 'Cumul Leads'];

function doGet() {
  const ss = SpreadsheetApp.openById(HD_SPREADSHEET_ID);
  const tz = ss.getSpreadsheetTimeZone();
  const daily = readDaily_(ss, tz);
  const out = {
    syncedAt: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    today: {
      // Actual today in the sheet's timezone - the Cumul. Leads "Today" row
      // tracks TODAY(), so the chart/tile date must roll over at midnight even
      // though the monthly tab has no row for the new day yet.
      date: Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy'),
      label: 'Today',
      cumulative: readCumulRow_(ss, 'Today')
    },
    benchmark: {
      high: readCumulRow_(ss, 'Benchmark High'),
      low: readCumulRow_(ss, 'Benchmark Low')
    },
    daily: daily,
    ed: readEd_()
  };
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==== HD monthly daily-summary ====

/**
 * Reads the HD daily-summary rows from the current month's tab, walking back up
 * to a year to the most recent monthly tab that exists AND has data rows.
 */
function readDaily_(ss, tz) {
  const d = new Date();
  for (let i = 0; i < 13; i++) {
    const name = Utilities.formatDate(d, tz, 'MMMM yyyy'); // e.g. "June 2026"
    const sh = ss.getSheetByName(name);
    if (sh) {
      const rows = readDailyFromSheet_(sh, ss);
      if (rows.length) return rows;
    }
    d.setMonth(d.getMonth() - 1);
  }
  return [];
}

function readDailyFromSheet_(sh, ss) {
  const values = sh.getDataRange().getValues();
  let h = -1;
  const col = {};
  for (let r = 0; r < values.length; r++) {
    const row = values[r].map(function (x) { return String(x).trim(); });
    if (row.indexOf('Paid Leads') !== -1 && row.indexOf('Date') !== -1) {
      h = r;
      row.forEach(function (name, i) { col[name] = i; });
      break;
    }
  }
  if (h === -1) return [];
  const out = [];
  for (let r = h + 1; r < values.length; r++) {
    const date = formatDate_(values[r][col['Date']], ss);
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) continue; // skip non-date / junk rows
    const paid = toNumOrNull_(values[r][col['Paid Leads']]);
    if (paid === null) {
      // Monthly tabs pre-list every date of the month; a blank Paid Leads is a
      // future day with no data yet. Data fills top-down, so stop at the first
      // empty day (otherwise "today" would jump to the 31st and the day count
      // and averages would be wrong).
      if (out.length) break;
      continue;
    }
    out.push({
      date: date,
      paidLeads: paid,
      revenue: toNumOrNull_(values[r][col['Revenue']]),
      cpl: toNumOrNull_(values[r][col['CPL']]),
      adjProfit: toNumOrNull_(values[r][col['Adj. Profit']]),
      roas: toNumOrNull_(values[r][col['ROAS']])
    });
  }
  return out;
}

// ==== HD cumulative (per-hour running totals) ====

/**
 * Returns the 24 CUMULATIVE hourly values for a labelled row
 * (Today / Benchmark High / Benchmark Low), zero-filled when missing so the
 * HD contract always carries 24 numbers.
 */
function readCumulRow_(ss, label) {
  return readCumulRowFromSheet_(ss.getSheetByName(CUMUL_TAB), label)
    || new Array(24).fill(0);
}

/**
 * Core reader shared by HD and ED. Returns the padded 24 values for a labelled
 * row, or null when the sheet/label doesn't exist (lets ED degrade gracefully).
 *
 * A Cumul. Leads tab has TWO blocks carrying these same labels: a per-hour
 * block first, then a "Cumulative" block. We anchor on the "Cumulative" header
 * and read the labelled row beneath it. Hours run 0..23 left-to-right.
 */
function readCumulRowFromSheet_(sh, label) {
  if (!sh) return null;
  const values = sh.getDataRange().getValues();

  let start = 0;
  for (let r = 0; r < values.length; r++) {
    if (values[r].some(function (v) {
      return String(v).trim().toLowerCase() === 'cumulative';
    })) {
      start = r;
      break;
    }
  }

  for (let r = start; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).trim().toLowerCase() === label.toLowerCase()) {
        const nums = values[r].slice(c + 1).map(toNumOrNull_).filter(function (v) {
          return v !== null;
        });
        return padTo24_(nums);
      }
    }
  }
  return null;
}

// ==== ED daily-summary + cumulative (per-hour running totals) ====

/**
 * ED leads summary from the ED sheet's current month tab (fallback to the most
 * recent month with data), plus - when the ED Cumul. Leads tab exists - the
 * same Today/Benchmark cumulative rows the HD chart uses. Returns null if the
 * ED sheet is unreachable or has no readable daily table, so the dashboard
 * degrades gracefully. Reads ONLY aggregate tabs - never the lead-level PII tab.
 */
function readEd_() {
  try {
    const ss = SpreadsheetApp.openById(ED_SPREADSHEET_ID);
    const tz = ss.getSpreadsheetTimeZone();
    const d = new Date();
    for (let i = 0; i < 13; i++) {
      const name = Utilities.formatDate(d, tz, 'MMMM yyyy');
      const sh = ss.getSheetByName(name);
      if (sh) {
        const res = readEdMonth_(sh, ss, name, tz);
        if (res) {
          addEdCumul_(res, ss, tz);
          return res;
        }
      }
      d.setMonth(d.getMonth() - 1);
    }
  } catch (err) {
    // ED sheet unreachable / not authorized - degrade to no ED tile data.
  }
  return null;
}

/**
 * Attaches `cumulative` (Today, 24 running totals) and `benchmark` {high, low}
 * from the ED sheet's cumulative tab. When present, `todayLeads` becomes the
 * live intraday total (the monthly tab can lag behind the pivot) and `date`
 * becomes the actual today, mirroring what the HD tile shows.
 */
function addEdCumul_(res, ss, tz) {
  let sh = null;
  for (let i = 0; i < ED_CUMUL_TABS.length && !sh; i++) {
    sh = ss.getSheetByName(ED_CUMUL_TABS[i]);
  }
  res.cumulative = readCumulRowFromSheet_(sh, 'Today');
  const high = readCumulRowFromSheet_(sh, 'Benchmark High');
  const low = readCumulRowFromSheet_(sh, 'Benchmark Low');
  // An all-zero band means the benchmark rows aren't populated yet - report it
  // as absent so the dashboard doesn't draw a flat band / bogus pace.
  const hasBand = high && low && high.some(function (v) { return v > 0; });
  res.benchmark = hasBand ? { high: high, low: low } : null;
  if (res.cumulative) {
    res.todayLeads = res.cumulative[23];
    res.date = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');
  }
}

function readEdMonth_(sh, ss, label, tz) {
  const values = sh.getDataRange().getValues();
  let h = -1;
  const col = {};
  for (let r = 0; r < values.length; r++) {
    const row = values[r].map(function (x) { return String(x).trim(); });
    if (row.indexOf('Date') !== -1 && row.indexOf('Social Leads') !== -1) {
      h = r;
      row.forEach(function (name, i) { col[name] = i; });
      break;
    }
  }
  if (h === -1) return null;

  const rows = [];
  for (let r = h + 1; r < values.length; r++) {
    const date = formatDate_(values[r][col['Date']], ss);
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
      if (rows.length) break; // reached the Total/blank row after the daily rows
      continue;               // still in a gap before the first data row
    }
    const socialRaw = toNumOrNull_(values[r][col['Social Leads']]);
    if (socialRaw === null) {
      // Pre-listed future day with no leads yet - stop (tabs fill top-down).
      if (rows.length) break;
      continue;
    }
    const social = socialRaw;
    const email = ('Email Leads' in col)
      ? (toNumOrNull_(values[r][col['Email Leads']]) || 0)
      : 0;
    rows.push({
      date: date,
      leads: social + email,
      revenue: ('Revenue' in col) ? toNumOrNull_(values[r][col['Revenue']]) : null,
      cpl: ('CPL' in col) ? toNumOrNull_(values[r][col['CPL']]) : null,
      adjProfit: ('Adj. Profit' in col) ? toNumOrNull_(values[r][col['Adj. Profit']]) : null,
      roas: ('ROAS' in col) ? toNumOrNull_(values[r][col['ROAS']]) : null
    });
  }
  if (!rows.length) return null;

  const today = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');
  let todayRow = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].date === today) todayRow = rows[i];
  }
  if (!todayRow) todayRow = rows[rows.length - 1]; // latest available day

  let mtd = 0;
  for (let i = 0; i < rows.length; i++) mtd += rows[i].leads;

  return {
    date: todayRow.date,
    label: label,
    todayLeads: todayRow.leads,
    monthToDate: mtd,
    avgPerDay: rows.length ? mtd / rows.length : null,
    daily: rows
  };
}

// ==== shared helpers ====

function toNumOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[$,%\s]/g, '');
  if (/DIV\/0/i.test(s) || s === '-' || s === '') return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function padTo24_(a) {
  const r = a.slice(0, 24);
  while (r.length < 24) r.push(r.length ? r[r.length - 1] : 0);
  return r;
}

function formatDate_(v, ss) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy');
  }
  return String(v).trim();
}
