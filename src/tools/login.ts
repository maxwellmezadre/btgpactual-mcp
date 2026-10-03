import { Type } from "@sinclair/typebox";
import { runAttachLogin } from "../session/attach.js";
import { runLogin } from "../session/login.js";
import { defineTool } from "./define.js";

// Saves the BTG session. The human always does the login (password,
// reCAPTCHA, MFA, account choice); nothing about it is automated. Not
// registered in read-only mode.

export const login = defineTool({
  name: "login",
  description:
    "Salva a sessão do BTG. Abre uma janela dedicada do Google Chrome no app, espera você fazer o " +
    "login (senha, \"não sou robô\", verificação em duas etapas) e escolher a conta, guarda a sessão " +
    "cifrada e fecha a janela. Nada da senha ou do MFA é automatizado. Abre uma janela: rode no seu " +
    "computador. Use quando `auth_status` disser que não há sessão ou que ela expirou.",
  readOnly: false,
  input: Type.Object({
    attach: Type.Optional(
      Type.Boolean({
        description:
          "Não abre janela: só copia a sessão de um Chrome que VOCÊ já abriu com --remote-debugging-port e logou",
      }),
    ),
    endpoint: Type.Optional(
      Type.String({ description: "Endpoint de depuração no modo attach (default http://localhost:9222)" }),
    ),
    timeout_seconds: Type.Optional(
      Type.Integer({ minimum: 60, maximum: 900, description: "Tempo máximo esperando o login (default 300)" }),
    ),
    fresh: Type.Optional(
      Type.Boolean({ description: "Apaga o perfil da janela de login antes (começa do zero)" }),
    ),
  }),
  run: async (args, ctx) => {
    // The reading browser still holds the old session (and the profile the
    // login check needs); the next read must start from the new one.
    await ctx.client().close();
    if (args.attach) return runAttachLogin(ctx, args.endpoint ? { endpoint: args.endpoint } : {});
    return runLogin(ctx, {
      ...(args.timeout_seconds ? { timeoutMs: args.timeout_seconds * 1000 } : {}),
      ...(args.fresh ? { fresh: true } : {}),
    });
  },
});
