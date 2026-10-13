// Shared page chrome for the two pages (Leads Monitor and Form Performance):
// status pill, header actions and the main menu.

import { clockHHMM } from "./compute.ts";
import type { SyncStatus } from "./types.ts";

export function pillHtml(status: SyncStatus, syncedAt: string): string {
  const t = clockHHMM(syncedAt);
  let cls = "pill--live";
  let text = `Live · synced ${t}`;
  if (status === "syncing") {
    cls = "pill--syncing";
    text = "Syncing…";
  } else if (status === "cached") {
    // Last good live data replayed from this device (sync is currently failing).
    cls = "pill--snapshot";
    text = `Offline · last synced${t ? ` ${t}` : ""}`;
  } else if (status === "snapshot") {
    // Bundled sample — only shown when there's no live data or cache at all.
    cls = "pill--snapshot";
    text = "Sample data";
  }
  return `<span class="pill ${cls}"><span class="pill__dot"></span>${text}</span>`;
}

/** Top-right header cluster: status pill + manual "force sync" button. */
export function headerActions(status: SyncStatus, syncedAt: string): string {
  return `
    <div class="header__actions">
      <div id="pill">${pillHtml(status, syncedAt)}</div>
      <button id="refresh" class="refresh-btn" type="button"
              aria-label="Refresh now" title="Refresh now">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </button>
    </div>`;
}

const PROMPT_BUILDER_URL = "https://prompt-builder-d1j.pages.dev/";

const ICONS = {
  leads: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V10M10 19V5M16 19v-7M22 19H2"/></svg>`,
  forms: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18l-7 8v6l-4 2v-8z"/></svg>`,
  prompts: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
};

/**
 * Main menu: a segmented switch at the top on desktop, a bar fixed to the
 * bottom on phones. Leads and Forms are separate pages (separate URLs, so each
 * only loads its own data); `root` is the relative path to the site root from
 * the current page ("./" on Leads, "../" on Form Performance).
 */
export function menuHtml(active: "leads" | "forms", root: string): string {
  const item = (v: "leads" | "forms", href: string, text: string): string =>
    `<a class="toggle__seg tabs__item${active === v ? " is-active" : ""}" href="${href}"${active === v ? ' aria-current="page"' : ""}>${ICONS[v]}<span>${text}</span></a>`;
  return `<nav class="toggle tabs" aria-label="Dashboard pages">${item("leads", root, "Leads")}${item("forms", `${root}form-performance/`, "Forms")}<a class="toggle__seg tabs__item tabs__link" href="${PROMPT_BUILDER_URL}" target="_blank" rel="noopener">${ICONS.prompts}<span>Prompts</span></a></nav>`;
}
