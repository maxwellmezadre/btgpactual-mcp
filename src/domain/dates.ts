// Portuguese date labels seen across the BTG screens. The clock is injected so
// the "no year = most recent past" rule is testable; ISO strings keep results
// machine-independent.

export const MONTHS = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const LONG_DATE = /(\d{1,2})[º°]?\s+de\s+([a-zç]+)(?:\s+de\s+(\d{4}))?/;
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Finds a date inside a label, in any of the forms BTG uses: ISO
 * (`2024-12-22`), numeric (`22/12/2024`, `22/12`) or long pt-BR (`22 de
 * dezembro de 2024`, `22 de dezembro`). Without a year, assumes the most
 * recent past one.
 */
export function parsePtBrDate(label: string | null | undefined, now: Date): string | undefined {
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

  const numeric = NUMERIC_DATE.exec(text);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    let year = numeric[3] ? Number(numeric[3]) : todayY;
    if (numeric[3] && year < 100) year += 2000;
    if (!numeric[3] && (month > todayM || (month === todayM && day > todayD))) year -= 1;
    return iso(year, month, day);
  }

  const long = LONG_DATE.exec(text);
  if (!long) return undefined;
  const day = Number(long[1]);
  const month = MONTHS.indexOf(long[2] as string) + 1;
  if (month === 0 || day < 1 || day > 31) return undefined;
  let year = long[3] ? Number(long[3]) : todayY;
  if (!long[3] && (month > todayM || (month === todayM && day > todayD))) year -= 1;
  return iso(year, month, day);
}

/** `YYYY-MM` key for grouping by invoice/statement month. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}
