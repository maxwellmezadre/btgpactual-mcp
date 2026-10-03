import { homedir } from "node:os";
import { join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// TypeBox is the single source of truth for the config. Every value comes from
// the environment (12-factor, `BTG_` prefix); no `.env` files are read. The
// schema describes the *parsed* object (booleans, ints, absolute paths), not
// the raw strings.

export const BROWSER_CHANNELS = ["chrome", "chromium", "msedge"] as const;
export type BrowserChannel = (typeof BROWSER_CHANNELS)[number];

/** Chromium-based browsers whose profile can seed a login (macOS). */
export const IMPORT_BROWSERS = ["arc", "chrome", "chromium", "brave", "edge"] as const;
export type ImportBrowser = (typeof IMPORT_BROWSERS)[number];

export const DEFAULT_BASE_URL = "https://app.btgpactual.com";
export const SESSION_KEY_BYTES = 32;

export const ConfigSchema = Type.Object({
  /** Everything the tool persists lives under this directory. */
  configDir: Type.String({ minLength: 1 }),
  sessionPath: Type.String({ minLength: 1 }),
  keyPath: Type.String({ minLength: 1 }),
  dbPath: Type.String({ minLength: 1 }),
  /** Chrome profile of the headless bridge (data reads). */
  browserProfileDir: Type.String({ minLength: 1 }),
  /**
   * Profile of the dedicated Chrome `login` opens for the human. Kept apart from
   * the bridge profile: that one is driven by automation, this one never is,
   * which is what lets the reCAPTCHA pass.
   */
  loginProfileDir: Type.String({ minLength: 1 }),
  /** Chrome binary for `login`; overrides the per-OS default for the channel. */
  chromePath: Type.Optional(Type.String({ minLength: 1 })),
  /** Local DevTools port `login` opens while the human logs in. */
  debugPort: Type.Integer({ minimum: 1024, maximum: 65535 }),
  /** The only directory `export` may write to. */
  exportDir: Type.String({ minLength: 1 }),
  /** Base64 of 32 bytes. When absent the key file under configDir is used/created. */
  sessionKey: Type.Optional(Type.String({ minLength: 1 })),
  /** Overrides the investment account number discovered at runtime. */
  account: Type.Optional(Type.String({ minLength: 1 })),
  readOnly: Type.Boolean(),
  compact: Type.Boolean(),
  logFile: Type.Optional(Type.String({ minLength: 1 })),
  browserChannel: Type.Union([
    Type.Literal("chrome"),
    Type.Literal("chromium"),
    Type.Literal("msedge"),
  ]),
  importBrowser: Type.Optional(
    Type.Union([
      Type.Literal("arc"),
      Type.Literal("chrome"),
      Type.Literal("chromium"),
      Type.Literal("brave"),
      Type.Literal("edge"),
    ]),
  ),
  /** Data reads run headless; `false` shows the window (debugging, WAF/MFA). */
  headless: Type.Boolean(),
  /** Minimum gap between two network calls (plus random jitter). */
  minIntervalMs: Type.Integer({ minimum: 0 }),
  jitterMs: Type.Integer({ minimum: 0 }),
  /** Navigation budget for one page. */
  pageTimeoutMs: Type.Integer({ minimum: 1000 }),
  /** How long to wait for a banking screen to render its rows. */
  renderTimeoutMs: Type.Integer({ minimum: 1000 }),
  /**
   * Locale and timezone must match the ones used at login: dates and currency
   * change format otherwise, and a fingerprint that shifts between runs is a
   * classic bot signal.
   */
  locale: Type.String({ minLength: 2 }),
  timezone: Type.String({ minLength: 3 }),
  /** Overridable for tests (fake server). */
  baseUrl: Type.String({ minLength: 1 }),
});

export type Config = Static<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Configuração inválida do btgpactual-mcp:\n${problems
        .map((problem) => `  - ${problem}`)
        .join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function readOptional(env: Env, key: string): string | undefined {
  const raw = env[key]?.trim();
  return raw ? raw : undefined;
}

/** MCP client configs are JSON, not shell: `~/` has to be expanded by hand. */
function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function readBool(problems: string[], env: Env, key: string, fallback: boolean): boolean {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  const value = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  problems.push(`${key} deve ser boolean (1/0, true/false, yes/no, on/off), veio "${raw}"`);
  return fallback;
}

function readInt(problems: string[], env: Env, key: string, fallback: number, min: number): number {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    problems.push(`${key} deve ser inteiro >= ${min}, veio "${raw}"`);
    return fallback;
  }
  return parsed;
}

function readEnum<T extends string>(
  problems: string[],
  env: Env,
  key: string,
  allowed: readonly T[],
  fallback: T | undefined,
): T | undefined {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  const value = raw.toLowerCase();
  if ((allowed as readonly string[]).includes(value)) return value as T;
  problems.push(`${key} deve ser ${allowed.join("|")}, veio "${raw}"`);
  return fallback;
}

function readSessionKey(problems: string[], env: Env): string | undefined {
  const raw = readOptional(env, "BTG_SESSION_KEY");
  if (raw === undefined) return undefined;
  if (Buffer.from(raw, "base64").length !== SESSION_KEY_BYTES) {
    problems.push(
      `BTG_SESSION_KEY deve ser base64 de ${SESSION_KEY_BYTES} bytes (gere com: openssl rand -base64 32)`,
    );
    return undefined;
  }
  return raw;
}

function readUrl(problems: string[], env: Env, key: string, fallback: string): string {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
  } catch {
    problems.push(`${key} deve ser uma URL http(s), veio "${raw}"`);
    return fallback;
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Loads and validates the config from the environment (fail-fast). Every
 * problem is collected so the user fixes all of them in one go. Nothing is
 * required: a missing session fails at call time with an actionable
 * `AuthError`, not at boot.
 */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];

  const configDir = expandHome(
    readOptional(env, "BTG_CONFIG_DIR") ?? join(homedir(), ".config", "btgpactual-mcp"),
  );

  const config: Config = {
    configDir,
    sessionPath: join(configDir, "session.enc"),
    keyPath: join(configDir, "session.key"),
    dbPath: join(configDir, "cache.db"),
    browserProfileDir: join(configDir, "browser-profile"),
    loginProfileDir: join(configDir, "login-chrome"),
    chromePath: readOptional(env, "BTG_CHROME_PATH"),
    debugPort: readInt(problems, env, "BTG_DEBUG_PORT", 9222, 1024),
    exportDir: expandHome(
      readOptional(env, "BTG_EXPORT_DIR") ?? join(homedir(), "Downloads", "btgpactual-export"),
    ),
    sessionKey: readSessionKey(problems, env),
    account: readOptional(env, "BTG_ACCOUNT"),
    readOnly: readBool(problems, env, "BTG_READ_ONLY", false),
    compact: readBool(problems, env, "BTG_COMPACT", false),
    logFile: readOptional(env, "BTG_LOG_FILE"),
    browserChannel: readEnum(
      problems,
      env,
      "BTG_BROWSER_CHANNEL",
      BROWSER_CHANNELS,
      "chrome",
    ) as BrowserChannel,
    importBrowser: readEnum(problems, env, "BTG_IMPORT_BROWSER", IMPORT_BROWSERS, undefined),
    headless: readBool(problems, env, "BTG_HEADLESS", true),
    // ~1.5-3 s per network call. This is browsing speed against a bank behind a
    // WAF, not API speed; going faster is what earns a challenge.
    minIntervalMs: readInt(problems, env, "BTG_MIN_INTERVAL_MS", 1500, 0),
    jitterMs: readInt(problems, env, "BTG_JITTER_MS", 1500, 0),
    pageTimeoutMs: readInt(problems, env, "BTG_PAGE_TIMEOUT_MS", 45_000, 1000),
    renderTimeoutMs: readInt(problems, env, "BTG_RENDER_TIMEOUT_MS", 20_000, 1000),
    locale: readOptional(env, "BTG_LOCALE") ?? "pt-BR",
    timezone: readOptional(env, "BTG_TIMEZONE") ?? "America/Sao_Paulo",
    baseUrl: readUrl(problems, env, "BTG_BASE_URL", DEFAULT_BASE_URL),
  };

  if (!Value.Check(ConfigSchema, config)) {
    for (const error of Value.Errors(ConfigSchema, config)) {
      problems.push(`${error.path || "/"}: ${error.message}`);
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
