import { ACCOUNT_SELECTION, isLoginUrl } from "../btg/routes.js";
import type { Config } from "../config.js";
import { AuthError, BankingRenderError, HttpError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import type { SessionData, SessionStore } from "../session/store.js";
import {
  CAPTURE_SCRIPT,
  DUMP_STORAGE_SCRIPT,
  EXTRACT_SCRIPT,
  READ_CAPTURE_SCRIPT,
  apiFetchScript,
  hasRequiredHeaders,
  mergeHeaders,
  readyScript,
  restoreScript,
} from "./capture.js";
import type {
  ApiResult,
  BrowserContextLike,
  CaptureState,
  CapturedHeaders,
  LaunchBrowser,
  PageLike,
  RenderResult,
  RouteLike,
} from "./types.js";

// Why a browser at all: the BTG app guards both API channels with a live,
// in-app session, and the banking channel is encrypted by the app itself. So we
// drive one authenticated Chrome and let the app do its own signing and
// decryption. The bridge acquires data two ways:
//   - investments: replay a GET with the captured session headers -> plain JSON;
//   - banking: navigate the screen and hand the rendered DOM to the parsers.
// Pacing, retries and the breaker live in client.ts.

const WARMUP_POLL_MS = 400;
/**
 * The session headers show up on the very first investments call, but the
 * account number only appears later, in a per-account url (allocation,
 * advisor...). Wait this long for it before settling for account-less.
 */
const ACCOUNT_GRACE_MS = 6_000;
const DEFAULT_IDLE_MS = 5 * 60_000;
const BLOCKED_RESOURCES = new Set(["image", "font", "media"]);

export type RenderOptions = {
  /** CSS selector that proves the screen finished rendering its rows. */
  readySelector: string;
};

export type Bridge = {
  /** Replays an investments GET and returns the raw response. */
  apiGet(path: string): Promise<ApiResult>;
  /** Navigates a banking screen and returns inert rendered HTML. */
  render(path: string, opts: RenderOptions): Promise<RenderResult>;
  /** The investment account number discovered at warm-up (or configured). */
  account(): string | null;
  /** True once a browser is up; `doctor`/`auth_status` report it without launching one. */
  running(): boolean;
  close(): Promise<void>;
};

export type BridgeOptions = {
  session: SessionStore;
  launch: LaunchBrowser;
  config: Pick<
    Config,
    | "account"
    | "baseUrl"
    | "browserChannel"
    | "browserProfileDir"
    | "headless"
    | "locale"
    | "pageTimeoutMs"
    | "renderTimeoutMs"
    | "timezone"
  >;
  log: Logger;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  idleMs?: number;
};

export function createBridge(opts: BridgeOptions): Bridge {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => Date.now());
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const { config, log } = opts;
  const origin = new URL(config.baseUrl).origin;

  let context: BrowserContextLike | null = null;
  let page: PageLike | null = null;
  let data: SessionData | null = null;
  let headers: CapturedHeaders = {};
  let account: string | null = config.account ?? null;
  let warmed = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  async function close(): Promise<void> {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const current = context;
    context = null;
    page = null;
    warmed = false;
    if (current) await current.close().catch(() => undefined);
  }

  function touch(): void {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleMs <= 0) return;
    idleTimer = setTimeout(() => void close(), idleMs);
    (idleTimer as { unref?: () => void }).unref?.();
  }

  const landedOnLogin = (url: string): boolean => isLoginUrl(url, origin);

  async function ensurePage(): Promise<PageLike> {
    if (page) return page;
    data = opts.session.load();
    if (!data) throw new AuthError("Nenhuma sessão do BTG salva.");
    account = config.account ?? data.account ?? account;
    log.info(`starting ${config.headless ? "headless" : "windowed"} browser for BTG`);
    context = await opts.launch({
      channel: config.browserChannel,
      profileDir: config.browserProfileDir,
      headless: config.headless,
      userAgent: data.userAgent,
      locale: config.locale,
      timezoneId: config.timezone,
    });
    try {
      // The snapshot restores the session; the capture hook records the live
      // headers. Both must be in place before the SPA boots, hence addInitScript.
      await context.addInitScript(restoreScript(data));
      await context.addInitScript(CAPTURE_SCRIPT);
      if (data.cookies?.length) await context.addCookies?.(data.cookies);
      await context.route?.("**/*", (route: RouteLike) =>
        BLOCKED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue(),
      );
      const fresh = await context.newPage();
      page = fresh;
      return fresh;
    } catch (error) {
      await close();
      throw error;
    }
  }

  /** Mirror a refreshed session back to disk so a later cold start restores it. */
  async function persistSnapshot(current: PageLike): Promise<void> {
    if (!data) return;
    try {
      const dump = (await current.evaluate(DUMP_STORAGE_SCRIPT)) as {
        storage: Record<string, string>;
        local: Record<string, string>;
      };
      if (!dump?.storage || Object.keys(dump.storage).length === 0) return;
      const next: SessionData = {
        ...data,
        storage: dump.storage,
        local: dump.local,
        savedAt: now(),
        ...(account ? { account } : {}),
      };
      if (JSON.stringify(next.storage) === JSON.stringify(data.storage) && next.account === data.account) {
        return;
      }
      data = next;
      opts.session.save(next);
    } catch (error) {
      log.warn(`could not mirror session snapshot: ${(error as Error).message}`);
    }
  }

  /** Loads the home so the app fires its investments calls, and captures the headers. */
  async function warmUp(): Promise<void> {
    if (warmed) return;
    const current = await ensurePage();
    try {
      await current.goto(`${config.baseUrl}/`, {
        waitUntil: "domcontentloaded",
        timeout: config.pageTimeoutMs,
      });
    } catch (error) {
      throw new HttpError(0, `Falha ao abrir o app BTG: ${(error as Error).message}`);
    }
    const deadline = now() + config.renderTimeoutMs;
    let accountDeadline: number | null = null;
    for (;;) {
      if (landedOnLogin(current.url())) {
        throw new AuthError("O BTG não aceitou a sessão salva e pediu login.");
      }
      // A snapshot taken before the account was chosen restores into the
      // account picker, where the app never calls the investments channel.
      // Say so at once instead of waiting out the timeout.
      if (ACCOUNT_SELECTION.test(current.url())) {
        throw new AuthError("A sessão salva para na seleção de conta (a conta não foi escolhida antes de salvar).");
      }
      const state = (await current.evaluate(READ_CAPTURE_SCRIPT)) as CaptureState;
      headers = mergeHeaders(headers, state);
      if (state.account && !config.account) account = state.account;
      if (hasRequiredHeaders(headers)) {
        if (account) break;
        accountDeadline ??= now() + ACCOUNT_GRACE_MS;
        // Account-less is still usable; per-account calls will say what is missing.
        if (now() >= accountDeadline) break;
      } else if (now() >= deadline) {
        throw new AuthError(
          "A sessão do BTG não ficou ativa no navegador (o app não emitiu os headers de sessão).",
        );
      }
      await sleep(WARMUP_POLL_MS);
    }
    warmed = true;
    await persistSnapshot(current);
    touch();
  }

  async function apiGet(path: string): Promise<ApiResult> {
    await warmUp();
    const current = page as PageLike;
    const url = new URL(path, config.baseUrl).toString();
    const result = (await current.evaluate(apiFetchScript(url, headers))) as ApiResult;
    if (result.status === 401 || result.status === 403) {
      throw new AuthError(`O BTG respondeu ${result.status} em ${path}.`);
    }
    if (result.status >= 400) {
      throw new HttpError(result.status, `BTG respondeu HTTP ${result.status} em ${path}.`);
    }
    touch();
    return result;
  }

  async function render(path: string, options: RenderOptions): Promise<RenderResult> {
    const current = await ensurePage();
    const url = new URL(path, config.baseUrl).toString();
    try {
      await current.goto(url, { waitUntil: "domcontentloaded", timeout: config.pageTimeoutMs });
    } catch (error) {
      throw new HttpError(0, `Falha ao abrir ${url}: ${(error as Error).message}`);
    }
    if (landedOnLogin(current.url())) {
      throw new AuthError(`O BTG pediu login ao abrir ${path}.`);
    }
    const script = readyScript(options.readySelector);
    const deadline = now() + config.renderTimeoutMs;
    for (;;) {
      const state = (await current.evaluate(script)) as { ready: boolean };
      if (state?.ready) break;
      if (now() >= deadline) {
        throw new BankingRenderError(
          `A tela ${path} abriu com sessão ativa mas não renderizou "${options.readySelector}".`,
        );
      }
      await sleep(WARMUP_POLL_MS);
    }
    const result = (await current.evaluate(EXTRACT_SCRIPT)) as RenderResult;
    touch();
    return result;
  }

  return {
    apiGet,
    render,
    account: () => account,
    running: () => context !== null,
    close,
  };
}
