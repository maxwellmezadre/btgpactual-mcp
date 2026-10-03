import { createHash } from "node:crypto";
import { ParseError } from "../../core/errors.js";
import { type YearMode, parsePtBrDate } from "../../domain/dates.js";
import { parseBrl } from "../../domain/money.js";
import type { ScheduledEntry, StatementEntry, StatementScreen } from "../../domain/types.js";
import { type HTMLElement, children, hasClass, parseHtml, text } from "./dom.js";
import { STATEMENT } from "./selectors.js";

// The /conta-corrente screen, rendered: a paginated table where a header row
// ("Sex 03/out", optional "Saldo do dia") precedes that day's rows, plus an
// accordion of scheduled entries. Only the page on screen is here; the sync
// walks the pager.

const RECURRENCE = /\((\d{1,4})\/(\d{1,4})\)\s*$/;
const PAGE = /(\d+)\s*-\s*(\d+)\s*de\s*(\d+)/;

function headerDate(row: HTMLElement, now: Date, mode: YearMode = "past"): string | null {
  return parsePtBrDate(text(row.querySelector(STATEMENT.dateValue)), now, mode) ?? null;
}

function entryId(parts: Array<string | number | null>, occurrence: number): string {
  return createHash("sha256")
    .update(JSON.stringify([...parts, occurrence]))
    .digest("hex")
    .slice(0, 20);
}

function parseScheduled(row: HTMLElement, now: Date): ScheduledEntry[] {
  const out: ScheduledEntry[] = [];
  let date: string | null = null;
  for (const tr of row.querySelectorAll("tr")) {
    if (tr.querySelector(STATEMENT.dateValue) && !hasClass(tr, STATEMENT.futureDetail)) {
      // Scheduled entries are ahead of today: place a yearless date nearest, not in the past.
      date = headerDate(tr, now, "nearest");
      continue;
    }
    if (!hasClass(tr, STATEMENT.futureDetail)) continue;
    const description = text(tr.querySelector(STATEMENT.futureDescription)) ?? text(tr.querySelector(STATEMENT.category));
    const recurrence = description ? RECURRENCE.exec(description) : null;
    out.push({
      date,
      counterparty: text(tr.querySelector(STATEMENT.counterparty)),
      description,
      amountCents: parseBrl(text(tr.querySelector(STATEMENT.futureValue))),
      recurrence: recurrence ? { n: Number(recurrence[1]), total: Number(recurrence[2]) } : null,
    });
  }
  return out;
}

export function parseStatementScreen(html: string, now: Date): StatementScreen {
  const root = parseHtml(html);
  const body = root.querySelector(STATEMENT.body);
  if (!body) throw new ParseError("A tela da conta corrente não tem a tabela do extrato.");

  const entries: StatementEntry[] = [];
  const dailyBalances: StatementScreen["dailyBalances"] = [];
  let scheduled: ScheduledEntry[] = [];
  const seen = new Map<string, number>();
  let date: string | null = null;

  for (const row of children(body)) {
    if (hasClass(row, STATEMENT.futureRow)) {
      scheduled = scheduled.concat(parseScheduled(row, now));
      continue;
    }
    if (row.querySelector(`.${STATEMENT.dateHeader}`) && !hasClass(row, STATEMENT.row)) {
      date = headerDate(row, now);
      const balance = row.querySelector(STATEMENT.dailyBalance);
      if (date && balance) dailyBalances.push({ date, balanceCents: parseBrl(text(balance.querySelector("span"))) });
      continue;
    }
    if (!hasClass(row, STATEMENT.row)) continue;
    const counterparty = text(row.querySelector(STATEMENT.counterparty));
    const category = text(row.querySelector(STATEMENT.category));
    const description = text(row.querySelector(STATEMENT.description));
    const time = text(row.querySelector(STATEMENT.time));
    const amountCents = parseBrl(text(row.querySelector(STATEMENT.value)));
    const key = JSON.stringify([date, time, counterparty, amountCents, description]);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    entries.push({
      id: entryId([date, time, counterparty, amountCents, description], occurrence),
      date,
      time: time && /^\d{1,2}:\d{2}$/.test(time) ? time : null,
      counterparty,
      category,
      description,
      amountCents,
    });
  }

  const pageMatch = PAGE.exec(text(root.querySelector(STATEMENT.pagination)) ?? "");
  const warnings: string[] = [];
  const undated = entries.filter((e) => e.date === null).length;
  if (undated > 0) warnings.push(`${undated} lançamento(s) sem data reconhecida`);
  const unpriced = entries.filter((e) => e.amountCents === null).length;
  if (unpriced > 0) warnings.push(`${unpriced} lançamento(s) sem valor reconhecido`);

  return {
    entries,
    dailyBalances,
    scheduled,
    page: pageMatch ? { from: Number(pageMatch[1]), to: Number(pageMatch[2]), total: Number(pageMatch[3]) } : null,
    warnings,
  };
}
