// In-page scripts for the two interactions the sync needs: picking an invoice
// month on the chart and paging the statement. Navigation only: nothing here
// clicks anything that changes the account. They run through
// Bridge.interact(): `locate` returns where to click (real mouse), `done`
// confirms the screen changed, `annotate` marks what the HTML parser cannot
// see on its own (the chart's SVG is stripped before parsing).

const json = (value: unknown) => JSON.stringify(value);

/** Text of the month part of a chart label ("Setembro", "Jan/2027"). */
const LABEL_TEXT = `(s) => ((s.querySelector("span") || s).textContent || "").replace(/\\s+/g, " ").trim()`;

/**
 * The selected invoice is the darker column (fill ...-60); its label is the
 * nearest one horizontally. Only trustworthy after an explicit click: on load
 * the chart highlights the OPEN invoice while the list shows the closed one.
 */
const SELECTED_LABEL = `(() => {
  const label = ${LABEL_TEXT};
  const dark = [...document.querySelectorAll(".highcharts-point")].filter((p) => /-60\\)?$/.test(p.getAttribute("fill") || ""));
  const labels = [...document.querySelectorAll(".highcharts-xaxis-labels > span")];
  if (dark.length !== 1 || !labels.length) return null;
  const r = dark[0].getBoundingClientRect();
  const cx = r.left + r.width / 2;
  let best = null, dist = Infinity;
  for (const l of labels) {
    const b = l.getBoundingClientRect();
    const d = Math.abs(b.left + b.width / 2 - cx);
    if (d < dist) { dist = d; best = l; }
  }
  return best && dist < 60 ? { el: best, text: label(best) } : null;
})()`;

/** Timeline loading placeholder (the card keeps an unrelated shimmer forever). */
const TIMELINE_LOADING = "app-timeline-card .timeline-shimmer-list, app-timeline-card .timeline-container .empty-state--loading";
const TIMELINE_SIGNATURE = `[...document.querySelectorAll("app-timeline-card .timeline-item__content")].map((e) => e.textContent).join("|")`;

export function monthLocateScript(label: string): string {
  return `/*btg month locate*/
(() => {
  const want = ${json(label)};
  const text = ${LABEL_TEXT};
  const span = [...document.querySelectorAll(".highcharts-xaxis-labels > span")].find((s) => text(s) === want);
  const plot = document.querySelector(".highcharts-plot-background");
  if (!span || !plot) return null;
  span.scrollIntoView({ block: "center" });
  window.__btgBefore = ${TIMELINE_SIGNATURE};
  window.__btgSig = undefined;
  window.__btgStable = 0;
  const b = span.getBoundingClientRect();
  const p = plot.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: p.bottom - 4 };
})()`;
}

/** Selected month is the one asked for, the list finished loading, changed, and held still. */
export function monthDoneScript(label: string): string {
  return `/*btg month done*/
(() => {
  const selected = ${SELECTED_LABEL};
  if (!selected || selected.text !== ${json(label)}) return false;
  if (document.querySelector(${json(TIMELINE_LOADING)})) return false;
  const sig = ${TIMELINE_SIGNATURE};
  if (sig === window.__btgBefore) return false;
  const same = window.__btgSig === sig;
  window.__btgSig = sig;
  window.__btgStable = same ? (window.__btgStable || 0) + 1 : 0;
  return window.__btgStable >= 2;
})()`;
}

/** Marks the selected label so the HTML parser knows which month the list shows. */
export const MONTH_ANNOTATE = `/*btg month annotate*/
(() => {
  for (const l of document.querySelectorAll(".highcharts-xaxis-labels > span")) l.removeAttribute("data-btg-selected");
  const selected = ${SELECTED_LABEL};
  if (selected) selected.el.setAttribute("data-btg-selected", "true");
  return selected ? selected.text : null;
})()`;

const PAGER_INFO = `(document.querySelector("btg-extract .orq-pagination__info")?.textContent || "").replace(/\\s+/g, " ").trim()`;
const ROWS_SIGNATURE = `[...document.querySelectorAll("btg-extract tr.extract__row")].map((r) => r.textContent).join("|")`;

/** The statement pager's "next" button, unless it is disabled (last page). */
export const PAGER_NEXT_LOCATE = `/*btg pager locate*/
(() => {
  const next = [...document.querySelectorAll("btg-extract .orq-pagination__list-item")].find((li) => li.querySelector(".icon-chevron-right"));
  if (!next || next.classList.contains("orq-pagination__list-item--disabled")) return null;
  next.scrollIntoView({ block: "center" });
  window.__btgPager = ${PAGER_INFO};
  window.__btgRows = ${ROWS_SIGNATURE};
  window.__btgSig = undefined;
  window.__btgStable = 0;
  const r = next.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

export const PAGER_NEXT_DONE = `/*btg pager done*/
(() => {
  const info = ${PAGER_INFO};
  if (!info || info === window.__btgPager) return false;
  const rows = ${ROWS_SIGNATURE};
  if (!rows || rows === window.__btgRows) return false;
  const same = window.__btgSig === rows;
  window.__btgSig = rows;
  window.__btgStable = same ? (window.__btgStable || 0) + 1 : 0;
  return window.__btgStable >= 2;
})()`;
