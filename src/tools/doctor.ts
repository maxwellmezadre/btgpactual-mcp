import { Type } from "@sinclair/typebox";
import { parseCardsScreen } from "../btg/banking/cards.js";
import { CARDS } from "../btg/banking/selectors.js";
import { parseHome } from "../btg/investments/home.js";
import { HOME } from "../btg/paths.js";
import { PARSER_VERSION, type SnapshotKind } from "../cache/repo.js";
import { resolveChrome } from "../session/chrome.js";
import { presentMarkers } from "../session/snapshot.js";
import { defineTool } from "./define.js";

// Layer-by-layer diagnosis, in the order a request travels: config, session,
// cache, browser, then (only with deep) the investments channel and one banking
// screen. It says WHICH layer broke instead of "something failed".

type Check = { name: string; ok: boolean | null; detail?: string; hint?: string };
const KINDS: SnapshotKind[] = ["home", "balance_detail", "allocation", "investment_statement", "future", "cards_screen", "statement_page"];
const msg = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const doctor = defineTool({
  name: "doctor",
  description:
    "Diagnóstico por camada: configuração, sessão salva, cache, navegador e, com deep=true, o canal " +
    "investments (1 requisição) e uma tela do banking (1 render). Diz qual camada quebrou e o que fazer. " +
    "Sem deep não usa a rede. Use quando outra tool falhar sem motivo claro.",
  readOnly: true,
  input: Type.Object({
    deep: Type.Optional(Type.Boolean({ description: "Testa também o BTG ao vivo (1 requisição + 1 tela)" })),
  }),
  run: async (args, ctx) => {
    const checks: Check[] = [{ name: "config", ok: true, detail: ctx.config.configDir }];

    let sessionOk = false;
    try {
      const data = ctx.session.load();
      const markers = data ? presentMarkers(data) : [];
      sessionOk = markers.length > 0;
      checks.push({
        name: "session",
        ok: sessionOk,
        detail: data ? `${markers.length} marcador(es), salva há ${Math.floor((ctx.now() - data.savedAt) / 3_600_000)}h` : "nenhuma",
        ...(sessionOk ? {} : { hint: "Rode `login`." }),
      });
    } catch (error) {
      checks.push({ name: "session", ok: false, detail: msg(error), hint: "Rode `login` (a chave ou o arquivo mudou)." });
    }

    try {
      const repo = ctx.cache();
      const stats = repo.stats();
      const stale = KINDS.filter((kind) => {
        const snap = repo.getSnapshot(kind);
        return snap !== null && snap.parserVersion < PARSER_VERSION;
      });
      checks.push({
        name: "cache",
        ok: stale.length === 0,
        detail: `${stats.invoiceLines} lançamento(s) de fatura, ${stats.statementEntries} do extrato, último sync ${stats.lastSync ?? "nunca"}`,
        ...(stale.length ? { hint: `Parsers mudaram para ${stale.join(", ")}: rode \`sync\` com reparse.` } : {}),
      });
    } catch (error) {
      checks.push({ name: "cache", ok: false, detail: msg(error) });
    }

    try {
      await import("playwright-core");
      const chrome = resolveChrome(ctx.config.browserChannel, ctx.config.chromePath);
      checks.push({
        name: "browser",
        ok: chrome !== null,
        detail: chrome ?? `${ctx.config.browserChannel} não encontrado`,
        ...(chrome ? {} : { hint: "Instale o Google Chrome ou defina BTG_CHROME_PATH." }),
      });
    } catch (error) {
      checks.push({ name: "browser", ok: false, detail: `playwright-core indisponível: ${msg(error)}` });
    }

    if (!args.deep || !sessionOk) {
      const why = args.deep ? "sem sessão" : "use deep=true";
      checks.push({ name: "investments", ok: null, detail: `pulado (${why})` });
      checks.push({ name: "banking", ok: null, detail: `pulado (${why})` });
    } else {
      const client = ctx.client();
      try {
        const home = parseHome(JSON.parse((await client.apiGet(HOME)).body));
        checks.push({ name: "investments", ok: true, detail: `home ok, ${home.cards.length} cartão(ões), conta ${client.account() ? "descoberta" : "não descoberta"}` });
      } catch (error) {
        checks.push({ name: "investments", ok: false, detail: msg(error) });
      }
      try {
        const page = await client.render(CARDS.route, { readySelector: CARDS.ready, settleMs: 1500 });
        const screen = parseCardsScreen(page.html, new Date(ctx.now()));
        checks.push({
          name: "banking",
          ok: screen.transactions.length > 0,
          detail: `${screen.transactions.length} lançamento(s) na tela de cartões`,
          ...(screen.transactions.length ? {} : { hint: "A tela abriu sem lançamentos: veja docs/REDISCOVERY.md." }),
        });
      } catch (error) {
        checks.push({ name: "banking", ok: false, detail: msg(error) });
      }
    }

    return { ok: checks.every((c) => c.ok !== false), checks };
  },
});
