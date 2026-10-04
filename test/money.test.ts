import { describe, expect, test } from "bun:test";
import { centsToReais, parseBrl, reaisToCents, toCents } from "../src/domain/money.js";

describe("money", () => {
  test("parseBrl handles the shapes BTG shows", () => {
    expect(parseBrl("R$ 1.234,56")).toBe(123456);
    expect(parseBrl("-R$ 0,96")).toBe(-96);
    expect(parseBrl("R$ 0,00")).toBe(0);
    expect(parseBrl("Grátis")).toBe(0);
    expect(parseBrl("R$ 8.330,85")).toBe(833085);
  });
  test("parseBrl returns null on non-money, never 0", () => {
    expect(parseBrl("")).toBeNull();
    expect(parseBrl("em processamento")).toBeNull();
    expect(parseBrl(null)).toBeNull();
  });
  test("another currency is not reais: null, never its digits as BRL", () => {
    expect(parseBrl("- US$ 22,75")).toBeNull();
    expect(parseBrl("€ 10,00")).toBeNull();
    expect(parseBrl("USD 10,00")).toBeNull();
    expect(parseBrl("-R$ 124,90")).toBe(-12490);
  });
  test("debit markers make it negative", () => {
    expect(parseBrl("R$ 50,00 D")).toBe(-5000);
  });
  test("reais <-> cents round trip", () => {
    expect(reaisToCents(1234.56)).toBe(123456);
    expect(reaisToCents(0.1)).toBe(10);
    expect(reaisToCents(null)).toBeNull();
    expect(centsToReais(123456)).toBe(1234.56);
  });
  test("toCents accepts number or string", () => {
    expect(toCents(10.5)).toBe(1050);
    expect(toCents("R$ 10,50")).toBe(1050);
    expect(toCents(null)).toBeNull();
  });
});
