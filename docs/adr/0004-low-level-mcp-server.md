# ADR-0004: Servidor MCP de baixo nível

Status: Aceito

## Contexto

O `McpServer` de alto nível do SDK espera esquemas Zod. Os esquemas deste
projeto já são JSON Schema válido.

## Decisão

Usar o `Server` de baixo nível com stdio e anunciar o esquema TypeBox como
está. Toda falha de tool vira `isError`, e anotações marcam o que é só
leitura.

## Consequências

Algumas linhas a mais de fiação em `src/mcp/server.ts`, e nenhuma conversão de
esquema.
