// Forms tab data: fetch the Apps Script ?view=forms payload (Supabase form
// analytics, see apps-script/Code.gs readForms_). The maths is in formscompute.ts.

import { fetchJson, withCacheBust } from "./data.ts";
import { validateForms } from "./formscompute.ts";
import type { FormsPayload } from "./formscompute.ts";
import type { DataSource } from "./types.ts";

const DATA_URL = (import.meta.env.VITE_DATA_URL as string | undefined) ?? "";
const FIXTURE_URL = `${import.meta.env.BASE_URL}forms-sample.json`;
const CACHE_KEY = "leads-monitor:forms-last-live";

export async function fetchForms(): Promise<{ data: FormsPayload; source: DataSource }> {
  if (DATA_URL) {
    try {
      const url = `${DATA_URL}${DATA_URL.includes("?") ? "&" : "?"}view=forms`;
      const data = validateForms(await fetchJson(withCacheBust(url)));
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
