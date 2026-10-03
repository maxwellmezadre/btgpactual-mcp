import { DUMP_STORAGE_SCRIPT } from "../browser/capture.js";
import { launchWithPlaywright } from "../browser/launch.js";
import { createBridge } from "../browser/transport.js";
import { HOME } from "../btg/paths.js";
import { ACCOUNT_SELECTION, isLoginUrl } from "../btg/routes.js";
import type { Ctx } from "../context.js";
import { AuthError, HttpError, LoginError } from "../core/errors.js";
import {
  type CdpTarget,
  type ListTargets,
  type OpenSession,
  evaluate,
  listTargets,
  openSession,
} from "./cdp.js";
import { type CookieRecord, SESSION_MARKER_KEYS, type SessionData } from "./snapshot.js";
import { createMemorySessionStore } from "./store.js";

// Attach login: the user logs into BTG in their OWN browser (started with
// --remote-debugging-port), clearing reCAPTCHA and MFA as a human. Never use
// --remote-allow-origins: our client sends no Origin header, which Chrome
// accepts without it, while that flag would let any web page on the machine
// open the debug socket and read the bank session. We read the session (sessionStorage + localStorage + cookies +
// UA) from that one tab over CDP and snapshot it. The headless bridge
// regenerates the live request headers from this snapshot on its own, so
// nothing here depends on the app having run our capture hook.

export const DEFAULT_CDP_ENDPOINT = "http://localhost:9222";


export type AttachOptions = { endpoint?: string };
/** Proves a candidate snapshot works headless; returns it refreshed (with the account). */
export type VerifySnapshot = (ctx: Ctx, candidate: SessionData) => Promise<SessionData>;

export type AttachDeps = { listTargets?: ListTargets; openSession?: OpenSession; verify?: VerifySnapshot };

export type AttachResult = {
  markers: string[];
  account: string | null;
  cookies: number;
  userAgent: string;
  savedAt: string;
};

type Dump = { storage: Record<string, string>; local: Record<string, string> };

type RawCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
};

function toCookieRecord(raw: RawCookie): CookieRecord {
  const sameSite =
    raw.sameSite === "Strict" || raw.sameSite === "Lax" || raw.sameSite === "None"
      ? raw.sameSite
      : undefined;
  return {
    name: raw.name,
    value: raw.value,
    domain: raw.domain,
    path: raw.path,
    expires: raw.expires,
    httpOnly: raw.httpOnly,
    secure: raw.secure,
    ...(sameSite ? { sameSite } : {}),
  };
}

function findAppTarget(targets: CdpTarget[], origin: string): CdpTarget {
  const page = targets.find((target) => target.type === "page" && target.url.startsWith(origin));
  if (!page?.webSocketDebuggerUrl) {
    throw new LoginError(
      `Nenhuma aba de ${origin} encontrada no navegador conectado. Abra o app, faça login e tente de novo.`,
    );
  }
  if (isLoginUrl(page.url, origin)) {
    throw new LoginError("A aba do BTG ainda está na tela de login. Termine o login (senha e verificação).");
  }
  if (ACCOUNT_SELECTION.test(page.url)) {
    throw new LoginError(
      "A aba do BTG está na seleção de conta. Escolha a conta, espere a tela inicial carregar e rode de novo.",
    );
  }
  return page;
}

export async function runAttachLogin(
  ctx: Ctx,
  opts: AttachOptions = {},
  deps: AttachDeps = {},
): Promise<AttachResult> {
  const origin = new URL(ctx.config.baseUrl).origin;
  const endpoint = opts.endpoint ?? DEFAULT_CDP_ENDPOINT;

  let targets: CdpTarget[];
  try {
    targets = await (deps.listTargets ?? listTargets)(endpoint);
  } catch (error) {
    throw new LoginError(
      `Não consegui falar com ${endpoint}: ${(error as Error).message}. ` +
        "Rode `btgpactual login` (abre o Chrome certo sozinho) ou abra o Chrome com `--remote-debugging-port=9222`.",
    );
  }
  const target = findAppTarget(targets, origin);

  let session: Awaited<ReturnType<OpenSession>>;
  try {
    session = await (deps.openSession ?? openSession)(target.webSocketDebuggerUrl as string);
  } catch (error) {
    throw new LoginError(
      `Não consegui abrir a aba do BTG pelo CDP: ${(error as Error).message}.`,
    );
  }

  // Reading the tab is the fragile part: right after Chrome opens, the tab
  // already reports the app url while its document is still the initial empty
  // one, and sessionStorage throws a SecurityError. Any failure while READING
  // is therefore "not ready yet" (a LoginError, so `login` keeps waiting);
  // saving the snapshot stays outside, where a failure is real.
  let dump: Dump;
  let markers: string[];
  let userAgent: string;
  let cookies: CookieRecord[];
  try {
    dump = await evaluate<Dump>(session, DUMP_STORAGE_SCRIPT);
    markers = SESSION_MARKER_KEYS.filter((key) => dump.storage[key]);
    if (markers.length === 0) {
      throw new LoginError(
        "A aba do BTG não tem os marcadores de sessão. Confirme que o login terminou e que a tela inicial carregou.",
      );
    }
    userAgent = await evaluate<string>(session, "navigator.userAgent");
    // Network.getCookies with the app URL returns exactly the cookies the app
    // sends (parent-domain ones included), HttpOnly ones too.
    const { cookies: raw } = await session.send<{ cookies: RawCookie[] }>("Network.getCookies", {
      urls: [origin],
    });
    cookies = raw.map(toCookieRecord);
  } catch (error) {
    if (error instanceof LoginError) throw error;
    throw new LoginError(
      `A aba do BTG ainda não pôde ser lida (${(error as Error).message.split("\n")[0]}). Se está carregando, é só esperar.`,
    );
  } finally {
    session.close();
  }

  const candidate: SessionData = {
    version: 1,
    origin,
    storage: dump.storage,
    local: dump.local,
    ...(cookies.length ? { cookies } : {}),
    userAgent,
    savedAt: ctx.now(),
  };
  // Markers alone are not proof: right after the password the app briefly sits
  // on "/" with a session but no account chosen yet. Only accept a snapshot the
  // headless bridge can actually use.
  const data = await (deps.verify ?? verifyWithBridge)(ctx, candidate);
  ctx.session.save(data);
  ctx.log.info(`sessão anexada (${markers.length} marcadores, ${cookies.length} cookies)`);
  return {
    markers,
    account: data.account ?? null,
    cookies: cookies.length,
    userAgent,
    savedAt: new Date(data.savedAt).toISOString(),
  };
}

/**
 * Restores the candidate in the headless bridge and makes one investments call.
 * "Not usable yet" (account not chosen, session not accepted, network blip)
 * becomes a LoginError, so `login` keeps waiting with the window open.
 */
export const verifyWithBridge: VerifySnapshot = async (ctx, candidate) => {
  const store = createMemorySessionStore(candidate);
  const bridge = createBridge({
    session: store,
    launch: launchWithPlaywright,
    config: ctx.config,
    log: ctx.log,
    now: ctx.now,
    idleMs: 0,
  });
  try {
    await bridge.apiGet(HOME);
    const refreshed = store.data ?? candidate;
    const account = bridge.account();
    return account ? { ...refreshed, account } : refreshed;
  } catch (error) {
    if (error instanceof AuthError || error instanceof HttpError) {
      throw new LoginError(
        "A sessão ainda não abre a conta no navegador de leitura. Escolha a conta (Acessar) e espere a tela inicial.",
      );
    }
    throw error;
  } finally {
    await bridge.close();
  }
};
