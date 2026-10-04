# Changelog

Todas as mudanças relevantes deste projeto ficam aqui. O formato segue o
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added

- Histórico de faturas: o `sync` ganhou a fase `history`, que lê a página
  "Fatura completa" de cada mês que o gráfico do app já não mostra (desde a
  primeira fatura do cartão) e, em todas as faturas, vencimento, fechamento,
  valor e valor pago. Meses pagos já lidos não são relidos.
- `invoice` mostra `dueDate`, `closingDate`, `total` e `paid` de qualquer mês
  lido, não só da fatura fechada.

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
- Sync em fases (investimentos, faturas, extrato) com cursor no cache: a tool
  para entre fases depois de `max_seconds` (padrão 50) e devolve `done:
  false`; o CLI repete até terminar; uma sessão expirada no meio retoma da
  mesma fase depois do `login`.
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

### Fixed

- Compra internacional nos meses do gráfico de faturas entrava com o valor em
  dólar lido como real (Contabo "US$ 22,75" virava R$ 22,75 em vez de
  R$ 124,90), e somas de fatura e `spending_summary` saíam menores. A
  timeline só mostra a moeda original: `parseBrl` agora recusa outra moeda e
  o valor em reais vem da página "Fatura completa" do mês. Rode `btgpactual
  sync --reparse` para corrigir o cache sem rede.
- O navegador de leitura reaproveitava os cabeçalhos de uma sessão anterior
  depois de reiniciar: o warm-up "terminava" na hora e a primeira chamada
  dava 401 mesmo com uma sessão nova salva.
- Um navegador fechado por fora (crash, `kill`) era reutilizado e toda chamada
  falhava com "Target page, context or browser has been closed".
- Um 401 ou um redirecionamento ao login fecha o navegador de leitura, então a
  chamada seguinte relê a sessão do disco (pega um `login` feito em outro
  processo). `login` fecha o navegador de leitura antes de começar.
- Dois processos (o servidor MCP e o CLI, ou dois servidores) disputavam o
  perfil do Chrome; o segundo agora usa um perfil temporário.
- `bun run setup` troca o binário com rename atômico: sobrescrever no lugar
  matava os servidores MCP em execução no macOS.

[Unreleased]: https://github.com/maxwellmezadre/btgpactual-mcp/commits/main
