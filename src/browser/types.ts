import type { BrowserChannel } from "../config.js";

// The smallest slice of Playwright this project uses. Declaring it here instead
// of importing Playwright's types buys two things: the MCP cold path never
// loads the driver, and the tests fake a browser with a plain object literal.

export type GotoOptions = {
  waitUntil?: "domcontentloaded" | "load" | "networkidle";
  timeout?: number;
};

export type PageLike = {
  goto(url: string, opts?: GotoOptions): Promise<unknown>;
  url(): string;
  /**
   * Takes a script SOURCE STRING, not a function. Playwright accepts both, and
   * a string is what lets the fake browser in the tests recognise which script
   * it was handed by its leading marker comment.
   */
  evaluate(script: string): Promise<unknown>;
};

export type RouteLike = {
  request(): { resourceType(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
};

export type BrowserContextLike = {
  newPage(): Promise<PageLike>;
  /** Runs a script before the app's own JavaScript on every page/navigation. */
  addInitScript(script: string): Promise<void>;
  /** Resource blocking: images, fonts and media are aborted; scripts never are. */
  route?(pattern: string, handler: (route: RouteLike) => unknown): Promise<void>;
  close(): Promise<void>;
};

export type LaunchOptions = {
  channel: BrowserChannel;
  profileDir: string;
  headless: boolean;
  /** The UA captured at login; never let headless Chrome announce itself. */
  userAgent?: string;
  locale: string;
  timezoneId: string;
};

export type LaunchBrowser = (opts: LaunchOptions) => Promise<BrowserContextLike>;

/** Session headers the app emits for the investments channel, captured live. */
export type CapturedHeaders = {
  authorization_code?: string;
  sessionid?: string;
  fingerprint?: string;
  syncid?: string;
};

/** What the in-page capture hook accumulates as the app makes requests. */
export type CaptureState = {
  headers: CapturedHeaders;
  account: string | null;
  seen: number;
};

/** One investments API response, as handed to the parsers. */
export type ApiResult = {
  status: number;
  url: string;
  /** Raw response text; the caller parses JSON and classifies errors. */
  body: string;
};

/** One rendered banking screen, as handed to the DOM parsers. */
export type RenderResult = {
  url: string;
  title: string;
  /** Post-render HTML with scripts and styling stripped. */
  html: string;
};
