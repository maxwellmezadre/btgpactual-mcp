import { type Static, Type } from "@sinclair/typebox";

// The BTG session does NOT live in cookies alone. The app keeps its live token
// in sessionStorage under obfuscated keys, and sessionStorage is exactly the
// one web storage a persistent Chrome profile does not keep across restarts. So
// the session we persist is a SNAPSHOT: sessionStorage + localStorage + cookies
// + UA, captured at login. The headless bridge restores the web storage (via
// addInitScript) and injects the cookies before the app's own JavaScript runs,
// so it wakes up authenticated in a fresh context.
//
// We snapshot the WHOLE storages instead of guessing which keys matter: the app
// owns the shape, and restoring everything is what makes it wake up logged in.

/** The obfuscated sessionStorage keys the app is known to use. */
export const SESSION_MARKER_KEYS = [
  "_a",
  "_s",
  "_st",
  "_sessionExpire",
  "_i",
  "sessionid",
  "fingerprint",
  "syncId",
] as const;

export const CookieSchema = Type.Object({
  name: Type.String(),
  value: Type.String(),
  domain: Type.String(),
  path: Type.String(),
  expires: Type.Number(),
  httpOnly: Type.Boolean(),
  secure: Type.Boolean(),
  sameSite: Type.Optional(
    Type.Union([Type.Literal("Strict"), Type.Literal("Lax"), Type.Literal("None")]),
  ),
});

export type CookieRecord = Static<typeof CookieSchema>;

export const SnapshotSchema = Type.Object({
  version: Type.Literal(1),
  /** The app origin these storages belong to, e.g. https://app.btgpactual.com. */
  origin: Type.String({ minLength: 1 }),
  /** Full sessionStorage dump (the live session). */
  storage: Type.Record(Type.String(), Type.String()),
  /** Full localStorage dump, when captured (refresh token, device id). */
  local: Type.Optional(Type.Record(Type.String(), Type.String())),
  /** Cookies for the app origin, when captured via an attached real browser. */
  cookies: Type.Optional(Type.Array(CookieSchema)),
  /**
   * The User-Agent of the browser that minted this session. Replayed verbatim
   * by the headless bridge so the fingerprint does not shift between runs.
   */
  userAgent: Type.String(),
  /** Unix ms of the last save (login or token refresh mirrored back). */
  savedAt: Type.Number(),
  /** Investment account number, once discovered; feeds the investments URLs. */
  account: Type.Optional(Type.String()),
});

export type SessionData = Static<typeof SnapshotSchema>;

/** Does this snapshot carry the markers of a real logged-in session? */
export function hasLiveSession(data: SessionData): boolean {
  return SESSION_MARKER_KEYS.some((key) => {
    const value = data.storage[key];
    return typeof value === "string" && value.length > 0;
  });
}

/** Which marker keys are present (for `auth_status`, never their values). */
export function presentMarkers(data: SessionData): string[] {
  return SESSION_MARKER_KEYS.filter((key) => {
    const value = data.storage[key];
    return typeof value === "string" && value.length > 0;
  });
}

/**
 * Every storage and cookie value is a secret for log redaction: the access
 * token, the device fingerprint and the auth cookies are in there.
 */
export function sessionSecrets(data: SessionData): string[] {
  return [
    ...Object.values(data.storage),
    ...Object.values(data.local ?? {}),
    ...(data.cookies ?? []).map((cookie) => cookie.value),
  ];
}
