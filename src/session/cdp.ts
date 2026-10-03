// Minimal Chrome DevTools Protocol client: list targets over HTTP, talk to ONE
// page target over its own websocket. Attach login uses this instead of
// Playwright's connectOverCDP, which attaches to every target in the browser
// (and stalls on target types newer Chrome versions add, like `browser_ui`) and
// whose `close()` can take the user's browser down with it. Here, closing only
// drops our websocket; the user's Chrome and tab stay exactly as they were.

export type CdpTarget = {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

export type CdpSession = {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
};

export type ListTargets = (endpoint: string) => Promise<CdpTarget[]>;
export type OpenSession = (wsUrl: string) => Promise<CdpSession>;

const TIMEOUT_MS = 10_000;

export const listTargets: ListTargets = async (endpoint) => {
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/json/list`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} em /json/list`);
  return (await response.json()) as CdpTarget[];
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export const openSession: OpenSession = (wsUrl) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map<number, Pending>();
    let nextId = 1;

    const failAll = (error: Error) => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      pending.clear();
    };

    const openTimer = setTimeout(() => {
      ws.close();
      reject(new Error(`o websocket CDP não abriu em ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(openTimer);
      resolve({
        send: <T>(method: string, params: Record<string, unknown> = {}) =>
          new Promise<T>((res, rej) => {
            const id = nextId++;
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`${method} sem resposta em ${TIMEOUT_MS / 1000}s`));
            }, TIMEOUT_MS);
            pending.set(id, { resolve: res as (value: unknown) => void, reject: rej, timer });
            ws.send(JSON.stringify({ id, method, params }));
          }),
        close: () => ws.close(),
      });
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (message.id === undefined) return; // protocol events, not replies
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    };

    ws.onerror = () => {
      clearTimeout(openTimer);
      const error = new Error("erro no websocket CDP");
      failAll(error);
      reject(error);
    };
    ws.onclose = () => failAll(new Error("o websocket CDP fechou"));
  });

/** Evaluates an expression in the page and returns its JSON value. */
export async function evaluate<T>(session: CdpSession, expression: string): Promise<T> {
  const reply = await session.send<{
    result: { value?: T };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (reply.exceptionDetails) {
    throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
  }
  return reply.result.value as T;
}
