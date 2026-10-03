import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseStatementScreen } from "../src/btg/banking/statement.js";
import { ParseError } from "../src/core/errors.js";

const html = readFileSync(join(import.meta.dir, "fixtures/banking/conta-corrente.html"), "utf8");
const now = new Date(Date.UTC(2026, 9, 2));
const screen = parseStatementScreen(html, now);

describe("checking account statement screen", () => {
  test("rows take the date of the header above them", () => {
    expect(screen.entries.map((e) => [e.date, e.time, e.counterparty, e.category, e.description, e.amountCents])).toEqual([
      ["2026-10-01", "10:15", "LOJA OMEGA", "Compras", "Compra no débito", -2550],
      ["2026-10-01", "09:00", "PESSOA EXEMPLO", "Transferência", "Pix recebido", 30000],
      ["2026-10-01", "10:15", "LOJA OMEGA", "Compras", "Compra no débito", -2550],
      ["2026-09-30", "18:30", "PESSOA EXEMPLO", "Transferência", "Pix enviado via assistente virtual no WhatsApp", -4000],
    ]);
  });

  test("identical rows still get distinct, stable ids", () => {
    const ids = screen.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).not.toBe(ids[2]);
    expect(parseStatementScreen(html, now).entries.map((e) => e.id)).toEqual(ids);
  });

  test("daily balance from the date header", () => {
    expect(screen.dailyBalances).toEqual([{ date: "2026-10-01", balanceCents: 100000 }]);
  });

  test("scheduled entries: future date (nearest year) and recurrence", () => {
    expect(screen.scheduled).toEqual([
      { date: "2026-10-13", counterparty: "PESSOA EXEMPLO", description: "Pix agendado (4/90)", amountCents: -10000, recurrence: { n: 4, total: 90 } },
    ]);
  });

  test("scheduled rows never leak into the statement", () => {
    expect(screen.entries.some((e) => e.description?.includes("agendado"))).toBe(false);
  });

  test("pager", () => {
    expect(screen.page).toEqual({ from: 1, to: 4, total: 4 });
    expect(screen.warnings).toEqual([]);
  });

  test("no statement table is a ParseError", () => {
    expect(() => parseStatementScreen("<html><body></body></html>", now)).toThrow(ParseError);
  });
});
