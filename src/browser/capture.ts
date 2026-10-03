import type { SessionData } from "../session/snapshot.js";
import type { CaptureState, CapturedHeaders } from "./types.js";

// The scripts that run INSIDE the page. They are plain strings because that is
// what the fake browser in the tests matches on (by the leading marker), and
// because addInitScript/evaluate both accept a source string.
//
// Two init scripts run before the app boots:
//   1. restore the sessionStorage/localStorage snapshot, so the SPA wakes up
//      authenticated even in a fresh headless context;
//   2. install a fetch/XHR hook that records the live session headers the app
//      sends on the investments channel, plus the account id it embeds in URLs.
// Then the transport replays investments GETs with those headers (plain JSON)
// and renders banking screens for DOM scraping.

export const RESTORE_MARKER = "/*btg restore*/";
export const CAPTURE_MARKER = "/*btg capture*/";
export const READ_CAPTURE_MARKER = "/*btg read-capture*/";
export const API_FETCH_MARKER = "/*btg api-fetch*/";
export const EXTRACT_MARKER = "/*btg extract*/";
export const READY_MARKER = "/*btg ready*/";

/** Global the hook writes to and the transport reads back. */
export const CAPTURE_GLOBAL = "__btgCapture";

/** The session header names the investments channel carries. */
export const SESSION_HEADER_NAMES = [
  "authorization_code",
  "sessionid",
  "fingerprint",
  "syncid",
] as const;

/**
 * Builds the init script that repopulates web storage before the app's own
 * JavaScript runs. Scoped to the app origin so it never touches a cross-origin
 * iframe. Runs on every navigation; writing the same values twice is harmless.
 */
export function restoreScript(data: Pick<SessionData, "origin" | "storage" | "local">): string {
  const payload = JSON.stringify({
    origin: data.origin,
    storage: data.storage,
    local: data.local ?? {},
  });
  return `${RESTORE_MARKER}
(() => {
  const data = ${payload};
  try {
    if (location.origin !== data.origin) return;
    for (const k in data.storage) sessionStorage.setItem(k, data.storage[k]);
    for (const k in data.local) localStorage.setItem(k, data.local[k]);
  } catch (e) {}
})();`;
}

/**
 * The fetch/XHR hook. Records the latest investments session headers and the
 * account id from the URL, without changing any request. `syncid` is read under
 * both spellings the app has used.
 */
export const CAPTURE_SCRIPT = `${CAPTURE_MARKER}
(() => {
  const cap = (window.${CAPTURE_GLOBAL} = window.${CAPTURE_GLOBAL} || { headers: {}, account: null, seen: 0 });
  const WANT = ${JSON.stringify(SESSION_HEADER_NAMES)};
  const ACCOUNT_RE = /\\/(?:allocation|destaques|advisor|recommended-portfolio\\/account|indicative\\/quote)\\/(\\d{3,})(?:\\/|$)/;
  // The app calls RELATIVE urls ("investments/api/..."), so resolve against the
  // page before matching; a raw-string check misses every one of them.
  const abs = (u) => { try { return new URL(String(u), location.href).href; } catch (e) { return String(u || ""); } };
  const note = (rawUrl, get) => {
    const url = abs(rawUrl);
    if (url.indexOf("/investments/api/") === -1) return;
    cap.seen++;
    for (const name of WANT) {
      const v = get(name) || get(name === "syncid" ? "syncId" : name);
      if (v) cap.headers[name] = v;
    }
    const m = String(url).match(ACCOUNT_RE);
    if (m) cap.account = m[1];
  };
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
      const h = new Headers((init && init.headers) || (input && input.headers) || {});
      note(url, (n) => h.get(n));
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };
  const open = XMLHttpRequest.prototype.open;
  const setH = XMLHttpRequest.prototype.setRequestHeader;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) {
    this.__btgUrl = url;
    this.__btgHeaders = {};
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (this.__btgHeaders) this.__btgHeaders[String(k).toLowerCase()] = v; } catch (e) {}
    return setH.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    try { note(this.__btgUrl, (n) => this.__btgHeaders[String(n).toLowerCase()]); } catch (e) {}
    return send.apply(this, arguments);
  };
})();`;

/** Reads the capture state back out of the page. */
export const READ_CAPTURE_SCRIPT = `${READ_CAPTURE_MARKER}
(() => window.${CAPTURE_GLOBAL} || { headers: {}, account: null, seen: 0 })();`;

/**
 * Replays an investments GET from inside the authenticated page, with the
 * captured session headers and a fresh correlation id. A raw fetch does not go
 * through the app's HttpClient interceptor, so we attach the headers ourselves.
 */
export function apiFetchScript(url: string, headers: CapturedHeaders): string {
  const payload = JSON.stringify({ url, headers });
  return `${API_FETCH_MARKER}
(async () => {
  const req = ${payload};
  const h = { accept: "application/json", "x-correlation-id": (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) };
  for (const k in req.headers) if (req.headers[k]) h[k] = req.headers[k];
  const r = await fetch(req.url, { method: "GET", headers: h, credentials: "include" });
  const body = await r.text();
  return { status: r.status, url: r.url, body };
})();`;
}

/**
 * Snapshot of the rendered document with everything executable or decorative
 * removed. The DOM parsers get inert HTML, which is also what gets stored as a
 * fixture and as `raw_html` for offline reparsing.
 */
export const EXTRACT_SCRIPT = `${EXTRACT_MARKER}
(() => {
  const clone = document.documentElement.cloneNode(true);
  for (const node of clone.querySelectorAll("script,style,svg,noscript,link,iframe,meta")) node.remove();
  return { url: location.href, title: document.title, html: clone.outerHTML };
})();`;

/** Readiness probe for a banking screen: the data selector is present. */
export function readyScript(selector: string): string {
  const request = JSON.stringify({ selector });
  return `${READY_MARKER}
(() => {
  const req = ${request};
  return { ready: document.querySelector(req.selector) !== null };
})();`;
}

/** Merges a freshly read capture into the stored headers (keeps known values). */
export function mergeHeaders(into: CapturedHeaders, from: CaptureState): CapturedHeaders {
  const merged: CapturedHeaders = { ...into };
  for (const name of SESSION_HEADER_NAMES) {
    const value = from.headers[name];
    if (value) merged[name] = value;
  }
  return merged;
}

/** Do we have the minimum headers to replay an investments GET? */
export function hasRequiredHeaders(headers: CapturedHeaders): boolean {
  return Boolean(headers.authorization_code && headers.sessionid);
}

export const DUMP_MARKER = "/*btg dump*/";

/** Dumps web storage for the app origin, to snapshot the session or mirror a refresh. */
export const DUMP_STORAGE_SCRIPT = `${DUMP_MARKER}
(() => {
  const dump = (s) => { const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k) o[k] = s.getItem(k); } return o; };
  return { storage: dump(sessionStorage), local: dump(localStorage) };
})();`;
