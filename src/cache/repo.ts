import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { Where, escapeLike, inTx } from "../core/sqlite.js";
import { stripAccents } from "../domain/dates.js";
import type {
  CardsScreen,
  FullInvoicePage,
  HolderTotal,
  InvoiceMonth,
  InvoiceTransaction,
  StatementEntry,
} from "../domain/types.js";

// All SQL lives here. Rows are the storage shape (integer cents, ISO strings);
// tools turn cents into reais at their edge.

/** Bump when a parser changes what it extracts; `sync --reparse` rebuilds from raw. */
export const PARSER_VERSION = 2;

export type BaseSnapshotKind =
  | "home"
  | "balance_detail"
  | "allocation"
  | "investment_statement"
  | "future"
  | "cards_screen"
  | "statement_page";

/** Per-month invoice screens and per-page statement screens keep their own raw copy. */
export type SnapshotKind =
  | BaseSnapshotKind
  | `cards_month:${string}`
  | `statement_page:${number}`
  | `invoice_full:${string}`;

export type Snapshot<T> = { data: T; capturedAt: string; parserVersion: number; raw: string | null };

export type InvoiceRow = {
  month: string;
  status: string;
  status_label: string | null;
  total_cents: number | null;
  updated_at: string;
  due_date: string | null;
  closing_date: string | null;
  paid_cents: number | null;
  statement_id: string | null;
};

export type HolderRow = { month: string; holder: string; holder_name: string | null; total_cents: number | null };

export type LineRow = {
  line_id: string;
  invoice_month: string | null;
  position: number;
  date: string | null;
  merchant: string;
  description: string | null;
  amount_cents: number | null;
  installment_n: number | null;
  installment_total: number | null;
  holder: string;
  holder_name: string | null;
  kind: string;
};

export type EntryRow = {
  entry_id: string;
  date: string | null;
  time: string | null;
  counterparty: string | null;
  category: string | null;
  description: string | null;
  amount_cents: number | null;
};

export type LineFilter = {
  month?: string;
  holder?: "titular" | "adicional";
  kinds?: string[];
  installmentsOnly?: boolean;
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type EntryFilter = {
  from?: string;
  to?: string;
  query?: string;
  category?: string;
  direction?: "in" | "out";
  limit?: number;
  offset?: number;
};

export type SpendingGroup = "invoice" | "month" | "merchant" | "holder" | "kind";

/** Purchases, installments and international purchases are what was spent. */
export const CHARGE_KINDS = ["purchase", "installment", "international"] as const;

const normalize = (...parts: Array<string | null | undefined>): string =>
  stripAccents(parts.filter(Boolean).join(" ")).toLowerCase();

const lineId = (month: string, line: InvoiceTransaction, occurrence: number): string =>
  createHash("sha256")
    .update(JSON.stringify([month, line.date, line.merchant, line.amountCents, line.installmentN, occurrence]))
    .digest("hex")
    .slice(0, 20);

export type CacheRepo = ReturnType<typeof createCacheRepo>;

export function createCacheRepo(db: Database, now: () => number) {
  const iso = () => new Date(now()).toISOString();

  function lineWhere(filter: LineFilter): Where {
    const where = new Where()
      .maybe(filter.month, "invoice_month = ?", filter.month)
      .maybe(filter.holder, "holder = ?", filter.holder)
      .maybe(filter.from, "date >= ?", filter.from)
      .maybe(filter.to, "date <= ?", filter.to)
      .maybe(filter.query, "search LIKE ? ESCAPE '\\'", `%${escapeLike(normalize(filter.query))}%`);
    if (filter.installmentsOnly) where.add("installment_n IS NOT NULL");
    if (filter.kinds?.length) where.add(`kind IN (${filter.kinds.map(() => "?").join(",")})`, ...filter.kinds);
    return where;
  }

  return {
    putSnapshot(kind: SnapshotKind, data: unknown, raw: string | null): void {
      db.query(
        `INSERT INTO snapshots (kind, captured_at, parser_version, data, raw) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET captured_at = excluded.captured_at,
           parser_version = excluded.parser_version, data = excluded.data, raw = excluded.raw`,
      ).run(kind, iso(), PARSER_VERSION, JSON.stringify(data), raw);
    },

    /** Kinds stored under a prefix, e.g. every `cards_month:` screen. */
    listSnapshotKinds(prefix: string): SnapshotKind[] {
      return (db
        .query("SELECT kind FROM snapshots WHERE substr(kind, 1, length(?)) = ? ORDER BY kind")
        .all(prefix, prefix) as Array<{ kind: SnapshotKind }>).map((r) => r.kind);
    },

    getSnapshot<T>(kind: SnapshotKind): Snapshot<T> | null {
      const row = db
        .query("SELECT data, captured_at, parser_version, raw FROM snapshots WHERE kind = ?")
        .get(kind) as { data: string; captured_at: string; parser_version: number; raw: string | null } | null;
      return row
        ? { data: JSON.parse(row.data) as T, capturedAt: row.captured_at, parserVersion: row.parser_version, raw: row.raw }
        : null;
    },

    upsertInvoices(months: InvoiceMonth[], selected: CardsScreen["invoice"]): void {
      inTx(db, () => {
        const stamp = iso();
        const upsert = db.query(
          `INSERT INTO invoices (month, status, status_label, total_cents, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(month) DO UPDATE SET status = excluded.status, status_label = excluded.status_label,
             total_cents = COALESCE(excluded.total_cents, invoices.total_cents), updated_at = excluded.updated_at`,
        );
        for (const m of months) upsert.run(m.month, m.status, m.statusLabel, null, stamp);
        if (selected?.month) {
          upsert.run(selected.month, selected.status, selected.statusLabel, selected.totalCents, stamp);
        }
      });
    },

    /** The full invoice page's header. Its amount is authoritative for every month, not just the closed one. */
    upsertInvoiceDetails(header: FullInvoicePage & { month: string }, statementId: string): void {
      db.query(
        `INSERT INTO invoices (month, status, status_label, total_cents, updated_at, due_date, closing_date, paid_cents, statement_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(month) DO UPDATE SET status = excluded.status, status_label = excluded.status_label,
           total_cents = COALESCE(excluded.total_cents, invoices.total_cents), updated_at = excluded.updated_at,
           due_date = excluded.due_date, closing_date = excluded.closing_date, paid_cents = excluded.paid_cents,
           statement_id = excluded.statement_id`,
      ).run(
        header.month, header.status, header.statusLabel, header.totalCents, iso(), header.dueDate,
        header.closingDate, header.paidCents, statementId,
      );
    },

    /** The screen shows one invoice whole: replace that month's lines atomically. */
    replaceInvoiceLines(month: string, lines: InvoiceTransaction[]): number {
      return inTx(db, () => {
        db.query("DELETE FROM invoice_lines WHERE invoice_month = ?").run(month);
        const insert = db.query(
          `INSERT INTO invoice_lines (line_id, invoice_month, position, date, merchant, description, amount_cents,
             installment_n, installment_total, holder, holder_name, kind, search, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const stamp = iso();
        const seen = new Map<string, number>();
        for (const line of lines) {
          const key = JSON.stringify([line.date, line.merchant, line.amountCents, line.installmentN]);
          const occurrence = seen.get(key) ?? 0;
          seen.set(key, occurrence + 1);
          insert.run(
            lineId(month, line, occurrence), month, line.position, line.date, line.merchant, line.description,
            line.amountCents, line.installmentN, line.installmentTotal, line.holder, line.holderName, line.kind,
            normalize(line.merchant, line.description, line.holderName), stamp,
          );
        }
        return lines.length;
      });
    },

    /** Statement lines accumulate across syncs; returns how many were new. */
    upsertStatementEntries(entries: StatementEntry[]): number {
      return inTx(db, () => {
        const stamp = iso();
        let added = 0;
        const exists = db.query("SELECT 1 FROM statement_entries WHERE entry_id = ?");
        const upsert = db.query(
          `INSERT INTO statement_entries (entry_id, date, time, counterparty, category, description, amount_cents,
             search, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(entry_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
        );
        for (const e of entries) {
          if (!exists.get(e.id)) added += 1;
          upsert.run(
            e.id, e.date, e.time, e.counterparty, e.category, e.description, e.amountCents,
            normalize(e.counterparty, e.description, e.category), stamp, stamp,
          );
        }
        return added;
      });
    },

    replaceInvoiceHolders(month: string, holders: HolderTotal[]): void {
      inTx(db, () => {
        db.query("DELETE FROM invoice_holders WHERE month = ?").run(month);
        const insert = db.query(
          "INSERT OR REPLACE INTO invoice_holders (month, holder_key, holder, holder_name, total_cents, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        );
        const stamp = iso();
        for (const h of holders) {
          insert.run(month, h.holderName ?? h.holder, h.holder, h.holderName, h.totalCents, stamp);
        }
      });
    },

    listInvoiceHolders(month: string): HolderRow[] {
      return db
        .query("SELECT month, holder, holder_name, total_cents FROM invoice_holders WHERE month = ? ORDER BY holder DESC, holder_name")
        .all(month) as HolderRow[];
    },

    listInvoices(): InvoiceRow[] {
      return db.query("SELECT * FROM invoices ORDER BY month DESC").all() as InvoiceRow[];
    },

    listInvoiceLines(filter: LineFilter): { total: number; rows: LineRow[] } {
      const where = lineWhere(filter);
      const total = (db.query(`SELECT COUNT(*) AS n FROM invoice_lines ${where.sql()}`).get(...where.values) as { n: number }).n;
      const rows = db
        .query(
          `SELECT line_id, invoice_month, position, date, merchant, description, amount_cents, installment_n,
             installment_total, holder, holder_name, kind
           FROM invoice_lines ${where.sql()} ORDER BY date DESC, invoice_month DESC, position ASC LIMIT ? OFFSET ?`,
        )
        .all(...where.values, filter.limit ?? 50, filter.offset ?? 0) as LineRow[];
      return { total, rows };
    },

    /** Purchases counted and summed as positive cents, refunds (cancellations) apart, grouped. */
    spending(group: SpendingGroup, filter: LineFilter): Array<{ key: string; count: number; charges: number; refunds: number }> {
      const column = {
        invoice: "invoice_month",
        month: "substr(date, 1, 7)",
        merchant: "merchant",
        holder: "COALESCE(holder_name, holder)",
        kind: "kind",
      }[group];
      const where = lineWhere({ ...filter, kinds: [...CHARGE_KINDS, "cancelled"] });
      const charges = CHARGE_KINDS.map(() => "?").join(",");
      return db
        .query(
          `SELECT COALESCE(${column}, '?') AS key,
             SUM(CASE WHEN kind IN (${charges}) THEN 1 ELSE 0 END) AS count,
             -SUM(CASE WHEN kind IN (${charges}) THEN amount_cents ELSE 0 END) AS charges,
             SUM(CASE WHEN kind = 'cancelled' THEN amount_cents ELSE 0 END) AS refunds
           FROM invoice_lines ${where.sql()} GROUP BY key ORDER BY charges DESC`,
        )
        .all(...CHARGE_KINDS, ...CHARGE_KINDS, ...where.values) as Array<{ key: string; count: number; charges: number; refunds: number }>;
    },

    listStatement(filter: EntryFilter): { total: number; rows: EntryRow[]; inCents: number; outCents: number } {
      const where = new Where()
        .maybe(filter.from, "date >= ?", filter.from)
        .maybe(filter.to, "date <= ?", filter.to)
        .maybe(filter.category, "category = ?", filter.category)
        .maybe(filter.query, "search LIKE ? ESCAPE '\\'", `%${escapeLike(normalize(filter.query))}%`);
      if (filter.direction === "in") where.add("amount_cents > 0");
      if (filter.direction === "out") where.add("amount_cents < 0");
      const agg = db
        .query(
          `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS inc,
             COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents END), 0) AS outc
           FROM statement_entries ${where.sql()}`,
        )
        .get(...where.values) as { n: number; inc: number; outc: number };
      const rows = db
        .query(
          `SELECT entry_id, date, time, counterparty, category, description, amount_cents FROM statement_entries
           ${where.sql()} ORDER BY date DESC, time DESC LIMIT ? OFFSET ?`,
        )
        .all(...where.values, filter.limit ?? 50, filter.offset ?? 0) as EntryRow[];
      return { total: agg.n, rows, inCents: agg.inc, outCents: agg.outc };
    },

    stats() {
      const count = (table: string) => (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      const snapshots = db.query("SELECT kind, captured_at FROM snapshots").all() as Array<{ kind: string; captured_at: string }>;
      const monthsWithLines = (db.query("SELECT COUNT(DISTINCT invoice_month) AS n FROM invoice_lines").get() as { n: number }).n;
      return {
        invoices: count("invoices"),
        invoicesWithLines: monthsWithLines,
        invoiceLines: count("invoice_lines"),
        statementEntries: count("statement_entries"),
        snapshots: Object.fromEntries(snapshots.map((s) => [s.kind, s.captured_at])),
        lastSync: this.getMeta("sync.last_completed_at"),
      };
    },

    getMeta(key: string): string | null {
      return ((db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null)?.value) ?? null;
    },

    setMeta(key: string, value: string | null): void {
      if (value === null) db.query("DELETE FROM meta WHERE key = ?").run(key);
      else db.query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    },
  };
}
