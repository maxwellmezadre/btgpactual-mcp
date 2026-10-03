import { reaisToCents } from "../../domain/money.js";

// Tolerant accessors for the investments JSON. The payload is untyped at the
// boundary; these turn "missing or wrong type" into null instead of NaN or a
// crash, so one renamed field degrades a value, not the whole parse.

export type Json = Record<string, unknown>;

export const obj = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

export const bool = (value: unknown): boolean => value === true;

/** Reais (as the investments channel sends them) to integer cents. */
export const cents = (value: unknown): number | null => reaisToCents(num(value));

/** `{ number, text, currency }` money objects used by the open finance block. */
export const moneyObj = (value: unknown): number | null => cents(obj(value)?.number);

/** `2026-10-02T00:00:00` -> `2026-10-02`. */
export const isoDay = (value: unknown): string | null => {
  const text = str(value);
  return text && /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
};

/** First non-null result of `pick` over the candidate keys. */
export function first<T>(source: Json, keys: string[], pick: (value: unknown) => T | null): T | null {
  for (const key of keys) {
    const value = pick(source[key]);
    if (value !== null) return value;
  }
  return null;
}
