// Forms tab data: fetch the form analytics totals from the Cloudflare function
// /api/form-stats in Exoleadmedia/web-budgetwise-australia (reads Supabase; the
// key stays in Cloudflare). The maths is in formscompute.ts.

import { fetchJson, withCacheBust } from "./data.ts";
import { validateForms } from "./formscompute.ts";
import type { FormsPayload } from "./formscompute.ts";
import type { DataSource } from "./types.ts";

// Live builds (VITE_DATA_URL set) read the real endpoint; local runs without
// it use the made-up fixture, like the Leads view. VITE_FORMS_URL overrides.
const LIVE = Boolean(import.meta.env.VITE_DATA_URL);
const FORMS_URL =
  (import.meta.env.VITE_FORMS_URL as string | undefined) ??
  (LIVE ? "https://go.budgetwiseaustralia.com/api/form-stats" : "");
// The fixture sits at the site root; this page is one folder down (/form-performance/).
const FIXTURE_URL = "../forms-sample.json";
const CACHE_KEY = "leads-monitor:forms-last-live";

export async function fetchForms(): Promise<{ data: FormsPayload; source: DataSource }> {
  if (FORMS_URL) {
    try {
      const data = validateForms(await fetchJson(withCacheBust(FORMS_URL)));
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      } catch {
        /* storage unavailable - non-fatal */
      }
      return { data, source: "live" };
    } catch (err) {
      console.warn("[leads-monitor] forms fetch failed:", err);
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) return { data: validateForms(JSON.parse(raw)), source: "cache" };
      } catch {
        /* no usable cache */
      }
      throw err;
    }
  }
  return { data: validateForms(await fetchJson(withCacheBust(FIXTURE_URL))), source: "fixture" };
}
