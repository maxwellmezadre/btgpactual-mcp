// Error taxonomy for everything that talks to the BTG Pactual app. Messages are
// user-facing (pt-BR) and actionable; the classes let callers (bridge, sync,
// tools, CLI) branch on the *kind* of failure without parsing text.

export const LOGIN_HINT = "Rode `btgpactual login` no terminal (login manual no navegador, com MFA).";

/** No session, or the app rejected it (expired token). Fix: `btgpactual login`. */
export class AuthError extends Error {
  constructor(message: string) {
    super(`${message} ${LOGIN_HINT}`);
    this.name = "AuthError";
  }
}

/**
 * An anti-bot / device challenge appeared. The client is disabled for the rest
 * of the process and a cooldown is persisted, because retrying is what deepens
 * the block.
 */
export class CaptchaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptchaError";
  }
}

/** Transport-level failure (network, unexpected status, non-JSON body). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * A banking screen loaded with a live session but never rendered the data we
 * asked for (Angular did not paint the rows in time, or the layout changed).
 * Distinct from "0 rows": retryable once, then surfaced so nobody reports an
 * empty statement as real.
 */
export class BankingRenderError extends Error {
  constructor(message: string) {
    super(`${message} Rode \`btgpactual doctor\` para ver qual camada quebrou.`);
    this.name = "BankingRenderError";
  }
}

/** The encrypted session file or its key is unusable. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

/** The interactive browser login did not complete. */
export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginError";
  }
}

/**
 * A JSON payload (investments) or rendered DOM (banking) no longer looks like
 * what the parsers expect — the BTG front-end changed. Actionable: `doctor`
 * says which layer broke, `docs/REDISCOVERY.md` says how to remap it.
 */
export class ParseError extends Error {
  constructor(message: string) {
    super(`${message} Rode \`btgpactual doctor\` para ver qual camada quebrou.`);
    this.name = "ParseError";
  }
}
