import { statSync } from "node:fs";
import { beforeAll, describe, expect, test } from "bun:test";
import { runSync } from "../src/cache/sync.js";
import type { Ctx } from "../src/context.js";
import { runTool } from "../src/tools/define.js";
import { SYNC_HINT } from "../src/tools/read.js";
import { toolByName } from "../src/tools/registry.js";
import { openCache } from "../src/cache/db.js";
import { createContext } from "../src/context.js";
import { silentLogger } from "./helpers.js";
import { wireSync } from "./wire.js";

type Any = Record<string, any>;
const call = async (ctx: Ctx, name: string, args: Any = {}): Promise<Any> =>
  (await runTool(toolByName(name)!, args, ctx)) as Any;

describe("read tools before any sync", () => {
  test("say how to get data instead of returning empty", async () => {
    const { ctx } = wireSync();
    for (const name of ["account_balance", "account_statement", "cards_list", "invoice", "investments_position"]) {
      await expect(call(ctx, name)).rejects.toThrow(SYNC_HINT);
    }
  });
});

describe("read tools after a sync", () => {
  let ctx: Ctx;
  let exportDir: string;
  beforeAll(async () => {
    ({ ctx, exportDir } = wireSync());
    await runSync(ctx);
  });

  test("account_balance: reais at the edge, asOf present", async () => {
    const r = await call(ctx, "account_balance");
    expect(r.checking).toEqual({ balance: 1234.56, balanceWithOverdraft: 1234.56, overdraftLimit: 0, hasOverdraftLimit: false });
    expect(r.investmentAccount.totalInvested).toBe(3500.5);
    expect(r.asOf).toBe("2026-10-02T12:00:00.000Z");
  });

  test("account_statement: totals, coverage, scheduled, filters", async () => {
    const r = await call(ctx, "account_statement");
    expect(r.totals).toEqual({ in: 300, out: -91, count: 4 });
    expect(r.coverage).toEqual({ cachedEntries: 4, entriesInBankPeriod: 4 });
    expect(r.scheduled[0].recurrence).toBe("4/90");
    expect((await call(ctx, "account_statement", { direction: "in" })).entries.map((e: Any) => e.description)).toEqual(["Pix recebido"]);
    expect((await call(ctx, "account_statement", { query: "whatsapp" })).totals.count).toBe(1);
  });

  test("cards_list: limit and spending per holder of the open invoice", async () => {
    const r = await call(ctx, "cards_list");
    expect(r.cards[0]).toMatchObject({ limit: 10000, used: 1999.75, invoice: 1500.1 });
    expect(r.spendingByHolder).toMatchObject({ invoiceMonth: "2026-11", invoiceStatus: "open" });
    expect(r.spendingByHolder.holders).toEqual([
      { holder: "titular", name: null, total: 300 },
      { holder: "adicional", name: "PESSOA EXEMPLO", total: 100 },
    ]);
  });

  test("invoice: selected month by default, line summary", async () => {
    const r = await call(ctx, "invoice");
    expect(r).toMatchObject({ month: "2026-10", status: "closed", total: 250 });
    expect(r.lines).toEqual({ count: 7, purchases: 299.9, installments: 2, refunds: 10, paymentsReceived: 1500 });
    expect(r.knownInvoices).toHaveLength(4);
    expect(r.spendingByHolder).toEqual([
      { holder: "titular", name: null, total: 300 },
      { holder: "adicional", name: "PESSOA EXEMPLO", total: 100 },
    ]);
  });

  test("invoice: dates, amount and paid amount from the full invoice page", async () => {
    const open = await call(ctx, "invoice", { month: "2026-11" });
    expect(open).toMatchObject({ dueDate: "2026-11-07", closingDate: "2026-11-03", total: 1234.56 });
    expect(open.paid).toBeUndefined();
    expect(open.totalNote).toContain("ainda cresce");
    const paid = await call(ctx, "invoice", { month: "2026-09" });
    expect(paid).toMatchObject({ status: "paid", total: 1234.56, paid: 1234.56 });
  });

  test("invoice for a month whose amount was never read explains why", async () => {
    const r = await call(ctx, "invoice", { month: "2027-01" });
    expect(r.total).toBeNull();
    expect(r.totalNote).toContain("ainda não lido");
  });

  test("invoice_transactions: installments and holder filters", async () => {
    const inst = await call(ctx, "invoice_transactions", { installments_only: true });
    expect(inst.lines.map((l: Any) => [l.merchant, l.installment])).toEqual([
      ["LOJA GAMA", "3/10"],
      ["LOJA DELTA", "10/12"],
    ]);
    const add = await call(ctx, "invoice_transactions", { holder: "adicional" });
    expect(add.lines).toEqual([
      expect.objectContaining({ merchant: "LOJA BETA", holderName: "PESSOA EXEMPLO", amount: -100 }),
    ]);
  });

  test("investments_position: filter by class name without accents", async () => {
    const r = await call(ctx, "investments_position", { asset_class: "renda fixa" });
    expect(r.classes.map((c: Any) => c.id)).toEqual(["RF"]);
    expect(r.positions[0]).toMatchObject({ name: "CDB EXEMPLO", invested: 1400, yieldPercent: 7.1429, indexer: "110,00% CDI" });
    expect((await call(ctx, "investments_position", { include_products: false })).positions).toBeUndefined();
  });

  test("investments_statement and open_finance_summary", async () => {
    const s = await call(ctx, "investments_statement");
    expect(s.statement).toMatchObject({ previousBalance: 100, credits: 50, debits: 30, actualBalance: 120 });
    const of = await call(ctx, "open_finance_summary");
    expect(of.banking.institutions[0].accounts[0].number).toBe("***6789");
  });

  test("spending_summary by holder: payments never count", async () => {
    const r = await call(ctx, "spending_summary", { group_by: "holder" });
    expect(r.totals).toEqual({ purchases: 5, spent: 299.9, refunds: 10, net: 289.9 });
  });

  test("export writes 0600 inside the export dir and refuses escapes", async () => {
    const r = await call(ctx, "export", { scope: "invoice_lines", format: "csv", filename: "linhas.csv" });
    expect(r.rows).toBe(7);
    expect(r.path.startsWith(exportDir)).toBe(true);
    expect(statSync(r.path).mode & 0o777).toBe(0o600);
    await expect(call(ctx, "export", { scope: "statement", format: "json", filename: "../fora.json" })).rejects.toThrow(/inválido/);
  });

  test("doctor without deep spends no network and reports each layer", async () => {
    const r = await call(ctx, "doctor");
    expect(r.checks.map((c: Any) => c.name)).toEqual(["config", "session", "cache", "browser", "investments", "banking"]);
    expect(r.checks.find((c: Any) => c.name === "investments").ok).toBeNull();
    expect(r.checks.find((c: Any) => c.name === "session").ok).toBe(false);
  });
});

import { createMemorySessionStore } from "../src/session/store.js";
import { sampleSession } from "./helpers.js";

describe("auth_status without network", () => {
  test("warns when the saved session is probably expired, never shows values", async () => {
    const { ctx } = wireSync();
    const old = createContext(ctx.config, {
      session: createMemorySessionStore(sampleSession({ savedAt: Date.UTC(2026, 9, 2, 9) })),
      now: () => Date.UTC(2026, 9, 2, 12),
      db: openCache(":memory:"),
      log: silentLogger(),
    });
    const r = await call(old, "auth_status");
    expect(r.loggedIn).toBe(true);
    expect(r.ageHours).toBe(3);
    expect(r.hint).toContain("costuma expirar");
    expect(JSON.stringify(r)).not.toContain("tok-abcdefgh");
  });
});
