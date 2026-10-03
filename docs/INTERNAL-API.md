# A API interna do BTG Pactual

## Por que não existe caminho oficial

O BTG não publica API para a pessoa física consultar a própria conta. O app
web (`app.btgpactual.com`) é uma SPA Angular montada com single-spa (dezenas de
micro-apps) que conversa com dois canais no mesmo domínio. Este documento
descreve o que o projeto usa, mapeado numa sessão real em outubro de 2026.

## Autenticação

- A sessão vive no `sessionStorage` da origem, em chaves embaralhadas (`_a`,
  `_s`, `_st`, `_sessionExpire`, `_i`, `syncId`...). O Chrome não persiste
  `sessionStorage` entre execuções, por isso a ferramenta guarda uma cópia e a
  restaura antes de o app carregar.
- Logo depois da senha o app passa por `/` e vai para `/selecao-de-conta`; só
  depois de **Acessar** a sessão abre a conta. Uma cópia feita antes disso
  restaura na seleção de conta e não serve.
- O canal de investimentos exige os cabeçalhos `authorization_code`,
  `sessionid`, `fingerprint`, `syncid` e um `x-correlation-id` por chamada. O
  próprio app os envia; a ferramenta os captura e reutiliza.
- O canal do banco envia só `sessionid` e um cabeçalho `data` cifrado, e
  responde `{ "payload": "<cifrado>" }`. A criptografia mora no código do app.
- O app chama URLs **relativas** (`investments/api/...`).

## Endpoints

Canal de investimentos (JSON, GET salvo indicação):

| Endpoint | Conteúdo |
| --- | --- |
| `statement-position/home` | Hub: conta corrente, cartões (limites e fatura), conta investimento, Open Finance |
| `statement-position/summary/balance` | Bloco `statementAccount` da conta investimento |
| `statement-position/balance/detail` | Disponível, bloqueado, bloqueio judicial, margem de garantia |
| `statement-position/allocation/{conta}/type/MARKET/summary` | Carteira por classe e produto |
| `account-statement/period/{dias}/history/grouped` | Extrato da conta investimento |
| `statement-position/v2/future-transactions?period=dia` | Lançamentos futuros |
| `statement-position/investment-agregator/summary/local/All` | Agregador (POST; o hub já traz o resumo) |

`{conta}` aparece em várias rotas (alocação, assessor, destaques, carteira
recomendada) e é de onde a ferramenta descobre o número.

Canal do banco (cifrado, lido pelas telas):

| Tela | Chamadas que dispara |
| --- | --- |
| `/cartoes` | `cards/v2/list`, `cards/v1/invoices`, `cards/v1/invoices/chart`, `cards/v1/card-transactions?type=CREDIT` |
| `/cartoes/fatura-completa/{id}` | `cards/v2/invoices/invoicesReducedList`, `cards/v3/invoices/{id}/details?page=0&size=100` |
| `/conta-corrente` | `statement/v1`, `home/v1/account-balance` |

Estrutura das telas (classes BEM do design system, estáveis entre deploys):

- `/cartoes`: card da fatura (`.card-bill__subtitle` "Fatura de outubro",
  `.orq-badge__text` status, `.card-bill__bill p` valor); gráfico de meses
  (`.highcharts-xaxis-labels`: mês e status); "Gastos por cartão"
  (`btg-card-list-invoice`: titular e adicionais); lançamentos
  (`app-timeline-card .timeline-container`, cabeçalho de dia `.timeline-date`
  com `h2`/`h4`, linhas `.timeline-item__title`, `__subtitle`, `__value`).
- `/cartoes/fatura-completa/{id}` (`btg-invoice-details`): título
  `.invoice-details__title` ("Fatura de Outubro 2026", sempre com ano), status
  no `.orq-badge__text`; `.invoice-details__item` com rótulo/valor
  (`.invoice-details__label`/`__value`): "Data do vencimento", "Data do
  fechamento" (sem ano) e, numa `.invoice-details__amount-column` cada, "Valor
  da fatura" e "Valor pago". Tabela: cada linha (data `dd/mm/aaaa`,
  descrição, modo de compra, valor com sinal) é seguida de uma linha oculta
  com `btg-invoice-transaction-detail` (nome no app, tipo de cartão, modo de
  compra, "Número de parcelas" `N/T`). 100 linhas por página; próximo em
  `[data-testid=pagination-next-button]` (`--disabled` na última). Não diz se
  a linha é do titular ou do adicional.
- `/conta-corrente`: `btg-extract table.extract__table`; linha de cabeçalho
  com `.extract__date-info__date__value` ("Sex 03/out") e o "Saldo do dia";
  linhas `tr.extract__row`; agendamentos num accordion
  (`tr.extract__future_row__detail`); paginação `.extract__pagination` ("1 -
  10 de N itens").

## Navegação dentro das telas

- Fatura de outro mês: clicar na coluna do gráfico. O Highcharts decide o
  clique pela posição do ponteiro, então só um clique real de mouse funciona
  (clicar no rótulo ou disparar `click()` por JavaScript não faz nada). A
  coluna selecionada fica com o preenchimento `...-60`. O card do topo nunca
  muda: é sempre a fatura fechada.
- No carregamento, o gráfico destaca a fatura **aberta** enquanto a lista
  mostra a **fechada**. Por isso o destaque só vale depois de um clique, e a
  primeira coluna clicada nunca é a da fatura fechada.
- Fatura completa: o link "Conferir fatura completa" de `/cartoes` abre a
  fatura fechada e dá o id na url. O seletor "Fatura" (`orq-select`) lista
  todas as faturas do cartão, das futuras à primeira, mas só desenha as que
  cabem na tela; a busca ("Buscar fatura") por ano mostra o ano inteiro e
  "Nenhuma fatura encontrada" (`[data-testid=empty]`) quando não há. Os ids
  são consecutivos por mês (visto de 2026-01 a 2027-08); a ferramenta só
  tenta meses que o seletor lista e confere o mês no título de cada página.
- Extrato: o "próximo" é o último item de `.orq-pagination__list` (com
  `icon-chevron-right`), que ganha `--disabled` na última página.

## Armadilhas confirmadas

- O título "Lançamentos na fatura" aparece antes das linhas; enquanto carrega,
  a tela mostra `orq-shimmer`. Pronto = linhas presentes.
- Grupos de lançamentos sem cabeçalho de dia continuam o dia anterior.
- A parcela vem no fim do título do estabelecimento: `LOJA (3/10)`.
- Datas sem ano: no extrato e nas compras, a ocorrência passada mais recente;
  nos agendamentos, a mais próxima de hoje. O `h2` traz o ano quando não é o
  ano corrente.
- `lastFourDigitis` (com essa grafia) costuma vir `null`.
- O `yield` da renda fixa não é retorno; o `puclosing` da cripto é o
  fechamento anterior; o `applicationValue` da renda fixa é o valor atual.
- O valor total do gráfico de faturas fica no SVG, fora do HTML extraído.
- O card da timeline guarda um `orq-shimmer` permanente; o sinal de lista
  carregando é `.timeline-shimmer-list`.
- O app tenta abrir websockets em portas locais (sondagem antifraude); os
  erros no console são esperados.
