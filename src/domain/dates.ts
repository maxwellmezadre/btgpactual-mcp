// Portuguese date labels seen across the BTG screens. The clock is injected so
// the "no year = most recent past" rule is testable; ISO strings keep results
// machine-independent.

export const MONTHS = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const LONG_DATE = /(\d{1,2})[º°]?\s+de\s+([a-zç]+)(?:\s+de\s+(\d{4}))?/;
/** `03/out`, `3/dez/2025`: day plus a three-letter month, as the statement shows it. */
const SHORT_MONTH_DATE = /\b(\d{1,2})\/([a-z]{3})(?:\/(\d{2,4}))?\b/;
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * How to place a date that has no year. "past" (statement lines, purchases):
 * the most recent occurrence not after today. "nearest" (scheduled entries,
 * which are in the future): the occurrence closest to today.
 */
export type YearMode = "past" | "nearest";

function pickYear(month: number, day: number, now: Date, mode: YearMode): number {
  const year = now.getUTCFullYear();
  const todayM = now.getUTCMonth() + 1;
  const todayD = now.getUTCDate();
  if (mode === "past") return month > todayM || (month === todayM && day > todayD) ? year - 1 : year;
  const today = Date.UTC(year, todayM - 1, todayD);
  return [year - 1, year, year + 1].reduce((best, candidate) =>
    Math.abs(Date.UTC(candidate, month - 1, day) - today) < Math.abs(Date.UTC(best, month - 1, day) - today)
      ? candidate
      : best,
  );
}

/**
 * Finds a date inside a label, in any of the forms BTG uses: ISO
 * (`2024-12-22`), numeric (`22/12/2024`, `22/12`), short (`03/out`) or long
 * pt-BR (`22 de dezembro de 2024`, `22 de dezembro`). A date without a year is
 * placed by `mode` (default: the most recent past one).
 */
export function parsePtBrDate(
  label: string | null | undefined,
  now: Date,
  mode: YearMode = "past",
): string | undefined {
  if (!label) return undefined;
  const text = stripAccents(label).toLowerCase().trim();
  if (!text) return undefined;

  const todayY = now.getUTCFullYear();
  const todayM = now.getUTCMonth() + 1;
  const todayD = now.getUTCDate();

  if (/\bhoje\b/.test(text)) return iso(todayY, todayM, todayD);
  if (/\bontem\b/.test(text)) {
    const d = new Date(Date.UTC(todayY, todayM - 1, todayD - 1));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const isoMatch = ISO_DATE.exec(text);
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));

  const short = SHORT_MONTH_DATE.exec(text);
  if (short) {
    const day = Number(short[1]);
    const month = monthFromName(short[2] as string);
    if (month === null || day < 1 || day > 31) return undefined;
    let year = short[3] ? Number(short[3]) : pickYear(month, day, now, mode);
    if (short[3] && year < 100) year += 2000;
    return iso(year, month, day);
  }

  const numeric = NUMERIC_DATE.exec(text);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    let year = numeric[3] ? Number(numeric[3]) : pickYear(month, day, now, mode);
    if (numeric[3] && year < 100) year += 2000;
    return iso(year, month, day);
  }

  const long = LONG_DATE.exec(text);
  if (!long) return undefined;
  const day = Number(long[1]);
  const month = MONTHS.indexOf(long[2] as string) + 1;
  if (month === 0 || day < 1 || day > 31) return undefined;
  const year = long[3] ? Number(long[3]) : pickYear(month, day, now, mode);
  return iso(year, month, day);
}

/** "out", "Outubro", "OUT." -> 10; anything else -> null. Accents are ignored. */
export function monthFromName(name: string): number | null {
  const key = stripAccents(name).toLowerCase().replace(/[^a-z]/g, "").slice(0, 3);
  const index = MONTHS.findIndex((month) => month.startsWith(key));
  return key.length === 3 && index >= 0 ? index + 1 : null;
}

/**
 * A month label without a year ("Out", "Fatura de outubro") points at the
 * occurrence nearest to today: invoices sit a few months either side of now,
 * so December seen in January is last year's and January seen in December is
 * next year's. An explicit year ("Jan/2027") always wins.
 */
export function resolveMonth(label: string, now: Date): string | undefined {
  const text = stripAccents(label).toLowerCase();
  const match = /([a-z]{3,})\.?(?:\s*(?:\/|de)\s*(\d{4}))?/.exec(text.replace(/^fatura de\s+/, ""));
  if (!match) return undefined;
  const month = monthFromName(match[1] as string);
  if (month === null) return undefined;
  if (match[2]) return `${match[2]}-${String(month).padStart(2, "0")}`;
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  let best = nowIndex;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const year of [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    const index = year * 12 + (month - 1);
    const distance = Math.abs(index - nowIndex);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return `${Math.floor(best / 12)}-${String((best % 12) + 1).padStart(2, "0")}`;
}

/** `YYYY-MM` key for grouping by invoice/statement month. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}
