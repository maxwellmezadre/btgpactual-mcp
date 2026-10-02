import { mkdirSync, rmSync } from "node:fs";
import {
  CAPTURE_SCRIPT,
  DUMP_STORAGE_SCRIPT,
  READ_CAPTURE_SCRIPT,
} from "../browser/capture.js";
import { launchWithPlaywright } from "../browser/launch.js";
import type { BrowserContextLike, CaptureState, LaunchBrowser, PageLike } from "../browser/types.js";
import type { Ctx } from "../context.js";
import { LoginError } from "../core/errors.js";
import { SESSION_MARKER_KEYS, type SessionData } from "./snapshot.js";

// Interactive login. A real window opens and the USER types the password, the
// MFA code and approves any push. Nothing about that is automated: a bank runs
// dedicated bot detection on its sign-in, and the whole point of this design is
// that the second factor stays with the human.
//
// Success is detected by the thing the tool actually needs, not by a URL: the
// app left the sign-in screen, the session markers are in sessionStorage, and
// the app fired at least one investments request (so the capture hook holds the
// live headers). That survives the MFA interstitials in one shot.

export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 1_500;
const REPORT_EVERY_MS = 30_000;
const LOGIN_URL_HINTS = ["/login", "/auth", "/signin", "/authentication"];

export type LoginOptions = {
  timeoutMs?: number;
  /** Wipe the automation profile first, so BTG sees a brand-new device. */
  fresh?: boolean;
  report?: (message: string) => void;
};

export type LoginDeps = { launch?: LaunchBrowser; sleep?: (ms: number) => Promise<void> };

export type LoginResult = {
  markers: string[];
  account: string | null;
  storageKeys: number;
  userAgent: string;
  savedAt: string;
};

type Dump = { storage: Record<string, string>; local: Record<string, string> };

export async function runLogin(
  ctx: Ctx,
  opts: LoginOptions = {},
  deps: LoginDeps = {},
): Promise<LoginResult> {
  const report = opts.report ?? ((message: string) => ctx.log.info(message));
  const { config } = ctx;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const origin = new URL(config.baseUrl).origin;

  if (opts.fresh) rmSync(config.browserProfileDir, { recursive: true, force: true });
  mkdirSync(config.browserProfileDir, { recursive: true, mode: 0o700 });

  let context: BrowserContextLike;
  try {
    context = await (deps.launch ?? launchWithPlaywright)({
      channel: config.browserChannel,
      profileDir: config.browserProfileDir,
      headless: false, // always a real window: this is where the human works.
      locale: config.locale,
      timezoneId: config.timezone,
    });
  } catch (error) {
    throw new LoginError(
      `Não consegui abrir o navegador (${config.browserChannel}): ${(error as Error).message}\n` +
        "Instale o Google Chrome, ou rode `bunx playwright install chromium` e use BTG_BROWSER_CHANNEL=chromium.",
    );
  }

  try {
    // The capture hook must be in place before the app boots, so it records the
    // session headers as the user finishes logging in.
    await context.addInitScript(CAPTURE_SCRIPT);
    const page = await context.newPage();
    await page.goto(`${config.baseUrl}/`, {
      waitUntil: "domcontentloaded",
      timeout: config.pageTimeoutMs,
    });
    report(
      "Faça login na janela do navegador (senha, verificação em duas etapas, aprovação no app). " +
        "Estou esperando a sessão ficar ativa.",
    );

    const { dump, capture } = await waitForSession(
      ctx,
      page,
      origin,
      timeoutMs,
      report,
      deps.sleep ?? sleep,
    );

    const userAgent = String(await page.evaluate("navigator.userAgent"));
    const account = capture.account ?? undefined;
    const savedAt = ctx.now();
    const data: SessionData = {
      version: 1,
      origin,
      storage: dump.storage,
      local: dump.local,
      userAgent,
      savedAt,
      ...(account ? { account } : {}),
    };
    ctx.session.save(data);

    const markers = SESSION_MARKER_KEYS.filter((key) => dump.storage[key]);
    report(`Sessão salva (${Object.keys(dump.storage).length} chaves, marcadores: ${markers.join(", ")}).`);
    return {
      markers,
      account: account ?? null,
      storageKeys: Object.keys(dump.storage).length,
      userAgent,
      savedAt: new Date(savedAt).toISOString(),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Polls until the app left the sign-in screen, the session markers are in
 * sessionStorage AND the capture hook saw an investments request. The marker
 * check alone is not enough: a half-finished login can seed some keys, so we
 * also require the app to have actually called its API as the logged-in user.
 */
async function waitForSession(
  ctx: Ctx,
  page: PageLike,
  origin: string,
  timeoutMs: number,
  report: (message: string) => void,
  wait: (ms: number) => Promise<void>,
): Promise<{ dump: Dump; capture: CaptureState }> {
  const deadline = ctx.now() + timeoutMs;
  let lastReport = ctx.now();

  for (;;) {
    const url = page.url();
    const onLogin = !url.startsWith(origin) || LOGIN_URL_HINTS.some((hint) => url.includes(hint));
    if (!onLogin) {
      const dump = (await page.evaluate(DUMP_STORAGE_SCRIPT).catch(() => null)) as Dump | null;
      const capture = (await page.evaluate(READ_CAPTURE_SCRIPT).catch(() => null)) as CaptureState | null;
      const hasMarkers = dump ? SESSION_MARKER_KEYS.some((key) => dump.storage[key]) : false;
      if (dump && capture && hasMarkers && capture.seen > 0) return { dump, capture };
    }
    if (ctx.now() >= deadline) {
      throw new LoginError(
        `Login não concluído em ${Math.round(timeoutMs / 1000)}s. Rode \`btgpactual login\` de novo.`,
      );
    }
    if (ctx.now() - lastReport >= REPORT_EVERY_MS) {
      lastReport = ctx.now();
      report("Ainda esperando a sessão ficar ativa…");
    }
    await wait(POLL_MS);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
