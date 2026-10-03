import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { parseHome } from "../../src/btg/investments/home.js";
import { HOME } from "../../src/btg/paths.js";
import { loadConfig } from "../../src/config.js";
import { createContext } from "../../src/context.js";

// Against the REAL account: one investments call through the real headless
// bridge. Runs only with BTG_LIVE=1 and a saved session; skips visibly
// otherwise (CI never has either). Read-only, like everything else.

const config = loadConfig();
const enabled = process.env.BTG_LIVE === "1" && existsSync(config.sessionPath);

describe.skipIf(!enabled)("live: BTG account (BTG_LIVE=1)", () => {
  test("the saved session reaches the investments hub", async () => {
    const ctx = createContext(config);
    try {
      const result = await ctx.client().apiGet(HOME);
      const home = parseHome(JSON.parse(result.body));
      expect(home.account).not.toBeNull();
      expect(ctx.client().account()).toMatch(/^\d+$/);
    } finally {
      ctx.dispose();
    }
  }, 120_000);
});
