import { Type } from "@sinclair/typebox";
import { runLogin } from "../session/login.js";
import { defineTool } from "./define.js";

// Opens a real Chrome window for the user to log in and clear MFA by hand, then
// snapshots the session. Not registered in read-only mode. Password, OTP and
// push approval are never automated.

export const login = defineTool({
  name: "login",
  description:
    "Abre o Google Chrome para você entrar na sua conta BTG (senha, verificação em duas etapas, " +
    "aprovação no app) e salva a sessão cifrada em disco. Nada da senha ou do MFA é automatizado. " +
    "Use quando `auth_status` disser que não há sessão ou que ela expirou. Abre uma janela: rode no " +
    "seu computador, não num servidor.",
  readOnly: false,
  input: Type.Object({
    timeout_seconds: Type.Optional(
      Type.Integer({
        minimum: 60,
        maximum: 900,
        description: "Tempo máximo esperando o login terminar (default 300)",
      }),
    ),
    fresh: Type.Optional(
      Type.Boolean({ description: "Apaga o perfil do navegador antes, para um login do zero" }),
    ),
  }),
  run: async (args, ctx) =>
    runLogin(ctx, {
      ...(args.timeout_seconds ? { timeoutMs: args.timeout_seconds * 1000 } : {}),
      ...(args.fresh ? { fresh: true } : {}),
    }),
});
