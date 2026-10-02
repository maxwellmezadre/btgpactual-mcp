import { stripAccents } from "./dates.js";

// Normalisation of the small vocabularies BTG uses on screen, mapped to stable
// machine tokens. The original label is always kept alongside so nothing is
// lost when a new wording appears.

export type InvoiceStatus = "open" | "paid" | "future" | "closed" | "unknown";

/** "Fatura aberta" -> open, "Paga" -> paid, "Futura" -> future, "Fechada" -> closed. */
export function invoiceStatus(label: string | null | undefined): InvoiceStatus {
  const text = stripAccents(label ?? "").toLowerCase();
  if (!text) return "unknown";
  if (text.includes("abert")) return "open";
  if (text.includes("pag")) return "paid";
  if (text.includes("futur")) return "future";
  if (text.includes("fechad")) return "closed";
  return "unknown";
}

export type Holder = "titular" | "adicional";

/**
 * A card transaction line tells titular from adicional by its description
 * ("...no cartao adicional de NOME"). Returns the holder and the additional
 * cardholder's name when present. The name is captured from the original text
 * so its accents survive; the "adicional" test runs on an accent-stripped copy.
 */
export function holderOf(description: string | null | undefined): {
  holder: Holder;
  holderName?: string;
} {
  const text = description ?? "";
  if (!/adicional/i.test(stripAccents(text))) return { holder: "titular" };
  const match = /adicional de\s+(.+?)(?:[.;]|$)/i.exec(text);
  return match?.[1] ? { holder: "adicional", holderName: match[1].trim() } : { holder: "adicional" };
}

/** Sign of a statement entry from its wording (Pix enviado/pago = out, recebido = in). */
export function statementDirection(description: string | null | undefined): -1 | 1 | 0 {
  const text = stripAccents(description ?? "").toLowerCase();
  if (/recebid|credito|entrada|estorno|devolucao/.test(text)) return 1;
  if (/enviad|pago|pagamento|debito|saida|compra|saque/.test(text)) return -1;
  return 0;
}
