// Pace flag banner (§4.3, §5.2). Vertical-agnostic: takes the cumulative
// series + benchmark band, so both the HD and ED views can render it.

import { computePace } from "./compute.ts";

const ICON: Record<string, string> = {
  ahead: "▲",
  behind: "▼",
  onpace: "•",
  none: "•",
};

const TONE_CLASS: Record<string, string> = {
  ahead: "flag--green",
  behind: "flag--red",
  onpace: "flag--blue",
  none: "flag--blue",
};

export function renderFlag(
  cumulative: number[],
  high: number[],
  low: number[],
): string {
  const pace = computePace(cumulative, high, low);

  return `
    <section class="flag ${TONE_CLASS[pace.tone]}" role="status">
      <span class="flag__icon" aria-hidden="true">${ICON[pace.tone]}</span>
      <div class="flag__body">
        <div class="flag__headline">${esc(pace.headline)}</div>
        <div class="flag__subtext">${esc(pace.subtext)}</div>
      </div>
    </section>
  `;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
