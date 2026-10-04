import { describe, expect, test } from "bun:test";
import { priceForeignLines } from "../src/cache/history.js";
import { clickOrder, runSync } from "../src/cache/sync.js";
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
      ["cards_month:2026-09", true],
      ["cards_month:2026-10", true],
      ["cards_month:2026-11", true],
      ["cards_month:2027-01", true],
      ["invoice_full", true],
      ["invoice_months", true],
      ["invoice_full:2026-11", true],
      ["invoice_full:2026-09", true],
      ["statement_page", true],
    ]);
    expect(calls.render).toEqual([
      "/cartoes",
      "/cartoes",
      "/cartoes/fatura-completa/1001",
      "/cartoes/fatura-completa/999",
      "/conta-corrente",
    ]);
    // The closed month (Out) is never clicked first: its list is already on screen.
    expect(calls.interact).toEqual([
      "a fatura de Set",
      "a fatura de Out",
      "a fatura de Nov",
      "a fatura de Jan/2027",
      "a fatura completa",
      "o seletor de faturas",
      "a busca de faturas de 2026",
      "a busca de faturas de 2025",
    ]);
    expect(report.stats).toMatchObject({ invoices: 4, invoicesWithLines: 1, invoiceLines: 7, statementEntries: 4 });
    expect(ctx.cache().getSnapshot("allocation")?.data).toMatchObject({ totalCents: 350050 });
    expect(ctx.cache().getMeta("sync.last_completed_at")).toBe("2026-10-02T12:00:00.000Z");
    // The full page dates every invoice and says what was paid.
    expect(ctx.cache().listInvoices().find((i) => i.month === "2026-10")).toMatchObject({
      due_date: "2026-10-07",
      closing_date: "2026-10-03",
      total_cents: 25000,
      paid_cents: null,
      statement_id: "1000",
    });
    expect(ctx.cache().listInvoices().find((i) => i.month === "2026-09")).toMatchObject({ paid_cents: 123456, statement_id: "999" });
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

  test("a click that lands on another month is refused, never filed under the wrong invoice", async () => {
    const { ctx } = wire({}, { wrongMonth: { Nov: "Set" } });
    const report = await runSync(ctx);
    const nov = report.steps.find((s) => s.step === "cards_month:2026-11");
    expect(nov).toMatchObject({ ok: false });
    expect(nov?.error).toContain("em vez de 2026-11");
    expect(ctx.cache().listInvoiceLines({ month: "2026-11" }).total).toBe(0);
  });

  test("the statement is paged to the end", async () => {
    const { ctx, calls } = wire({}, { statementPages: 2 });
    const report = await runSync(ctx);
    expect(calls.interact.filter((l) => l.includes("próxima página"))).toHaveLength(1);
    expect(report.steps.find((s) => s.step === "statement_page")?.detail).toContain("em 2 página(s)");
    expect(report.stats.statementEntries).toBe(8);
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
    calls.interact.length = 0;
    const report = await runSync(ctx, { reparse: true });
    expect(report.mode).toBe("reparse");
    expect(report.steps.every((s) => s.ok)).toBe(true);
    expect(report.steps.map((s) => s.step)).toContain("cards_month:2026-10");
    expect(calls).toEqual({ api: [], render: [], interact: [] });
    expect(report.stats).toMatchObject({ invoiceLines: 7, statementEntries: 4 });
  });
});

describe("invoice history (full invoice page)", () => {
  test("months off the chart get their lines from the full page; chart months only dates and amounts", async () => {
    const { ctx } = wire({}, { firstMonth: "2026-07" });
    const report = await runSync(ctx);
    const history = report.steps.filter((s) => s.step.startsWith("invoice_full:")).map((s) => [s.step, s.ok]);
    expect(history).toEqual([
      ["invoice_full:2026-11", true],
      ["invoice_full:2026-09", true],
      ["invoice_full:2026-08", true],
      ["invoice_full:2026-07", true],
    ]);
    const repo = ctx.cache();
    expect(repo.getMeta("cards.first_invoice_month")).toBe("2026-07");
    const august = repo.listInvoiceLines({ month: "2026-08" }).rows;
    expect(august).toHaveLength(6);
    expect(new Set(august.map((l) => l.holder))).toEqual(new Set(["desconhecido"]));
    expect(repo.listInvoices().find((i) => i.month === "2026-08")).toMatchObject({
      status: "paid",
      due_date: "2026-08-07",
      total_cents: 123456,
      paid_cents: 123456,
    });
    // The chart's months keep the timeline's lines (they say titular or adicional).
    expect(repo.listInvoiceLines({ month: "2026-10" }).rows.some((l) => l.holder === "adicional")).toBe(true);
    expect(repo.listInvoiceLines({ month: "2026-10" }).total).toBe(7);
    // Purchases from the history count as spending, under an unknown holder.
    expect(repo.spending("holder", {}).find((r) => r.key === "desconhecido")).toMatchObject({ count: 6 });
  });

  test("the next sync re-reads only what can still change: the closed and the open invoice", async () => {
    const { ctx, calls } = wire({}, { firstMonth: "2026-07" });
    await runSync(ctx);
    calls.render.length = 0;
    calls.interact.length = 0;
    const report = await runSync(ctx);
    expect(report.steps.filter((s) => s.step.startsWith("invoice_")).map((s) => s.step)).toEqual([
      "invoice_full",
      "invoice_full:2026-11",
    ]);
    expect(calls.interact).not.toContain("o seletor de faturas");
    expect(calls.render.filter((p) => p.includes("fatura-completa"))).toEqual(["/cartoes/fatura-completa/1001"]);
  });

  test("an id that shows another month stops the walk: nothing filed, nothing else tried", async () => {
    const { ctx, calls } = wire({}, { firstMonth: "2026-07", fullIdShift: 5 });
    const report = await runSync(ctx);
    const nov = report.steps.find((s) => s.step === "invoice_full:2026-11");
    expect(nov).toMatchObject({ ok: false });
    expect(nov?.error).toContain("em vez de 2026-11");
    expect(calls.render.filter((p) => p.includes("fatura-completa"))).toEqual(["/cartoes/fatura-completa/1001"]);
    expect(ctx.cache().listInvoiceLines({ month: "2026-08" }).total).toBe(0);
  });

  test("every page of an invoice is read", async () => {
    const { ctx, calls } = wire({}, { fullPages: 2 });
    await runSync(ctx);
    expect(calls.interact).toContain("a próxima página da fatura");
    expect(ctx.cache().getSnapshot("invoice_full:2026-10")?.data).toMatchObject({ pages: 2, lines: 12 });
  });
});

describe("international lines", () => {
  const epsilon = (ctx: ReturnType<typeof wire>["ctx"]) =>
    ctx.cache().listInvoiceLines({ month: "2026-10", query: "epsilon" }).rows[0]?.amount_cents;

  test("the timeline shows only US$: the reais come from the month's full invoice page", async () => {
    const { ctx } = wire();
    await runSync(ctx);
    expect(epsilon(ctx)).toBe(-9990);
  });

  test("a later cards phase prices them from the stored full page, before history runs", async () => {
    const { ctx } = wire();
    await runSync(ctx);
    const report = await runSync(ctx, { parts: "banking", budgetMs: 0 });
    expect(report.next).toBe("history");
    expect(epsilon(ctx)).toBe(-9990);
  });

  test("same day and merchant pair in order; no match stays unpriced", () => {
    const line = (merchant: string, amountCents: number | null) => ({
      invoiceMonth: "2026-10", position: 0, date: "2026-09-25", merchant, description: null, amountCents,
      installmentN: null, installmentTotal: null, holder: "titular" as const, holderName: null, kind: "international" as const,
    });
    const priced = priceForeignLines(
      [line("Contabo Payment", null), line("Contabo Payment", null), line("Outra Loja", null), line("Loja", -100)],
      [line("contabo payment", -12490), line("Contabo Payment", -500), line("Loja", -999)],
    );
    expect(priced.map((l) => l.amountCents)).toEqual([-12490, -500, null, -100]);
  });
});

describe("cache queries", () => {
  test("spending by holder: charges and refunds, payments excluded", async () => {
    const { ctx } = wire();
    await runSync(ctx);
    const rows = ctx.cache().spending("holder", {});
    expect(rows).toEqual([
      { key: "titular", count: 4, charges: 19990, refunds: 1000 },
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
    ctx.cache().upsertInvoices([{ month: "2026-10", status: "paid", statusLabel: "Paga", label: "Out" }], null);
    const october = ctx.cache().listInvoices().find((i) => i.month === "2026-10");
    expect(october).toMatchObject({ status: "paid", total_cents: 25000 });
  });
});

describe("chunked sync", () => {
  test("a zero budget runs one phase per call and resumes where it stopped", async () => {
    const { ctx, calls } = wire();
    const first = await runSync(ctx, { budgetMs: 0 });
    expect([first.done, first.next]).toEqual([false, "cards"]);
    expect(calls.render).toEqual([]);
    const second = await runSync(ctx, { budgetMs: 0 });
    expect([second.done, second.next]).toEqual([false, "history"]);
    expect(calls.render).toEqual(["/cartoes"]);
    const third = await runSync(ctx, { budgetMs: 0 });
    expect([third.done, third.next]).toEqual([false, "statement"]);
    const fourth = await runSync(ctx, { budgetMs: 0 });
    expect(fourth.done).toBe(true);
    expect(calls.api.filter((p) => p.endsWith("/home"))).toHaveLength(1); // investments ran once
    expect(ctx.cache().getMeta("sync.cursor")).toBeNull();
    expect(ctx.cache().getMeta("sync.last_completed_at")).not.toBeNull();
  });

  test("an expired session mid-phase resumes that phase on the next call", async () => {
    let dead = true;
    const { ctx, calls } = wire({
      render: async (path) => {
        calls.render.push(path);
        if (dead) throw new AuthError("expirou");
        return { url: path, title: "", html: HTML_BY_ROUTE[path] ?? "" };
      },
    });
    await expect(runSync(ctx)).rejects.toThrow(AuthError);
    dead = false;
    calls.api.length = 0;
    const report = await runSync(ctx);
    expect(report.done).toBe(true);
    expect(calls.api).toEqual([]); // investments were not redone
    expect(report.steps[0]?.step).toBe("cards_screen");
  });

  test("a different parts value or a stale cursor starts over", async () => {
    const { ctx } = wire();
    ctx.cache().setMeta("sync.cursor", JSON.stringify({ parts: "all", next: "statement", at: Date.UTC(2026, 9, 2, 12) - 31 * 60_000 }));
    const report = await runSync(ctx, { budgetMs: 0 });
    expect(report.steps[0]?.step).toBe("home");
    const banking = await runSync(ctx, { parts: "banking", budgetMs: 0 });
    expect(banking.steps[0]?.step).toBe("cards_screen");
  });
});

describe("click order", () => {
  const m = (month: string, label: string) => ({ month, label, status: "paid" as const, statusLabel: "Paga" });
  test("the closed month goes second, never first", () => {
    const months = [m("2026-09", "Set"), m("2026-10", "Out"), m("2026-11", "Nov")];
    expect(clickOrder(months, "2026-10").map((x) => x.label)).toEqual(["Set", "Out", "Nov"]);
    expect(clickOrder([m("2026-10", "Out"), m("2026-11", "Nov")], "2026-10").map((x) => x.label)).toEqual(["Nov", "Out"]);
  });
  test("a single month or an unknown closed month keeps the chart order", () => {
    expect(clickOrder([m("2026-10", "Out")], "2026-10").map((x) => x.label)).toEqual(["Out"]);
    expect(clickOrder([m("2026-09", "Set")], null).map((x) => x.label)).toEqual(["Set"]);
  });
});
