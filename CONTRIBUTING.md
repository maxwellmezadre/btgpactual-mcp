# Contribuindo

## Ambiente

```sh
bun install
bun run verify     # tsc --noEmit + bun test + as invariantes do servidor MCP
```

`bun run verify` é o portão. Se ele passa, o PR passa.

## Convenções

- Código, comentários, testes e commits em inglês. Documentação, descrições de
  tools, help do CLI e mensagens de erro em pt-BR, porque quem lê é o usuário.
- Sem linter. O portão é o `tsc` estrito (`noUncheckedIndexedAccess`,
  `noUnused*`, `verbatimModuleSyntax`) mais os testes.
- Nenhum arquivo de lógica acima de umas 450 linhas.
- Comentários explicam o porquê. Uma simplificação deliberada diz qual é o
  teto e qual seria a saída.
- Conventional Commits, sem escopo, uma linha, até 72 caracteres.

## Regras de arquitetura

Elas mantêm o projeto consertável quando o BTG mudar (veja
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

1. Nenhuma rede fora de `src/browser/transport.ts` e, durante o login, de
   `src/session/cdp.ts`.
2. Só os parsers em `src/btg/investments/` e `src/btg/banking/` conhecem
   campos e classes do BTG; os seletores das telas ficam em
   `src/btg/banking/selectors.ts`.
3. SDK do MCP só em `src/mcp/`; commander só em `src/cli/`; `playwright-core`
   só em `src/browser/launch.ts`, por import dinâmico.
4. Dinheiro em centavo inteiro para dentro; reais só na saída da tool.
5. stdout é do JSON-RPC. Log só no stderr.
6. Falha de tool vira `isError`, nunca crash.
7. Nada de escrita na conta: nenhuma tool, nenhum caminho no `raw_get`, nenhum
   clique fora de navegação, nenhum passo do login automatizado.

## Testes

Escreva testes que teriam pego um bug de verdade: regra de dinheiro, datas,
segurança, regressão.

- Injete o navegador, o relógio e o `random`. Nada de esperar de verdade.
- As fixtures são sintéticas (ADR-0008): mesma estrutura das respostas e telas
  reais, dados inventados. Para uma nova, capture com
  `bun run scripts/capture-fixtures.ts --write` (vai para `task/captures/`,
  fora do git) e escreva a fixture à mão a partir dela. Nunca commite uma
  captura.
- Mudou um parser? Incremente `PARSER_VERSION` em `src/cache/repo.ts`.
- Mudou uma tool? `bun run docs:tools`.
- `test/local/` roda sobre as capturas reais, se existirem, e pula no CI.

## Publicando

A tag `vX.Y.Z` dispara o release: binários para Linux, macOS e Windows, e o
publish no npm por OIDC (trusted publishing, sem token).

A primeira versão de um pacote novo não sai por OIDC: o npm exige que o pacote
exista para configurar o trusted publisher e exige o trusted publisher para
publicar ([npm/cli#8544](https://github.com/npm/cli/issues/8544)). Ela é
publicada à mão (`npm publish --access public`) e o trusted publisher é
configurado depois. O workflow pula a publicação quando a versão já está no
registro.

## Dado pessoal

O repositório é público e o assunto é uma conta bancária. `test/fixtures.test.ts`
falha se aparecer CPF, CNPJ, valor de cabeçalho de sessão, o número real da
conta ou o nome real de um portador de cartão adicional. `task/` é gitignored e
guarda as capturas reais. Não tire nada de lá.
