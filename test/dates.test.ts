import { describe, expect, test } from "bun:test";
import { monthKey, parsePtBrDate } from "../src/domain/dates.js";

const now = new Date(Date.UTC(2026, 9, 2)); // 2026-10-02

describe("dates", () => {
  test("long pt-BR date with year", () => {
    expect(parsePtBrDate("22 de dezembro de 2024", now)).toBe("2024-12-22");
  });
  test("long pt-BR date without year, past month -> this year", () => {
    expect(parsePtBrDate("3 de julho", now)).toBe("2026-07-03");
  });
  test("date without year in the future -> last year", () => {
    expect(parsePtBrDate("28 de dezembro", now)).toBe("2025-12-28");
  });
  test("numeric and ISO forms", () => {
    expect(parsePtBrDate("07/08/2026", now)).toBe("2026-08-07");
    expect(parsePtBrDate("2024-12-22", now)).toBe("2024-12-22");
    expect(parsePtBrDate("05/01", now)).toBe("2026-01-05");
  });
  test("hoje / ontem", () => {
    expect(parsePtBrDate("hoje", now)).toBe("2026-10-02");
    expect(parsePtBrDate("ontem", now)).toBe("2026-10-01");
  });
  test("garbage -> undefined", () => {
    expect(parsePtBrDate("saldo do dia", now)).toBeUndefined();
    expect(parsePtBrDate("", now)).toBeUndefined();
  });
  test("monthKey", () => {
    expect(monthKey("2026-08-07")).toBe("2026-08");
  });
});

import { monthFromName, resolveMonth } from "../src/domain/dates.js";

describe("statement and invoice month labels", () => {
  test("dd/mon short dates (statement headers)", () => {
    expect(parsePtBrDate("Qui 01/out", now)).toBe("2026-10-01");
    expect(parsePtBrDate("Seg 29/dez", now)).toBe("2025-12-29"); // future in this year -> last year
    expect(parsePtBrDate("10/jan/2025", now)).toBe("2025-01-10");
  });
  test("monthFromName", () => {
    expect(monthFromName("out")).toBe(10);
    expect(monthFromName("Março")).toBe(3);
    expect(monthFromName("MAR.")).toBe(3);
    expect(monthFromName("xyz")).toBeNull();
  });
  test("resolveMonth picks the occurrence nearest to now, explicit year wins", () => {
    expect(resolveMonth("Out", now)).toBe("2026-10");
    expect(resolveMonth("Fatura de outubro", now)).toBe("2026-10");
    expect(resolveMonth("Jan/2027", now)).toBe("2027-01");
    expect(resolveMonth("Dez", new Date(Date.UTC(2027, 0, 5)))).toBe("2026-12");
    expect(resolveMonth("Jan", new Date(Date.UTC(2026, 11, 20)))).toBe("2027-01");
    expect(resolveMonth("sem mês", now)).toBeUndefined();
  });
});

describe("year mode for dates without a year", () => {
  test("past (default) vs nearest (scheduled entries)", () => {
    expect(parsePtBrDate("13/out", now)).toBe("2025-10-13");
    expect(parsePtBrDate("13/out", now, "nearest")).toBe("2026-10-13");
    expect(parsePtBrDate("05/jan", new Date(Date.UTC(2026, 11, 20)), "nearest")).toBe("2027-01-05");
    expect(parsePtBrDate("28 de setembro", now, "nearest")).toBe("2026-09-28");
  });
});
