import { describe, expect, test } from "bun:test";
import { CAPTURE_SCRIPT, READ_CAPTURE_SCRIPT } from "../src/browser/capture.js";

// Runs the real in-page capture hook against a stub window/XHR, so the regression
// that mattered (relative request urls never matched) stays fixed.

type Cap = { headers: Record<string, string>; account: string | null; seen: number };

function sandbox() {
  class FakeXhr {
    open(_method: string, _url: string) {}
    setRequestHeader(_k: string, _v: string) {}
    send() {}
  }
  const win: Record<string, unknown> = {
    fetch: async () => new Response("{}"),
  };
  const location = { href: "https://app.btgpactual.com/" };
  // Parenthesised: a bare `return /*marker*/\n(...)` would hit ASI and return undefined.
  const run = (script: string) =>
    new Function("window", "XMLHttpRequest", "location", "Headers", "URL", `return (\n${script.trim().replace(/;$/, "")}\n)`)(
      win,
      FakeXhr,
      location,
      Headers,
      URL,
    );
  run(CAPTURE_SCRIPT);
  return { win, FakeXhr, read: () => run(READ_CAPTURE_SCRIPT) as Cap };
}

describe("capture hook", () => {
  test("XHR with a RELATIVE investments url records headers and account", () => {
    const { FakeXhr, read } = sandbox();
    const xhr = new FakeXhr();
    xhr.open("GET", "investments/api/statement-position/allocation/001234567/type/MARKET/summary");
    xhr.setRequestHeader("authorization_code", "tok-abcdefgh");
    xhr.setRequestHeader("sessionid", "sid-abcdefgh");
    xhr.setRequestHeader("syncId", "sync-abcdefgh");
    xhr.send();
    const cap = read();
    expect(cap.seen).toBe(1);
    expect(cap.headers.authorization_code).toBe("tok-abcdefgh");
    expect(cap.headers.sessionid).toBe("sid-abcdefgh");
    expect(cap.headers.syncid).toBe("sync-abcdefgh");
    expect(cap.account).toBe("001234567");
  });

  test("fetch with an absolute investments url is captured", async () => {
    const { win, read } = sandbox();
    await (win.fetch as (u: string, i: RequestInit) => Promise<Response>)(
      "https://app.btgpactual.com/investments/api/statement-position/home",
      { headers: { authorization_code: "tok-abcdefgh", sessionid: "sid-abcdefgh" } },
    );
    expect(read().seen).toBe(1);
    expect(read().headers.sessionid).toBe("sid-abcdefgh");
  });

  test("banking and third-party calls are ignored", () => {
    const { FakeXhr, read } = sandbox();
    const xhr = new FakeXhr();
    xhr.open("GET", "banking/api/cards/v2/list");
    xhr.setRequestHeader("sessionid", "sid-abcdefgh");
    xhr.send();
    expect(read().seen).toBe(0);
  });
});
