import { type Static, Type } from "@sinclair/typebox";

// The BTG session does NOT live in cookies. The app keeps it in sessionStorage
// under obfuscated keys, and sessionStorage is exactly the one web storage a
// persistent Chrome profile does not keep across restarts. So the session we
// persist is a SNAPSHOT of that storage, captured at login, which the headless
// bridge restores (via addInitScript) before the app's own JavaScript runs.
//
// We snapshot the WHOLE sessionStorage (and localStorage, where the refresh
// machinery may live) instead of guessing which keys matter: the app owns the
// shape, and restoring everything is what makes it wake up authenticated.

/** The obfuscated keys the app is known to use. Their presence means "logged in". */
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

export const SnapshotSchema = Type.Object({
  version: Type.Literal(1),
  /** The app origin these storages belong to, e.g. https://app.btgpactual.com. */
  origin: Type.String({ minLength: 1 }),
  /** Full sessionStorage dump (the live session). */
  storage: Type.Record(Type.String(), Type.String()),
  /** Full localStorage dump, when captured (refresh token, device id). */
  local: Type.Optional(Type.Record(Type.String(), Type.String())),
  /**
   * The User-Agent of the browser that minted this session. Replayed verbatim
   * by the headless bridge: a fingerprint that shifts between runs on one
   * session is a bot signal, and headless Chrome would otherwise announce
   * itself as "HeadlessChrome".
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
 * Every storage value is a secret for log redaction: the access token and the
 * device fingerprint are in there, opaque or not.
 */
export function sessionSecrets(data: SessionData): string[] {
  return [...Object.values(data.storage), ...Object.values(data.local ?? {})];
}
