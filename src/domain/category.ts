import { stripAccents } from "./dates.js";

// A light normaliser for the statement/invoice category labels BTG shows
// ("Transferência", "Contas", "Alimentação"...). It only lowercases and strips
// accents so grouping is stable; the raw label is kept by the caller. We do not
// invent a taxonomy the bank does not expose.

export function normalizeCategory(label: string | null | undefined): string {
  const text = stripAccents(label ?? "").toLowerCase().trim();
  return text || "sem categoria";
}

/** A coarse kind inferred from a Pix/transfer/bill description, best-effort. */
export function inferKind(description: string | null | undefined): string {
  const text = stripAccents(description ?? "").toLowerCase();
  if (text.includes("pix")) return "pix";
  if (text.includes("fatura")) return "fatura";
  if (text.includes("transferencia") || text.includes("ted") || text.includes("doc")) return "transferencia";
  if (text.includes("compra")) return "compra";
  if (text.includes("saque")) return "saque";
  if (text.includes("rendiment") || text.includes("juros")) return "rendimento";
  return "outros";
}
