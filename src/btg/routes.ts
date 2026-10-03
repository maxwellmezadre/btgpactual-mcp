// What the app's own routes mean to us. Kept in one place because the bridge
// (is the restored session accepted?) and the login (has the human finished?)
// must agree on it.

/** Route fragments the app redirects to when there is no accepted session. */
export const LOGIN_URL_HINTS = ["/login", "/auth", "/signin", "/authentication"] as const;

/** Post-login screen where the human still has to pick which account to open. */
export const ACCOUNT_SELECTION = /selecao-de-conta/;

/** True when `url` is off the app or on a sign-in route. */
export function isLoginUrl(url: string, origin: string): boolean {
  if (!url) return false;
  if (!url.startsWith(origin)) return true;
  return LOGIN_URL_HINTS.some((hint) => url.includes(hint));
}
