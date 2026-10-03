import { describe, expect, test } from "bun:test";
import { holderOf, invoiceStatus, statementDirection } from "../src/domain/status.js";
import { inferKind, normalizeCategory } from "../src/domain/category.js";

describe("status", () => {
  test("invoice status labels", () => {
    expect(invoiceStatus("Fatura aberta")).toBe("open");
    expect(invoiceStatus("Paga")).toBe("paid");
    expect(invoiceStatus("Futura")).toBe("future");
    expect(invoiceStatus("Fechada")).toBe("closed");
    expect(invoiceStatus("")).toBe("unknown");
    // The full invoice page's badges. "Não paga" and "parcialmente" contain "pag" too.
    expect(invoiceStatus("Pago")).toBe("paid");
    expect(invoiceStatus("Em aberto")).toBe("open");
    expect(invoiceStatus("Fatura não paga")).toBe("unpaid");
    expect(invoiceStatus("Fatura paga parcialmente")).toBe("partial");
  });
  test("holder titular vs adicional with name", () => {
    expect(holderOf("Compra no crédito")).toEqual({ holder: "titular" });
    const add = holderOf("Compra no crédito no cartão adicional de MARIA SILVA");
    expect(add.holder).toBe("adicional");
    expect(add.holderName).toBe("MARIA SILVA");
  });
  test("statement direction", () => {
    expect(statementDirection("Pix recebido")).toBe(1);
    expect(statementDirection("Pix enviado")).toBe(-1);
    expect(statementDirection("Pagamento de fatura do cartão")).toBe(-1);
  });
  test("category + kind", () => {
    expect(normalizeCategory("Transferência")).toBe("transferencia");
    expect(inferKind("Pix enviado via assistente")).toBe("pix");
    expect(inferKind("Pagamento de fatura do cartão")).toBe("fatura");
  });
});
