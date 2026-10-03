#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BALANCE_DETAIL,
  BALANCE_SUMMARY,
  FUTURE,
  HOME,
  accountStatement,
  allocationSummary,
} from "../src/btg/paths.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";

// Captures raw responses from a LIVE session so the parsers can be built and
// tested against real shapes. Dry-run by default (prints what it would hit);
// `--write` persists to task/captures/ (gitignored, pre-anonymisation). Banking
// screens are captured by passing `--render <path> --selector <css>` once their
// routes are known from the live gate. Never runs in CI: it needs a session.

type Capture = { name: string; kind: "investments" | "banking"; path: string; selector?: string };

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const write = args.has("--write");
  const flag = (name: string): string | undefined => {
    const argv = process.argv.slice(2);
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const ctx = createContext(loadConfig());
  const client = ctx.client();
  const outDir = join(process.cwd(), "task", "captures");
  if (write) mkdirSync(outDir, { recursive: true, mode: 0o700 });

  // Account must be known for the per-account endpoints; a probe to HOME warms
  // the bridge and discovers it.
  await client.apiGet(HOME).catch(() => undefined);
  const account = client.account();

  const plan: Capture[] = [
    { name: "home", kind: "investments", path: HOME },
    { name: "summary-balance", kind: "investments", path: BALANCE_SUMMARY },
    { name: "balance-detail", kind: "investments", path: BALANCE_DETAIL },
    { name: "future", kind: "investments", path: FUTURE },
    // The aggregator is a POST with a body the app builds; captured in Phase 2.
    { name: "account-statement-30", kind: "investments", path: accountStatement(30) },
  ];
  if (account) {
    plan.push({ name: "allocation-summary", kind: "investments", path: allocationSummary(account) });
  }
  const renderPath = flag("--render");
  if (renderPath) {
    plan.push({
      name: flag("--name") ?? "banking-screen",
      kind: "banking",
      path: renderPath,
      selector: flag("--selector") ?? "body",
    });
  }

  console.error(`account: ${account ?? "(não descoberta)"} | modo: ${write ? "WRITE" : "dry-run"}`);
  const index: Record<string, string> = {};
  for (const item of plan) {
    try {
      if (item.kind === "investments") {
        const res = await client.apiGet(item.path);
        console.error(`[investments] ${item.name}: HTTP ${res.status}, ${res.body.length} bytes`);
        if (write) {
          const file = `investments/${item.name}.json`;
          writeFileSync(join(outDir, file.replace("/", "-")), res.body, { mode: 0o600 });
          index[item.name] = file;
        }
      } else {
        // Rows paint seconds after the screen shell; give them time before extracting.
        const res = await client.render(item.path, { readySelector: item.selector ?? "body", settleMs: 8000 });
        console.error(`[banking] ${item.name}: ${res.html.length} bytes (${res.title})`);
        if (write) {
          const file = `banking/${item.name}.html`;
          writeFileSync(join(outDir, file.replace("/", "-")), res.html, { mode: 0o600 });
          index[item.name] = file;
        }
      }
    } catch (error) {
      console.error(`[erro] ${item.name}: ${(error as Error).message}`);
    }
  }
  if (write) writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2), { mode: 0o600 });
  ctx.dispose();
  console.error(write ? `Capturas em ${outDir}` : "Dry-run: nada gravado. Use --write para persistir.");
}

await main();
