import type { Snapshot, SnapshotKind } from "../cache/repo.js";
import type { Ctx } from "../context.js";
import { centsToReais } from "../domain/money.js";

// Shared by the read tools: money leaves the tool as reais (a decimal), and a
// tool that needs a snapshot the cache does not have yet says how to get it.

export const brl = (cents: number | null | undefined): number | null => centsToReais(cents);

export const SYNC_HINT =
  "Nada sincronizado ainda para isto. Rode a tool `sync` (ou `btgpactual sync` no terminal); ela precisa de uma sessão ativa (`login`).";

export function snapshot<T>(ctx: Ctx, kind: SnapshotKind): Snapshot<T> {
  const found = ctx.cache().getSnapshot<T>(kind);
  if (!found) throw new Error(SYNC_HINT);
  return found;
}
