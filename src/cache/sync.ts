import { CARDS, STATEMENT } from "../btg/banking/selectors.js";
import { parseCardsScreen } from "../btg/banking/cards.js";
import { parseStatementScreen } from "../btg/banking/statement.js";
import { parseBalanceDetail } from "../btg/investments/balance.js";
import { parseHome } from "../btg/investments/home.js";
import { parseAllocation } from "../btg/investments/position.js";
import { parseFutureTransactions, parseInvestmentStatement } from "../btg/investments/statement.js";
import { AGGREGATOR, BALANCE_DETAIL, FUTURE, HOME, accountStatement, allocationSummary } from "../btg/paths.js";
import type { Ctx } from "../context.js";
import { AuthError, CaptchaError } from "../core/errors.js";
import type { CacheRepo, SnapshotKind } from "./repo.js";

// One sync = the investments channel (a handful of JSON replays, seconds) plus
// the banking screens (two renders, tens of seconds). Each source has ONE
// ingest function, used both live and by `--reparse`, which re-runs the
// parsers over the stored raw payloads with no network at all.

export type SyncParts = "all" | "investments" | "banking";
export type SyncOptions = { parts?: SyncParts; reparse?: boolean; periodDays?: number };
export type StepResult = { step: SnapshotKind; ok: boolean; detail?: string; error?: string };
export type SyncReport = {
  mode: "live" | "reparse";
  steps: StepResult[];
  account: string | null;
  stats: ReturnType<CacheRepo["stats"]>;
};

void AGGREGATOR; // open finance comes inside the home hub; the POST aggregator is not needed

type Ingest = (repo: CacheRepo, raw: string, now: Date) => string;

const INGEST: Record<SnapshotKind, Ingest> = {
  home: (repo, raw) => {
    const data = parseHome(JSON.parse(raw));
    repo.putSnapshot("home", data, raw);
    return `conta corrente, ${data.cards.length} cartão(ões), conta investimento`;
  },
  balance_detail: (repo, raw) => {
    repo.putSnapshot("balance_detail", parseBalanceDetail(JSON.parse(raw)), raw);
    return "detalhe do saldo da conta investimento";
  },
  allocation: (repo, raw) => {
    const data = parseAllocation(JSON.parse(raw));
    repo.putSnapshot("allocation", data, raw);
    return `${data.positions.length} posição(ões) em ${data.classes.length} classe(s)`;
  },
  investment_statement: (repo, raw) => {
    const data = parseInvestmentStatement(JSON.parse(raw));
    repo.putSnapshot("investment_statement", data, raw);
    return `${data.entries.length} movimentação(ões) na conta investimento`;
  },
  future: (repo, raw) => {
    const data = parseFutureTransactions(JSON.parse(raw));
    repo.putSnapshot("future", data, raw);
    return `${data.entries.length} lançamento(s) futuro(s)`;
  },
  cards_screen: (repo, html, now) => {
    const screen = parseCardsScreen(html, now);
    repo.putSnapshot("cards_screen", screen, html);
    repo.upsertInvoices(screen.months, screen.invoice);
    if (screen.invoice?.month) repo.replaceInvoiceLines(screen.invoice.month, screen.transactions);
    return `fatura ${screen.invoice?.month ?? "?"}: ${screen.transactions.length} lançamento(s)`;
  },
  statement_page: (repo, html, now) => {
    const screen = parseStatementScreen(html, now);
    repo.putSnapshot("statement_page", screen, html);
    const added = repo.upsertStatementEntries(screen.entries);
    return `${screen.entries.length} linha(s) do extrato (${added} nova(s)), ${screen.page?.total ?? "?"} no período`;
  },
};

/** A session or challenge problem stops the whole sync; anything else only that step. */
const fatal = (error: unknown) => error instanceof AuthError || error instanceof CaptchaError;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function step(steps: StepResult[], kind: SnapshotKind, run: () => Promise<string>): Promise<void> {
  try {
    steps.push({ step: kind, ok: true, detail: await run() });
  } catch (error) {
    if (fatal(error)) throw error;
    steps.push({ step: kind, ok: false, error: message(error) });
  }
}

export async function runSync(ctx: Ctx, opts: SyncOptions = {}): Promise<SyncReport> {
  const repo = ctx.cache();
  const steps: StepResult[] = [];

  if (opts.reparse) {
    for (const kind of Object.keys(INGEST) as SnapshotKind[]) {
      const snapshot = repo.getSnapshot<unknown>(kind);
      if (!snapshot?.raw) continue;
      const raw = snapshot.raw;
      // Yearless dates resolve against the moment of capture, not today.
      await step(steps, kind, async () => INGEST[kind](repo, raw, new Date(snapshot.capturedAt)));
    }
    return { mode: "reparse", steps, account: ctx.config.account ?? null, stats: repo.stats() };
  }

  const parts = opts.parts ?? "all";
  const client = ctx.client();
  const now = () => new Date(ctx.now());

  if (parts !== "banking") {
    const json = async (kind: SnapshotKind, path: string) =>
      step(steps, kind, async () => INGEST[kind](repo, (await client.apiGet(path)).body, now()));
    await json("home", HOME);
    await json("balance_detail", BALANCE_DETAIL);
    const account = client.account();
    if (account) await json("allocation", allocationSummary(account));
    else steps.push({ step: "allocation", ok: false, error: "conta de investimento não descoberta; defina BTG_ACCOUNT" });
    await json("investment_statement", accountStatement(opts.periodDays ?? 30));
    await json("future", FUTURE);
  }

  if (parts !== "investments") {
    await step(steps, "cards_screen", async () => {
      const page = await client.render(CARDS.route, { readySelector: CARDS.ready, settleMs: 1500 });
      return INGEST.cards_screen(repo, page.html, now());
    });
    await step(steps, "statement_page", async () => {
      const page = await client.render(STATEMENT.route, { readySelector: STATEMENT.ready, settleMs: 1000 });
      return INGEST.statement_page(repo, page.html, now());
    });
  }

  if (steps.some((s) => s.ok)) repo.setMeta("sync.last_completed_at", new Date(ctx.now()).toISOString());
  return { mode: "live", steps, account: client.account(), stats: repo.stats() };
}
