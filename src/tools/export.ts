import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Type } from "@sinclair/typebox";
import type { Allocation } from "../domain/types.js";
import { defineTool } from "./define.js";
import { brl, snapshot } from "./read.js";

// Writes ONLY inside BTG_EXPORT_DIR, with a plain file name, 0600: an export is
// a bank statement on disk.

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

type Row = Record<string, string | number | boolean | null>;

export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] as Row);
  const cell = (value: Row[string]) => {
    if (value === null) return "";
    const text = String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((h) => cell(row[h] ?? null)).join(","))].join("\n") + "\n";
}

export function exportPath(dir: string, name: string): string {
  if (!SAFE_NAME.test(name) || name.includes("..")) {
    throw new Error(`Nome de arquivo inválido: "${name}". Use só letras, números, ponto, hífen e sublinhado.`);
  }
  const root = resolve(dir);
  const path = resolve(root, name);
  if (!path.startsWith(root + sep)) throw new Error("O arquivo precisa ficar dentro de BTG_EXPORT_DIR.");
  return path;
}

export const exportData = defineTool({
  name: "export",
  description:
    "Exporta do cache para um arquivo CSV ou JSON: lançamentos das faturas do cartão, extrato da conta " +
    "corrente ou posições de investimento. Grava só dentro de BTG_EXPORT_DIR (padrão ~/Downloads/btgpactual-export), " +
    "com permissão 0600. Não usa a rede. Sem dados: rode `sync`.",
  readOnly: false,
  input: Type.Object({
    scope: Type.Union([Type.Literal("invoice_lines"), Type.Literal("statement"), Type.Literal("positions")], {
      description: "invoice_lines, statement ou positions",
    }),
    format: Type.Union([Type.Literal("csv"), Type.Literal("json")], { description: "csv ou json" }),
    filename: Type.Optional(Type.String({ description: "Nome do arquivo (sem pasta); padrão btg-<scope>-<data>.<ext>" })),
  }),
  run: (args, ctx) => {
    const repo = ctx.cache();
    let rows: Row[];
    if (args.scope === "invoice_lines") {
      rows = repo.listInvoiceLines({ limit: 1_000_000 }).rows.map((l) => ({
        invoice_month: l.invoice_month,
        date: l.date,
        merchant: l.merchant,
        description: l.description,
        amount: brl(l.amount_cents),
        installment: l.installment_n ? `${l.installment_n}/${l.installment_total}` : null,
        holder: l.holder,
        holder_name: l.holder_name,
        kind: l.kind,
      }));
    } else if (args.scope === "statement") {
      rows = repo.listStatement({ limit: 1_000_000 }).rows.map((e) => ({
        date: e.date,
        time: e.time,
        counterparty: e.counterparty,
        category: e.category,
        description: e.description,
        amount: brl(e.amount_cents),
      }));
    } else {
      rows = snapshot<Allocation>(ctx, "allocation").data.positions.map((p) => ({
        class: p.assetClass,
        kind: p.kind,
        name: p.name,
        quantity: p.quantity,
        average_price: p.averagePrice,
        market_price: p.marketPrice,
        gross_value: brl(p.grossValueCents),
        invested: brl(p.investedCents),
        gain: brl(p.gainCents),
        yield_percent: p.yieldPercent,
        maturity_date: p.maturityDate,
      }));
    }
    const stamp = new Date(ctx.now()).toISOString().slice(0, 19).replace(/[-:T]/g, "");
    const name = args.filename ?? `btg-${args.scope}-${stamp}.${args.format}`;
    const path = exportPath(ctx.config.exportDir, name);
    mkdirSync(ctx.config.exportDir, { recursive: true, mode: 0o700 });
    const body = args.format === "csv" ? toCsv(rows) : `${JSON.stringify(rows, null, 2)}\n`;
    writeFileSync(path, body, { mode: 0o600 });
    chmodSync(path, 0o600);
    return { path: join(ctx.config.exportDir, name), rows: rows.length, bytes: Buffer.byteLength(body) };
  },
});
