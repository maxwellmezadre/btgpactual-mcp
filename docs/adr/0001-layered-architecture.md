# ADR-0001: Arquitetura em camadas, pragmática

Status: Aceito

## Contexto

O projeto fala com um app web instável, guarda dados bancários e serve duas
interfaces (MCP e CLI). Sem separação, uma mudança no BTG espalha edição por
todo lado; com separação demais, um projeto pessoal vira cerimônia.

## Decisão

Camadas com dependência só para dentro: tools e superfícies, cache, domínio,
parsers do BTG, navegador e sessão. Sem container de injeção nem repositório
genérico; `createContext(loadConfig())` é a fiação inteira. Rede só no
transporte do navegador (e na porta de depuração local durante o login), e só
os parsers em `src/btg/` conhecem campos e classes do BTG.

## Consequências

Uma mudança no app quebra um arquivo, e o `doctor` diz qual. Exige disciplina:
nada de importar o SDK do MCP fora de `src/mcp/` nem o Playwright fora de
`src/browser/launch.ts`.
