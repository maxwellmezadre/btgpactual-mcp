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
