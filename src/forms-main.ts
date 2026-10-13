// Form Performance page (form-performance/index.html): every tracked lead
// form's funnel side by side. Its own URL so the Leads Monitor never loads form
// data and this page never waits on the Leads Monitor's Apps Script.

import "./ui.css";
import { formsStatus, isFormsLoading, mountForms, refreshForms } from "./formsview.ts";
import { headerActions, menuHtml, pillHtml } from "./shell.ts";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

const app = document.getElementById("app") as HTMLElement;

/** Pill and refresh button follow the form data's sync state. */
function syncHeader(): void {
  const f = formsStatus();
  const pill = document.getElementById("pill");
  if (pill) pill.innerHTML = pillHtml(f.status, f.syncedAt);
  const btn = document.getElementById("refresh") as HTMLButtonElement | null;
  if (btn) {
    btn.classList.toggle("is-spinning", isFormsLoading());
    btn.disabled = isFormsLoading();
  }
}

function init(): void {
  const f = formsStatus();
  app.innerHTML = `
    <header class="header">
      <div>
        <h1 class="header__title">Form Performance</h1>
        <p class="header__subtitle">Form funnels · page views to leads</p>
      </div>
      ${menuHtml("forms", "../")}
      ${headerActions(f.status, f.syncedAt)}
    </header>
    <div id="forms-root"></div>
  `;
  document.getElementById("refresh")?.addEventListener("click", () => void refreshForms());
  mountForms(document.getElementById("forms-root") as HTMLElement, syncHeader);
  syncHeader();

  setInterval(() => void refreshForms(), POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshForms();
  });
}

init();
