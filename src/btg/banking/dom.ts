import { type HTMLElement, parse } from "node-html-parser";

// Small DOM helpers shared by the banking parsers. Parsing happens in Node on
// the inert HTML the bridge extracted, never inside the browser.

export { type HTMLElement };

export const parseHtml = (html: string): HTMLElement => parse(html);

/** Collapsed, trimmed text of an element (or null when empty/missing). */
export function text(el: HTMLElement | null | undefined): string | null {
  const value = el?.text.replace(/\s+/g, " ").trim();
  return value ? value : null;
}

export const hasClass = (el: HTMLElement, cls: string): boolean =>
  (el.getAttribute("class") ?? "").split(/\s+/).includes(cls);

/** Depth-first walk in document order, calling `visit` for every element. */
export function walk(root: HTMLElement, visit: (el: HTMLElement) => "skip" | void): void {
  for (const child of root.childNodes) {
    const el = child as HTMLElement;
    if (!el.tagName) continue;
    if (visit(el) === "skip") continue;
    walk(el, visit);
  }
}

/** Direct element children. */
export const children = (el: HTMLElement): HTMLElement[] =>
  el.childNodes.filter((node) => (node as HTMLElement).tagName) as HTMLElement[];
