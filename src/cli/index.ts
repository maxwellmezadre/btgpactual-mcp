import { Command } from "commander";
import { loadConfig } from "../config.js";
import { type Ctx, createContext } from "../context.js";
import { type ToolDef, compactObject, runTool } from "../tools/define.js";
import { activeTools, allTools } from "../tools/registry.js";

// The CLI is a thin argv -> tool-args mapper. Every command goes through the
// same `runTool` the MCP server uses, and both resolve from the same registry,
// so the two surfaces cannot drift. Each command grows as its tool lands; this
// skeleton wires session diagnostics and the escape hatch.

function resolveTool(readOnly: boolean, name: string): ToolDef {
  const tool = activeTools({ readOnly }).find((candidate) => candidate.name === name);
  if (tool) return tool;
  const exists = allTools.some((candidate) => candidate.name === name);
  throw new Error(
    exists ? `Comando indisponível em modo somente leitura: ${name}` : `Tool não encontrada: ${name}`,
  );
}

const value = (input: unknown): string =>
  input === null || input === undefined
    ? ""
    : typeof input === "object"
      ? JSON.stringify(input)
      : String(input);

export function formatHuman(result: unknown): string {
  if (result === null || typeof result !== "object") return String(result);
  if (Array.isArray(result)) return result.map(value).join("\n");
  return Object.entries(result)
    .map(([key, item]) => `${key}: ${value(item)}`)
    .join("\n");
}

async function withContext<T>(fn: (ctx: Ctx) => Promise<T> | T): Promise<T> {
  const ctx = createContext(loadConfig());
  try {
    return await fn(ctx);
  } finally {
    ctx.dispose();
  }
}

async function write(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${text}\n`, (error) => (error ? reject(error) : resolve()));
  });
}

type InvokeOptions = { json: boolean; format?: (result: unknown) => string };

async function invoke(
  toolName: string,
  args: Record<string, unknown>,
  options: InvokeOptions,
): Promise<void> {
  try {
    await withContext(async (ctx) => {
      const tool = resolveTool(ctx.config.readOnly, toolName);
      const result = await runTool(tool, compactObject(args), ctx);
      await write(
        options.json ? JSON.stringify(result, null, 2) : (options.format ?? formatHuman)(result),
      );
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

/** Fixed-width table, no dependency. Columns are [header, accessor]. */
export function printTable<T>(rows: T[], columns: Array<[string, (row: T) => unknown]>): string {
  if (rows.length === 0) return "(nenhum resultado)";
  const cell = (v: unknown) => (v === null || v === undefined ? "-" : String(v));
  const body = rows.map((row) => columns.map(([, get]) => cell(get(row))));
  const widths = columns.map(([name], i) => Math.max(name.length, ...body.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [line(columns.map(([n]) => n)), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

const pretty = (result: unknown) => JSON.stringify(result, null, 2);
type R = Record<string, any>;
const num = (v: string) => Number(v);

const tables: Record<string, (result: unknown) => string> = {
  account_statement: (r) =>
    `${printTable((r as R).entries, [["data", (e: R) => e.date], ["hora", (e: R) => e.time], ["contraparte", (e: R) => e.counterparty], ["descrição", (e: R) => e.description], ["valor", (e: R) => e.amount]])}\nentradas ${(r as R).totals.in} | saídas ${(r as R).totals.out}`,
  invoice_transactions: (r) =>
    printTable((r as R).lines, [["fatura", (l: R) => l.invoiceMonth], ["data", (l: R) => l.date], ["estabelecimento", (l: R) => l.merchant], ["parcela", (l: R) => l.installment], ["portador", (l: R) => l.holderName ?? l.holder], ["valor", (l: R) => l.amount]]),
  investments_position: (r) =>
    printTable((r as R).positions ?? (r as R).classes, [["classe", (p: R) => p.class ?? p.name], ["produto", (p: R) => p.name], ["bruto", (p: R) => p.grossValue ?? p.value], ["investido", (p: R) => p.invested], ["ganho", (p: R) => p.gain], ["%", (p: R) => p.yieldPercent ?? p.accumulatedYieldPercent]]),
  spending_summary: (r) =>
    `${printTable((r as R).groups, [["grupo", (g: R) => g.key], ["compras", (g: R) => g.purchases], ["gasto", (g: R) => g.spent], ["estornos", (g: R) => g.refunds], ["líquido", (g: R) => g.net]])}\ntotal gasto ${(r as R).totals.spent} | líquido ${(r as R).totals.net}`,
};

export async function runCli(argv: string[], version: string): Promise<void> {
  const program = new Command();
  program
    .name("btgpactual")
    .description("CLI do BTG Pactual (conta, cartões, faturas, investimentos). Somente leitura na conta.")
    .version(version)
    .option("--json", "Saída em JSON", false);
  const json = (): boolean => program.opts().json === true;
  const run = (tool: string, args: Record<string, unknown>) =>
    invoke(tool, args, { json: json(), format: tables[tool] ?? pretty });

  program.command("status").description("Estado da sessão salva (sem rede; --verify gasta 1 requisição)")
    .option("--verify", "Confirma a sessão no BTG", false)
    .action((o) => run("auth_status", { verify: o.verify }));

  program.command("login").description("Abre o Chrome no BTG, espera você logar e salva a sessão (fecha a janela no fim)")
    .option("--attach", "Não abre janela: copia a sessão de um Chrome já aberto com --remote-debugging-port", false)
    .option("--endpoint <url>", "Endpoint de depuração no modo --attach (default http://localhost:9222)")
    .option("--fresh", "Apaga o perfil da janela de login antes", false)
    .option("--timeout <s>", "Tempo máximo esperando o login, em segundos", num)
    .action((o) => run("login", { attach: o.attach, endpoint: o.endpoint, fresh: o.fresh, timeout_seconds: o.timeout }));

  program.command("doctor").description("Diagnóstico por camada (sem rede; --deep testa o BTG ao vivo)")
    .option("--deep", "Gasta 1 requisição + 1 tela", false)
    .action((o) => run("doctor", { deep: o.deep }));

  program.command("sync").description("Baixa saldos, carteira, faturas e extrato para o cache")
    .option("--parts <p>", "all | investments | banking")
    .option("--reparse", "Reprocessa o cache sem rede", false)
    .option("--period-days <n>", "Dias do extrato da conta investimento", num)
    .action((o) => run("sync", { parts: o.parts, reparse: o.reparse, period_days: o.periodDays }));

  program.command("balance").description("Saldo da conta corrente e da conta investimento")
    .action(() => run("account_balance", {}));

  program.command("statement").description("Extrato da conta corrente")
    .option("--from <d>", "YYYY-MM-DD").option("--to <d>", "YYYY-MM-DD")
    .option("--query <q>", "Busca").option("--category <c>", "Categoria exata")
    .option("--direction <d>", "in | out").option("--limit <n>", "Máximo", num).option("--offset <n>", "Pular", num)
    .action((o) => run("account_statement", { from: o.from, to: o.to, query: o.query, category: o.category, direction: o.direction, limit: o.limit, offset: o.offset }));

  program.command("cards").description("Cartões, limites e gasto por portador")
    .action(() => run("cards_list", {}));

  program.command("invoice").description("Fatura do cartão de um mês (padrão: a da tela no último sync)")
    .option("--month <m>", "YYYY-MM")
    .action((o) => run("invoice", { month: o.month }));

  program.command("transactions").description("Lançamentos das faturas (parcelas, titular x adicional)")
    .option("--month <m>", "YYYY-MM").option("--holder <h>", "titular | adicional").option("--kind <k>", "purchase | installment | international | cancelled | payment")
    .option("--installments", "Só parceladas", false).option("--query <q>", "Busca")
    .option("--from <d>", "YYYY-MM-DD").option("--to <d>", "YYYY-MM-DD").option("--limit <n>", "Máximo", num).option("--offset <n>", "Pular", num)
    .action((o) => run("invoice_transactions", { month: o.month, holder: o.holder, kind: o.kind, installments_only: o.installments || undefined, query: o.query, from: o.from, to: o.to, limit: o.limit, offset: o.offset }));

  program.command("positions").description("Carteira de investimentos por classe e produto")
    .option("--class <c>", "RV | RF | CRY ou nome").option("--no-products", "Só as classes")
    .action((o) => run("investments_position", { asset_class: o.class, include_products: o.products }));

  program.command("inv-statement").description("Extrato da conta investimento e lançamentos futuros")
    .action(() => run("investments_statement", {}));

  program.command("open-finance").description("Patrimônio em outras instituições (Open Finance)")
    .action(() => run("open_finance_summary", {}));

  program.command("spending").description("Gastos no cartão agrupados")
    .requiredOption("--by <g>", "invoice | month | merchant | holder | kind")
    .option("--month <m>", "YYYY-MM").option("--holder <h>", "titular | adicional")
    .option("--from <d>", "YYYY-MM-DD").option("--to <d>", "YYYY-MM-DD").option("--limit <n>", "Máximo de grupos", num)
    .action((o) => run("spending_summary", { group_by: o.by, month: o.month, holder: o.holder, from: o.from, to: o.to, limit: o.limit }));

  program.command("export").description("Exporta o cache para CSV ou JSON em BTG_EXPORT_DIR")
    .requiredOption("--scope <s>", "invoice_lines | statement | positions")
    .requiredOption("--format <f>", "csv | json").option("--filename <f>", "Nome do arquivo")
    .action((o) => run("export", { scope: o.scope, format: o.format, filename: o.filename }));

  program.command("raw").description("GET cru no canal investments (redescoberta)")
    .argument("<path>", "Caminho /investments/api/...").option("--max-bytes <n>", "Corta a resposta", num)
    .action((path, o) => run("raw_get", { path, max_bytes: o.maxBytes }));

  await program.parseAsync(argv);
}
