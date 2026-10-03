import { describe, expect, test } from "bun:test";
import { runSync } from "../src/cache/sync.js";
import { AuthError, BankingRenderError } from "../src/core/errors.js";
import { HTML_BY_ROUTE, wireSync as wire } from "./wire.js";

describe("sync", () => {
  test("live: both channels land in the cache", async () => {
    const { ctx, calls } = wire();
    const report = await runSync(ctx);
    expect(report.steps.map((s) => [s.step, s.ok])).toEqual([
      ["home", true],
      ["balance_detail", true],
      ["allocation", true],
      ["investment_statement", true],
      ["future", true],
      ["cards_screen", true],
      ["statement_page", true],
    ]);
    expect(calls.render).toEqual(["/cartoes", "/conta-corrente"]);
    expect(report.stats).toMatchObject({ invoices: 4, invoiceLines: 7, statementEntries: 4 });
    expect(ctx.cache().getSnapshot("allocation")?.data).toMatchObject({ totalCents: 350050 });
    expect(ctx.cache().getMeta("sync.last_completed_at")).toBe("2026-10-02T12:00:00.000Z");
  });

  test("a second sync replaces invoice lines and only adds new statement rows", async () => {
    const { ctx } = wire();
    await runSync(ctx);
    const report = await runSync(ctx);
    expect(report.stats).toMatchObject({ invoiceLines: 7, statementEntries: 4 });
    expect(report.steps.find((s) => s.step === "statement_page")?.detail).toContain("(0 nova(s))");
  });

  test("parts=investments never renders a banking screen", async () => {
    const { ctx, calls } = wire();
    await runSync(ctx, { parts: "investments" });
    expect(calls.render).toEqual([]);
  });

  test("a screen that does not render fails only its step", async () => {
    const { ctx } = wire({
      render: async (path) => {
        if (path === "/conta-corrente") throw new BankingRenderError("não pintou");
        return { url: path, title: "", html: HTML_BY_ROUTE[path] ?? "" };
      },
    });
    const report = await runSync(ctx);
    expect(report.steps.find((s) => s.step === "statement_page")).toMatchObject({ ok: false });
    expect(report.steps.find((s) => s.step === "cards_screen")).toMatchObject({ ok: true });
  });

  test("an expired session stops the whole sync", async () => {
    const { ctx } = wire({
      apiGet: async () => {
        throw new AuthError("sessão expirou");
      },
    });
    await expect(runSync(ctx)).rejects.toThrow(AuthError);
  });

  test("reparse rebuilds from the stored raw payloads with zero network", async () => {
    const { ctx, calls } = wire();
    await runSync(ctx);
    calls.api.length = 0;
    calls.render.length = 0;
    const report = await runSync(ctx, { reparse: true });
    expect(report.mode).toBe("reparse");
    expect(report.steps.every((s) => s.ok)).toBe(true);
    expect(calls).toEqual({ api: [], render: [] });
    expect(report.stats).toMatchObject({ invoiceLines: 7, statementEntries: 4 });
  });
});

describe("cache queries", () => {
  test("spending by holder: charges and refunds, payments excluded", async () => {
    const { ctx } = wire();
    await runSync(ctx);
    const rows = ctx.cache().spending("holder", {});
    expect(rows).toEqual([
      { key: "titular", count: 4, charges: 30000, refunds: 1000 },
      { key: "PESSOA EXEMPLO", count: 1, charges: 10000, refunds: 0 },
    ]);
  });

  test("invoice lines: installments only, accent-free search", async () => {
    const { ctx } = wire();
    await runSync(ctx);
    const repo = ctx.cache();
    expect(repo.listInvoiceLines({ installmentsOnly: true }).rows.map((r) => r.merchant)).toEqual(["LOJA GAMA", "LOJA DELTA"]);
    expect(repo.listInvoiceLines({ query: "credito internacional" }).rows.map((r) => r.merchant)).toEqual(["LOJA EPSILON"]);
    expect(repo.listInvoiceLines({ holder: "adicional" }).total).toBe(1);
  });

  test("statement: in/out totals and direction filter", async () => {
    const { ctx } = wire();
    await runSync(ctx);
    const all = ctx.cache().listStatement({});
    expect([all.total, all.inCents, all.outCents]).toEqual([4, 30000, -9100]);
    expect(ctx.cache().listStatement({ direction: "out" }).total).toBe(3);
  });

  test("invoices keep a known total when a later sync only sees the status", async () => {
    const { ctx } = wire();
    await runSync(ctx);
    ctx.cache().upsertInvoices([{ month: "2026-10", status: "paid", statusLabel: "Paga" }], null);
    const october = ctx.cache().listInvoices().find((i) => i.month === "2026-10");
    expect(october).toMatchObject({ status: "paid", total_cents: 25000 });
  });
});
