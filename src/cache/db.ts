import type { Database } from "bun:sqlite";
import { openDatabase } from "../core/sqlite.js";

// Local cache. A bank session lasts minutes to hours, so every question the
// cache can answer ("quanto gastei em setembro", "o que foi parcelado") must
// not need a live login. Rules the schema enforces:
//   - money is INTEGER CENTS, so SUM() is exact;
//   - every source keeps its raw payload (JSON or rendered HTML), so a fixed
//     parser re-runs over it with zero network (`sync --reparse`).

export const SCHEMA_VERSION = 2;

/** Ordered and append-only: a released migration is never edited. */
export const MIGRATIONS: string[] = [
  `
  -- Latest parsed state of each source (home hub, portfolio, cards screen...).
  CREATE TABLE IF NOT EXISTS snapshots (
    kind            TEXT PRIMARY KEY,
    captured_at     TEXT NOT NULL,
    parser_version  INTEGER NOT NULL,
    data            TEXT NOT NULL,
    raw             TEXT
  );

  -- Invoices by month: status from the invoice timeline, total when shown.
  CREATE TABLE IF NOT EXISTS invoices (
    month         TEXT PRIMARY KEY,
    status        TEXT NOT NULL,
    status_label  TEXT,
    total_cents   INTEGER,
    updated_at    TEXT NOT NULL
  );

  -- Lines of an invoice. The screen shows a whole invoice at once, so a sync
  -- replaces that month's lines instead of merging.
  CREATE TABLE IF NOT EXISTS invoice_lines (
    line_id            TEXT PRIMARY KEY,
    invoice_month      TEXT,
    position           INTEGER NOT NULL,
    date               TEXT,
    merchant           TEXT NOT NULL,
    description        TEXT,
    amount_cents       INTEGER,
    installment_n      INTEGER,
    installment_total  INTEGER,
    holder             TEXT NOT NULL,
    holder_name        TEXT,
    kind               TEXT NOT NULL,
    search             TEXT NOT NULL,
    synced_at          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS invoice_lines_month ON invoice_lines(invoice_month);
  CREATE INDEX IF NOT EXISTS invoice_lines_date ON invoice_lines(date);

  -- Checking account statement. Accumulates across syncs (the screen pages).
  CREATE TABLE IF NOT EXISTS statement_entries (
    entry_id      TEXT PRIMARY KEY,
    date          TEXT,
    time          TEXT,
    counterparty  TEXT,
    category      TEXT,
    description   TEXT,
    amount_cents  INTEGER,
    search        TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS statement_entries_date ON statement_entries(date);
  `,
  `
  -- "Gastos por cartão" of each invoice month, as BTG shows it. holder_key is
  -- the holder name (or 'titular'): a NULL in a SQLite primary key would not
  -- stop duplicates.
  CREATE TABLE IF NOT EXISTS invoice_holders (
    month        TEXT NOT NULL,
    holder_key   TEXT NOT NULL,
    holder       TEXT NOT NULL,
    holder_name  TEXT,
    total_cents  INTEGER,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (month, holder_key)
  );
  `,
];

export function migrate(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | null;
  let version = row ? Number(row.value) : 0;
  while (version < MIGRATIONS.length) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[version] as string);
      version += 1;
      db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(version));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function openCache(path: string): Database {
  const db = openDatabase(path);
  migrate(db);
  return db;
}
