# Arquitetura

## Fluxo de uma pergunta

```
Claude ── MCP stdio ──> mcp/server.ts ──> tools/* ──> cache/repo.ts ──> SQLite
                                              │
CLI (commander) ──> cli/index.ts ─────────────┘   (as duas superfícies usam o mesmo registry)

sync:  tools/sync.ts ──> cache/sync.ts ──> browser/client.ts (fila, ritmo, breaker)
                                              └─> browser/transport.ts (Chrome headless)
                                                    ├─ canal investments: fetch dentro da página -> JSON -> btg/investments/*
                                                    └─ canal banking: abre a tela -> HTML -> btg/banking/*

login: session/login.ts ──> session/chrome.ts (Chrome comum) ──> session/attach.ts ──> session/cdp.ts
                                                                     └─> verificação no bridge ──> session/store.ts
```

Uma pergunta comum ("qual meu saldo?") nunca sai da máquina: a tool lê o
cache. Só `sync`, `doctor --deep`, `auth_status --verify` e `raw_get` falam com
o BTG.

## Regras

1. Rede só em `src/browser/transport.ts` (pelo navegador) e em
   `src/session/cdp.ts` (porta de depuração local, durante o login).
2. Só os parsers em `src/btg/investments/` e `src/btg/banking/` conhecem nomes
   de campo e classes do BTG; seletores de tela ficam em
   `src/btg/banking/selectors.ts`.
3. SDK do MCP só em `src/mcp/`; commander só em `src/cli/`; `playwright-core`
   só em `src/browser/launch.ts`, por import dinâmico.
4. Dinheiro é centavo inteiro em todo lugar; vira reais só na saída das tools.
5. stdout pertence ao JSON-RPC; logs vão para o stderr, com valores de sessão
   apagados.
6. Toda falha de tool vira `isError`; o servidor nunca cai por uma chamada.
7. Nada escreve na conta. O login é sempre humano.
8. Parsers são funções puras sobre texto (JSON ou HTML já desenhado), testadas
   sem navegador.

## O que cada diretório faz

| Diretório | Papel |
| --- | --- |
| `src/core/` | Erros, logger com redação, SQLite |
| `src/session/` | Sessão cifrada, login, Chrome de login, cliente CDP mínimo |
| `src/browser/` | Navegador de leitura: lançamento, restauração da sessão, captura de cabeçalhos, fila |
| `src/btg/` | O que é específico do BTG: rotas, endpoints, parsers dos dois canais |
| `src/domain/` | Tipos e normalizadores (dinheiro, datas, status, categoria) |
| `src/cache/` | Esquema, consultas e sync |
| `src/tools/` | As 15 tools e o registry |
| `src/mcp/` | Servidor MCP |
| `src/cli/` | CLI |
| `scripts/` | `verify`, `gen-tools-doc`, `install`, `capture-fixtures` |

## Testes

`bun test` roda sem rede e sem sessão. O navegador é um objeto falso que
responde aos scripts pelo marcador no início de cada um; o relógio é falso; o
SQLite é em memória. As fixtures são sintéticas (estrutura real, dados
inventados). `test/local/` roda sobre capturas reais em `task/captures/`
quando existem, e pula no CI. `bun run verify` acrescenta o servidor MCP real
por stdio e confere as promessas do projeto.
