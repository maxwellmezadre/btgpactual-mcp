# Changelog

Todas as mudanças relevantes deste projeto ficam aqui. O formato segue o
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added

- `login`: abre uma janela comum do Google Chrome no app do BTG, espera o
  login humano (senha, reCAPTCHA, verificação em duas etapas, escolha da
  conta), testa a sessão no navegador de leitura, grava cifrada e fecha a
  janela. `--attach` copia de um Chrome já aberto com porta de depuração.
- Sessão cifrada em repouso (AES-256-GCM) com `sessionStorage`,
  `localStorage`, cookies e user agent, restaurada no navegador de leitura
  antes de o app carregar.
- Navegador de leitura (Chrome headless) para os dois canais do app: JSON do
  canal de investimentos com os cabeçalhos de sessão do próprio app, e telas
  do banco (`/cartoes`, `/conta-corrente`) lidas já renderizadas.
- Parsers do canal de investimentos: hub da home (conta corrente, cartões,
  conta investimento, Open Finance), saldo detalhado, carteira por classe e
  produto, extrato da conta investimento e lançamentos futuros.
- Parsers das telas do banco: fatura fechada, meses e status, gasto por
  portador (titular e adicional), lançamentos com parcela e tipo; extrato da
  conta corrente com saldo do dia e agendamentos.
- Sync clica em cada mês do gráfico de faturas (paga, fechada, aberta e
  futuras) com mouse real e só aceita a lista quando o gráfico confirma o mês;
  pagina o extrato até o fim. Cliques nunca são repetidos.
- Cache SQLite com valores em centavos e as respostas brutas, e `sync
  --reparse` para reprocessar sem rede.
- 15 tools, iguais no MCP e no CLI: `auth_status`, `login`, `doctor`, `sync`,
  `account_balance`, `account_statement`, `cards_list`, `invoice`,
  `invoice_transactions`, `investments_position`, `investments_statement`,
  `open_finance_summary`, `spending_summary`, `export`, `raw_get`.
- Fila serial com intervalo, novas tentativas só para falhas transitórias e
  pausa anti-bot de 30 minutos gravada no cache.
- `BTG_READ_ONLY=1`, que remove `login`, `sync` e `export` do servidor.
- Scripts `verify`, `gen-tools-doc`, `install` e `capture-fixtures`; CI e
  release com binários e publish no npm por OIDC.

[Unreleased]: https://github.com/maxwellmezadre/btgpactual-mcp/commits/main
