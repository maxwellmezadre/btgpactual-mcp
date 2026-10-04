import { MONTH_ANNOTATE, PAGER_NEXT_DONE, PAGER_NEXT_LOCATE, monthDoneScript, monthLocateScript } from "../btg/banking/actions.js";
import { parseCardsScreen } from "../btg/banking/cards.js";
import { CARDS, STATEMENT } from "../btg/banking/selectors.js";
import { parseStatementScreen } from "../btg/banking/statement.js";
import { parseBalanceDetail } from "../btg/investments/balance.js";
import { parseHome } from "../btg/investments/home.js";
import { parseAllocation } from "../btg/investments/position.js";
import { parseFutureTransactions, parseInvestmentStatement } from "../btg/investments/statement.js";
import { BALANCE_DETAIL, FUTURE, HOME, accountStatement, allocationSummary } from "../btg/paths.js";
import type { Ctx } from "../context.js";
import { AuthError, CaptchaError, ParseError } from "../core/errors.js";
import type { InvoiceMonth } from "../domain/types.js";
import { priceForeignLines, reparseFullInvoices, runHistoryPhase, storedFullLines } from "./history.js";
import type { BaseSnapshotKind, CacheRepo, SnapshotKind } from "./repo.js";

// One sync = the investments channel (a handful of JSON replays, seconds) plus
// the banking screens: the cards screen clicked month by month (every invoice
// visible on its chart), the full invoice page for every older month still
// missing (history.ts) and the statement paged to the end. Each source has ONE
// ingest function, used both live and by `--reparse`, which re-runs the parsers
// over the stored raw payloads with no network at all.

export type SyncParts = "all" | "investments" | "banking";
export type SyncOptions = {
  parts?: SyncParts;
  reparse?: boolean;
  periodDays?: number;
  /**
   * Stop at a phase boundary once this much time went by, and say `done:
   * false`; the next call resumes. Keeps each MCP call short. Default: no limit.
   */
  budgetMs?: number;
};
export type StepResult = { step: string; ok: boolean; detail?: string; error?: string };
export type SyncReport = {
  mode: "live" | "reparse";
  /** False while phases remain: call `sync` again (same `parts`) to continue. */
  done: boolean;
  /** The phase the next call will run. */
  next?: Phase;
  steps: StepResult[];
  account: string | null;
  stats: ReturnType<CacheRepo["stats"]>;
};

/** The units a sync is split into; each runs to the end once started. */
export type Phase = "investments" | "cards" | "history" | "statement";
const PHASES: Record<SyncParts, Phase[]> = {
  all: ["investments", "cards", "history", "statement"],
  investments: ["investments"],
  banking: ["cards", "history", "statement"],
};
/** A half-finished sync older than this starts over instead of resuming. */
export const CURSOR_TTL_MS = 30 * 60_000;
type Cursor = { parts: SyncParts; next: Phase; at: number };

/** 30 pages x 10 rows: far beyond the default statement period. */
export const MAX_STATEMENT_PAGES = 30;

type Ingest = (repo: CacheRepo, raw: string, now: Date) => string;

const JSON_INGEST: Record<Exclude<BaseSnapshotKind, "cards_screen" | "statement_page">, Ingest> = {
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
};

/** Default cards view: the closed invoice header and the chart's months. Lines come from the clicks. */
function ingestCardsScreen(repo: CacheRepo, html: string, now: Date): InvoiceMonth[] {
  const screen = parseCardsScreen(html, now);
  repo.putSnapshot("cards_screen", screen, html);
  repo.upsertInvoices(screen.months, screen.invoice);
  return screen.months;
}

/**
 * One invoice month, after the sync clicked it. The list is accepted only when
 * the chart confirms that exact month is selected: lines are never filed
 * under the wrong invoice.
 */
function ingestCardsMonth(repo: CacheRepo, html: string, now: Date, month: string): string {
  const screen = parseCardsScreen(html, now);
  if (!screen.timelineConfirmed || screen.timelineMonth !== month) {
    throw new ParseError(`A tela mostrou a fatura ${screen.timelineMonth ?? "?"} em vez de ${month}.`);
  }
  repo.putSnapshot(`cards_month:${month}`, screen, html);
  repo.replaceInvoiceLines(month, priceForeignLines(screen.transactions, storedFullLines(repo, month)));
  repo.replaceInvoiceHolders(month, screen.holderTotals);
  return `${screen.transactions.length} lançamento(s)`;
}

function ingestStatementPage(repo: CacheRepo, html: string, now: Date, page: number) {
  const screen = parseStatementScreen(html, now);
  repo.putSnapshot(`statement_page:${page}`, screen, html);
  if (page === 1) repo.putSnapshot("statement_page", screen, html);
  const added = repo.upsertStatementEntries(screen.entries);
  return { screen, added };
}

/** A session or challenge problem stops the whole sync; anything else only that step. */
const fatal = (error: unknown) => error instanceof AuthError || error instanceof CaptchaError;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function step(steps: StepResult[], name: string, run: () => Promise<string>): Promise<void> {
  try {
    steps.push({ step: name, ok: true, detail: await run() });
  } catch (error) {
    if (fatal(error)) throw error;
    steps.push({ step: name, ok: false, error: message(error) });
  }
}

/**
 * Click order. On load the list shows the closed invoice, so clicking it first
 * would change nothing and could not be confirmed: start with any other month,
 * then the closed one, then the rest.
 */
export function clickOrder(months: InvoiceMonth[], closedMonth: string | null): InvoiceMonth[] {
  const closed = months.find((m) => m.month === closedMonth);
  const others = months.filter((m) => m.month !== closedMonth);
  if (!closed || others.length === 0) return months;
  return [others[0] as InvoiceMonth, closed, ...others.slice(1)];
}

function reparse(repo: CacheRepo, steps: StepResult[]): void {
  const run = (name: string, fn: () => string) => {
    try {
      steps.push({ step: name, ok: true, detail: fn() });
    } catch (error) {
      steps.push({ step: name, ok: false, error: message(error) });
    }
  };
  for (const kind of Object.keys(JSON_INGEST) as Array<keyof typeof JSON_INGEST>) {
    const snap = repo.getSnapshot<unknown>(kind);
    if (snap?.raw) run(kind, () => JSON_INGEST[kind](repo, snap.raw as string, new Date(snap.capturedAt)));
  }
  // Yearless dates resolve against the moment of capture, not today.
  const cards = repo.getSnapshot<unknown>("cards_screen");
  if (cards?.raw) run("cards_screen", () => `${ingestCardsScreen(repo, cards.raw as string, new Date(cards.capturedAt)).length} mês(es)`);
  for (const kind of repo.listSnapshotKinds("cards_month:")) {
    const snap = repo.getSnapshot<unknown>(kind);
    const month = kind.slice("cards_month:".length);
    if (snap?.raw) run(kind, () => ingestCardsMonth(repo, snap.raw as string, new Date(snap.capturedAt), month));
  }
  reparseFullInvoices(repo, run);
  for (const kind of repo.listSnapshotKinds("statement_page:")) {
    const snap = repo.getSnapshot<unknown>(kind);
    const page = Number(kind.slice("statement_page:".length));
    if (snap?.raw) run(kind, () => `${ingestStatementPage(repo, snap.raw as string, new Date(snap.capturedAt), page).screen.entries.length} linha(s)`);
  }
}

export async function runSync(ctx: Ctx, opts: SyncOptions = {}): Promise<SyncReport> {
  const repo = ctx.cache();
  const steps: StepResult[] = [];

  if (opts.reparse) {
    reparse(repo, steps);
    return { mode: "reparse", done: true, steps, account: ctx.config.account ?? null, stats: repo.stats() };
  }

  const parts = opts.parts ?? "all";
  const client = ctx.client();
  const now = () => new Date(ctx.now());
  const phases = PHASES[parts];

  // Resume where an interrupted or budgeted sync of the same parts stopped.
  const saved = repo.getMeta("sync.cursor");
  const cursor = saved ? (JSON.parse(saved) as Cursor) : null;
  const resume = cursor && cursor.parts === parts && ctx.now() - cursor.at < CURSOR_TTL_MS ? cursor.next : null;
  const start = resume ? Math.max(phases.indexOf(resume), 0) : 0;

  const run: Record<Phase, () => Promise<void>> = {
    investments: async () => {
      const json = async (kind: keyof typeof JSON_INGEST, path: string) =>
        step(steps, kind, async () => JSON_INGEST[kind](repo, (await client.apiGet(path)).body, now()));
      await json("home", HOME);
      await json("balance_detail", BALANCE_DETAIL);
      const account = client.account();
      if (account) await json("allocation", allocationSummary(account));
      else steps.push({ step: "allocation", ok: false, error: "conta de investimento não descoberta; defina BTG_ACCOUNT" });
      await json("investment_statement", accountStatement(opts.periodDays ?? 30));
      await json("future", FUTURE);
    },
    cards: async () => {
      let months: InvoiceMonth[] = [];
      let closedMonth: string | null = null;
      await step(steps, "cards_screen", async () => {
        const page = await client.render(CARDS.route, { readySelector: CARDS.ready, settleMs: 1500 });
        months = ingestCardsScreen(repo, page.html, now());
        closedMonth = repo.getSnapshot<{ invoice: { month: string | null } | null }>("cards_screen")?.data.invoice?.month ?? null;
        return `${months.length} fatura(s) no gráfico`;
      });
      for (const m of clickOrder(months, closedMonth)) {
        await step(steps, `cards_month:${m.month}`, async () => {
          const page = await client.interact({
            locate: monthLocateScript(m.label),
            done: monthDoneScript(m.label),
            annotate: MONTH_ANNOTATE,
            settleMs: 500,
            label: `a fatura de ${m.label}`,
          });
          return `${m.statusLabel}: ${ingestCardsMonth(repo, page.html, now(), m.month)}`;
        });
      }
    },
    history: () => runHistoryPhase(client, repo, (name, fn) => step(steps, name, fn)),
    statement: async () => {
      await step(steps, "statement_page", async () => {
        const first = await client.render(STATEMENT.route, { readySelector: STATEMENT.ready, settleMs: 1000 });
        let { screen, added } = ingestStatementPage(repo, first.html, now(), 1);
        let read = screen.entries.length;
        let page = 1;
        while (screen.page && screen.page.to < screen.page.total && page < MAX_STATEMENT_PAGES) {
          try {
            const next = await client.interact({
              locate: PAGER_NEXT_LOCATE,
              done: PAGER_NEXT_DONE,
              settleMs: 300,
              label: "a próxima página do extrato",
            });
            page += 1;
            const result = ingestStatementPage(repo, next.html, now(), page);
            screen = result.screen;
            added += result.added;
            read += screen.entries.length;
          } catch (error) {
            if (fatal(error)) throw error;
            throw new Error(`parou na página ${page + 1} (${read} linha(s) já salvas): ${message(error)}`);
          }
        }
        return `${read} linha(s) em ${page} página(s) (${added} nova(s)), ${screen.page?.total ?? "?"} no período`;
      });
    },
  };

  const began = ctx.now();
  const budget = opts.budgetMs ?? Number.POSITIVE_INFINITY;
  for (let i = start; i < phases.length; i += 1) {
    const phase = phases[i] as Phase;
    // Saved before running: an expired session mid-phase resumes right here after `login`.
    repo.setMeta("sync.cursor", JSON.stringify({ parts, next: phase, at: ctx.now() } satisfies Cursor));
    await run[phase]();
    const following = phases[i + 1];
    // Phases are atomic; stop between them once half the budget is gone.
    if (following && ctx.now() - began >= budget / 2) {
      repo.setMeta("sync.cursor", JSON.stringify({ parts, next: following, at: ctx.now() } satisfies Cursor));
      return { mode: "live", done: false, next: following, steps, account: client.account(), stats: repo.stats() };
    }
  }

  repo.setMeta("sync.cursor", null);
  if (steps.some((s) => s.ok)) repo.setMeta("sync.last_completed_at", new Date(ctx.now()).toISOString());
  return { mode: "live", done: true, steps, account: client.account(), stats: repo.stats() };
}

export type { SnapshotKind };
