import { rmSync } from "node:fs";
import type { Ctx } from "../context.js";
import { LoginError } from "../core/errors.js";
import { type AttachResult, runAttachLogin } from "./attach.js";
import { type LaunchChrome, launchChrome, loginChromeArgs, resolveChrome } from "./chrome.js";

// `btgpactual login`: opens a dedicated, NON-automated Chrome on the BTG app,
// waits while the human logs in (password, reCAPTCHA, MFA, account choice),
// snapshots the session over CDP, and closes that Chrome again. The DevTools
// port is therefore open only for the length of the login. The session
// survives the window closing (verified live), so nothing is lost.
//
// If something already listens on the port (a Chrome the user opened by hand
// with --remote-debugging-port), it is reused and left open: we did not start
// it, so we do not close it.

export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const PORT_TIMEOUT_MS = 20_000;
const POLL_MS = 2_000;
const REPORT_EVERY_MS = 30_000;

export type LoginOptions = {
  timeoutMs?: number;
  /** Wipe the dedicated login profile first (only when this run starts Chrome). */
  fresh?: boolean;
  report?: (message: string) => void;
};

export type LoginDeps = {
  /** Does a DevTools endpoint answer at this address? */
  probe?: (endpoint: string) => Promise<boolean>;
  launch?: LaunchChrome;
  resolveBinary?: () => string | null;
  attach?: (ctx: Ctx, endpoint: string) => Promise<AttachResult>;
  sleep?: (ms: number) => Promise<void>;
};

export type LoginResult = AttachResult & { browser: "launched" | "reused" };

const probeDevtools = async (endpoint: string): Promise<boolean> => {
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function runLogin(ctx: Ctx, opts: LoginOptions = {}, deps: LoginDeps = {}): Promise<LoginResult> {
  const { config } = ctx;
  const report = opts.report ?? ((message: string) => ctx.log.info(message));
  const wait = deps.sleep ?? sleep;
  const probe = deps.probe ?? probeDevtools;
  const attach = deps.attach ?? ((c: Ctx, endpoint: string) => runAttachLogin(c, { endpoint }));
  const endpoint = `http://127.0.0.1:${config.debugPort}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;

  let launched: ReturnType<LaunchChrome> | null = null;
  if (!(await probe(endpoint))) {
    const binary = (deps.resolveBinary ?? (() => resolveChrome(config.browserChannel, config.chromePath)))();
    if (!binary) {
      throw new LoginError(
        `Não achei o ${config.browserChannel} instalado. Instale o Google Chrome ou aponte BTG_CHROME_PATH para o executável.`,
      );
    }
    if (opts.fresh) rmSync(config.loginProfileDir, { recursive: true, force: true });
    launched = (deps.launch ?? launchChrome)(
      binary,
      loginChromeArgs({ port: config.debugPort, profileDir: config.loginProfileDir, url: `${config.baseUrl}/` }),
    );
    const portDeadline = ctx.now() + PORT_TIMEOUT_MS;
    while (!(await probe(endpoint))) {
      if (ctx.now() >= portDeadline) {
        launched.close();
        throw new LoginError(
          "O Chrome abriu mas a porta de depuração não respondeu. Se já havia uma janela do Chrome de login aberta, feche-a e rode de novo.",
        );
      }
      await wait(500);
    }
  }

  try {
    report(
      "Abri o Chrome no app do BTG. Faça login (senha, \"não sou robô\", verificação em duas etapas), " +
        "escolha a conta e espere a tela inicial. Eu detecto sozinho e salvo a sessão.",
    );
    const deadline = ctx.now() + timeoutMs;
    let lastReport = ctx.now();
    let lastState = "";
    for (;;) {
      try {
        const result = await attach(ctx, endpoint);
        return { ...result, browser: launched ? "launched" : "reused" };
      } catch (error) {
        // "Not there yet" (login screen, account choice, no tab) is a LoginError:
        // keep waiting. Anything else (disk, key) is a real failure.
        if (!(error instanceof LoginError)) throw error;
        lastState = error.message;
      }
      if (ctx.now() >= deadline) {
        throw new LoginError(
          `Login não concluído em ${Math.round(timeoutMs / 1000)}s. Último estado: ${lastState} Rode \`btgpactual login\` de novo.`,
        );
      }
      if (ctx.now() - lastReport >= REPORT_EVERY_MS) {
        lastReport = ctx.now();
        report(`Ainda esperando: ${lastState}`);
      }
      await wait(POLL_MS);
    }
  } finally {
    launched?.close();
  }
}
