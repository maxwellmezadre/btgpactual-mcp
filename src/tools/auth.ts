import { Type } from "@sinclair/typebox";
import { HOME } from "../btg/paths.js";
import { AuthError, BankingRenderError, CaptchaError, HttpError } from "../core/errors.js";
import { hasLiveSession, presentMarkers } from "../session/snapshot.js";
import { compactObject, defineTool } from "./define.js";

// Session diagnostics. Free by default: it reads the local snapshot and says
// nothing that could not be derived from it, never a secret value. `verify:
// true` spends exactly one investments request to confirm the app still
// accepts the session.

/** Observed: a BTG web session stops being accepted after roughly two hours. */
export const LIKELY_EXPIRED_HOURS = 2;

export type AuthStatus = {
  loggedIn: boolean;
  verified?: boolean;
  error?: string;
  sessionFile: string;
  /** Which obfuscated session markers are present (names only, never values). */
  markers: string[];
  account: string | null;
  userAgent: string | null;
  savedAt: string | null;
  ageHours: number | null;
  breaker: "ok" | "tripped";
  cooldownUntil: string | null;
  browserRunning: boolean;
  hint?: string;
};

export const authStatus = defineTool({
  name: "auth_status",
  description:
    "Diz se há uma sessão do BTG salva e o que ela cobre (marcadores de sessão presentes, conta de " +
    "investimento, idade, navegador de origem) sem usar a rede. Com verify=true gasta 1 requisição " +
    "ao canal investments para confirmar que o app ainda aceita a sessão. Nunca mostra valores de " +
    "token. Comece por aqui quando outra tool reclamar de sessão.",
  readOnly: true,
  input: Type.Object({
    verify: Type.Optional(
      Type.Boolean({ description: "Também confirma a sessão com 1 requisição ao canal investments" }),
    ),
  }),
  run: async (args, ctx): Promise<AuthStatus> => {
    const { session, config } = ctx;
    const client = ctx.client();
    let data: ReturnType<typeof session.load> = null;
    let loadError: string | undefined;
    try {
      data = session.load();
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }

    const cooldown = client.cooldownUntil();
    const base: AuthStatus = {
      loggedIn: data !== null && hasLiveSession(data),
      sessionFile: config.sessionPath,
      markers: data ? presentMarkers(data) : [],
      account: config.account ?? data?.account ?? null,
      userAgent: data?.userAgent ?? null,
      savedAt: data ? new Date(data.savedAt).toISOString() : null,
      ageHours: data ? Math.floor((ctx.now() - data.savedAt) / 3_600_000) : null,
      breaker: client.state().tripped ? "tripped" : "ok",
      cooldownUntil: cooldown === null ? null : new Date(cooldown).toISOString(),
      browserRunning: client.state().calls > 0,
    };

    if (loadError) return compactObject({ ...base, loggedIn: false, error: loadError });
    if (data === null) {
      return compactObject({ ...base, hint: "Nenhuma sessão salva. Rode `btgpactual login`." });
    }
    if (!base.loggedIn) {
      return compactObject({
        ...base,
        hint: "A sessão salva não tem os marcadores de sessão do BTG. Rode `btgpactual login`.",
      });
    }
    if (!args.verify) {
      return compactObject({
        ...base,
        hint:
          (base.ageHours ?? 0) >= LIKELY_EXPIRED_HOURS
            ? `Sessão salva há ${base.ageHours}h; o BTG costuma expirar a sessão em cerca de ${LIKELY_EXPIRED_HOURS}h. Confirme com verify=true; o cache continua respondendo.`
            : undefined,
      });
    }

    try {
      await client.apiGet(HOME);
      return compactObject({ ...base, verified: true, account: client.account() ?? base.account });
    } catch (error) {
      if (
        error instanceof AuthError ||
        error instanceof CaptchaError ||
        error instanceof BankingRenderError ||
        error instanceof HttpError
      ) {
        return compactObject({
          ...base,
          loggedIn: false,
          verified: false,
          breaker: client.state().tripped ? "tripped" : base.breaker,
          error: error.message,
        });
      }
      throw error;
    }
  },
});
