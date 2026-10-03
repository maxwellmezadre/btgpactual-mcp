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

export async function runCli(argv: string[], version: string): Promise<void> {
  const program = new Command();
  program
    .name("btgpactual")
    .description("CLI do BTG Pactual (conta, cartões, faturas, investimentos). Somente leitura.")
    .version(version);

  program.option("--json", "Saída em JSON", false);
  const json = (): boolean => program.opts().json === true;

  program
    .command("status")
    .description("Mostra o estado da sessão do BTG")
    .option("--verify", "Confirma a sessão com 1 requisição ao canal investments", false)
    .action((opts) => invoke("auth_status", { verify: opts.verify }, { json: json() }));

  program
    .command("login")
    .description("Abre o Chrome no BTG, espera você logar e salva a sessão (fecha a janela no fim)")
    .option("--attach", "Não abre janela: copia a sessão de um Chrome já aberto com --remote-debugging-port", false)
    .option("--endpoint <url>", "Endpoint de depuração no modo --attach (default http://localhost:9222)")
    .option("--fresh", "Apaga o perfil da janela de login antes", false)
    .option("--timeout <s>", "Tempo máximo esperando o login, em segundos", (v) => Number(v))
    .action((opts) =>
      invoke(
        "login",
        { attach: opts.attach, endpoint: opts.endpoint, fresh: opts.fresh, timeout_seconds: opts.timeout },
        { json: json() },
      ),
    );

  program
    .command("raw")
    .description("GET cru em um endpoint do canal investments (redescoberta)")
    .argument("<path>", "Caminho /investments/api/...")
    .option("--max-bytes <n>", "Corta a resposta", (v) => Number(v))
    .action((path, opts) =>
      invoke("raw_get", { path, max_bytes: opts.maxBytes }, { json: json() }),
    );

  await program.parseAsync(argv);
}
