// Money is integer cents everywhere inside the tool; reais (a decimal) only at
// the edge of a tool result. SUM() over cents never drifts, which a bank's
// statement and invoice totals depend on.

const BRL = /-?\s*R?\$?\s*[\d.]+,\d{2}/;

/**
 * Parses a BRL string to signed integer cents. `"R$ 1.234,56" -> 123456`,
 * `"-R$ 0,96" -> -96`, `"R$ 0,00"`/`"Grátis"`/`"Isento" -> 0`. A string that
 * does not look like money -> `null` (never 0, so "unknown" never reads as
 * "free"). Leading/trailing sign and a trailing `C`/`D` marker are honoured.
 */
export function parseBrl(input: string | null | undefined): number | null {
  if (input == null) return null;
  const text = input.trim();
  if (/^(grátis|gratis|isento)$/i.test(text)) return 0;
  const match = BRL.exec(text);
  if (!match) return null;
  const digits = match[0].replace(/[^\d,]/g, "").replace(",", "");
  const cents = Number(digits);
  if (!Number.isFinite(cents)) return null;
  const negative = /-/.test(match[0]) || /\bD\b|\(-\)/.test(text) || /^-/.test(text);
  return negative ? -cents : cents;
}

/** Reais (what the investments JSON gives) to integer cents. Non-finite -> null. */
export function reaisToCents(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * Accepts either a BRL string or a reais number and returns integer cents.
 * The investments channel sends numbers; the banking DOM sends strings.
 */
export function toCents(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return reaisToCents(value);
  if (typeof value === "string") return parseBrl(value);
  return null;
}

/** Integer cents back to a reais number for a tool result (123456 -> 1234.56). */
export function centsToReais(cents: number | null | undefined): number | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return cents / 100;
}
