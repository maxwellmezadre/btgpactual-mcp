import { AuthError, BankingRenderError, CaptchaError, HttpError, ParseError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import type { Bridge, RenderOptions } from "./transport.js";
import type { ApiResult, RenderResult } from "./types.js";

// The single funnel to the BTG app. It enforces the anti-bot contract in ONE
// place: strictly serial calls, a minimum gap plus jitter, exponential backoff
// on transient failures, and a circuit breaker that stops the process the
// moment a challenge appears, with a cooldown persisted so a retrying agent (or
// a brand new process) cannot make the block worse. Every temporal collaborator
// is injectable so the tests are deterministic.

export const BACKOFF_BASE_MS = 20_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 3;
export const COOLDOWN_MS = 30 * 60_000;

export const CAPTCHA_MESSAGE =
  "O BTG exigiu verificação adicional. Abra app.btgpactual.com no seu navegador, " +
  "resolva o desafio e só então rode de novo — insistir agora aprofunda o bloqueio.";

export type CooldownStore = { get(): number | null; set(until: number): void };

export type ClientState = { tripped: boolean; calls: number; lastCallAt: number | null };

export type BrowserClient = {
  /** Investments GET through the queue; relative paths resolve against the base url. */
  apiGet(path: string): Promise<ApiResult>;
  /** Banking screen render through the same queue and breaker. */
  render(path: string, opts: RenderOptions): Promise<RenderResult>;
  account(): string | null;
  state(): ClientState;
  cooldownUntil(): number | null;
  close(): Promise<void>;
};

export type ClientOptions = {
  bridge: Bridge;
  minIntervalMs: number;
  jitterMs: number;
  log: Logger;
  cooldown?: CooldownStore;
};

export type ClientDeps = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

export const backoffMs = (attempt: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);

/**
 * Worth another try? A failed navigation, an HTTP blip or a banking screen that
 * did not paint are transient. An expired session, a challenge and a changed
 * layout are verdicts: retrying wastes requests and deepens a block.
 */
export const isRetryable = (error: unknown): boolean =>
  error instanceof HttpError || error instanceof BankingRenderError;

export function createBrowserClient(opts: ClientOptions, deps: ClientDeps = {}): BrowserClient {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const { bridge, log } = opts;

  let lastCallAt = Number.NEGATIVE_INFINITY;
  let tripped = false;
  let calls = 0;
  let chain: Promise<unknown> = Promise.resolve();

  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const untilLabel = (until: number): string =>
    new Date(until).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  function trip(reason: string): never {
    tripped = true;
    const until = now() + COOLDOWN_MS;
    opts.cooldown?.set(until);
    log.error(`challenge detected (${reason}); BTG client disabled, cooldown until ${untilLabel(until)}`);
    throw new CaptchaError(`${CAPTCHA_MESSAGE} Aguarde até ${untilLabel(until)}.`);
  }

  function assertUsable(): void {
    if (tripped) throw new CaptchaError(CAPTCHA_MESSAGE);
    const until = opts.cooldown?.get() ?? null;
    if (until !== null && until > now()) {
      throw new CaptchaError(`${CAPTCHA_MESSAGE} Aguarde até ${untilLabel(until)}.`);
    }
  }

  async function gap(): Promise<void> {
    const wait = lastCallAt + opts.minIntervalMs + random() * opts.jitterMs - now();
    if (wait > 0) await sleep(wait);
    lastCallAt = now();
  }

  async function attempt<T>(label: string, fn: () => Promise<T>): Promise<T> {
    for (let n = 1; ; n += 1) {
      await gap();
      try {
        const result = await fn();
        calls += 1;
        return result;
      } catch (error) {
        if (error instanceof CaptchaError) trip("raised by the bridge");
        if (error instanceof AuthError || error instanceof ParseError) throw error;
        if (isRetryable(error) && n < MAX_ATTEMPTS) {
          const wait = backoffMs(n);
          log.warn(
            `${(error as Error).name} on ${label} (attempt ${n}/${MAX_ATTEMPTS}); retrying in ${Math.round(wait / 1000)}s`,
          );
          await sleep(wait);
          continue;
        }
        throw error;
      }
    }
  }

  return {
    apiGet: (path) =>
      serial(() => {
        assertUsable();
        return attempt(path, () => bridge.apiGet(path));
      }),
    render: (path, options) =>
      serial(() => {
        assertUsable();
        return attempt(path, () => bridge.render(path, options));
      }),
    account: () => bridge.account(),
    state: () => ({ tripped, calls, lastCallAt: Number.isFinite(lastCallAt) ? lastCallAt : null }),
    cooldownUntil: () => {
      const until = opts.cooldown?.get() ?? null;
      return until !== null && until > now() ? until : null;
    },
    close: () => bridge.close(),
  };
}
