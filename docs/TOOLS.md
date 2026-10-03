# Tools

> Gerado por `bun run docs:tools` a partir de `src/tools/registry.ts`. Não edite à mão.

O servidor expõe **15 tools**. Com `BTG_READ_ONLY=1` as 3 que escrevem algo (sessão, cache, arquivo) não são registradas.

| Tool | Escreve | O que faz |
| --- | --- | --- |
| [`auth_status`](#authstatus) | — | Diz se há uma sessão do BTG salva e o que ela cobre (marcadores de sessão presentes, conta de investimento, id… |
| [`login`](#login) | sim | Salva a sessão do BTG. Abre uma janela dedicada do Google Chrome no app, espera você fazer o login (senha, "nã… |
| [`doctor`](#doctor) | — | Diagnóstico por camada: configuração, sessão salva, cache, navegador e, com deep=true, o canal investments (1 … |
| [`sync`](#sync) | sim | Baixa os dados do BTG para o cache local: saldos, carteira, extrato da conta investimento e futuros (canal inv… |
| [`account_balance`](#accountbalance) | — | Saldo da conta corrente (com e sem o limite do cheque especial) e da conta investimento (total, investido, dis… |
| [`account_statement`](#accountstatement) | — | Extrato da conta corrente (Pix, transferências, contas, compras no débito) linha a linha, com totais de entrad… |
| [`cards_list`](#cardslist) | — | Cartões de crédito do BTG: limite total, usado, disponível e valor da fatura, mais quanto o titular e cada car… |
| [`invoice`](#invoice) | — | Fatura do cartão de um mês: status (aberta, fechada, paga, futura), gasto por portador (titular x adicional) e… |
| [`invoice_transactions`](#invoicetransactions) | — | Lançamentos das faturas do cartão: data, estabelecimento, valor, parcela (ex.: 3/10), portador (titular ou adi… |
| [`investments_position`](#investmentsposition) | — | Carteira de investimentos consolidada: total, cada classe (renda variável, renda fixa, cripto e outras) e cada… |
| [`investments_statement`](#investmentsstatement) | — | Extrato da conta investimento (saldo anterior, créditos, débitos, saldo atual e movimentações do período sincr… |
| [`open_finance_summary`](#openfinancesummary) | — | Patrimônio agregado via Open Finance: investimentos e contas de OUTRAS instituições conectadas ao BTG (nome, s… |
| [`spending_summary`](#spendingsummary) | — | Quanto foi gasto no cartão, agrupado por fatura, mês da compra, estabelecimento, portador (titular x adicional… |
| [`export`](#export) | sim | Exporta do cache para um arquivo CSV ou JSON: lançamentos das faturas do cartão, extrato da conta corrente ou … |
| [`raw_get`](#rawget) | — | Faz um GET em um endpoint do canal investments do BTG e devolve o JSON cru, sem interpretar. Serve para redesc… |

## `auth_status`

Diz se há uma sessão do BTG salva e o que ela cobre (marcadores de sessão presentes, conta de investimento, idade, navegador de origem) sem usar a rede. Com verify=true gasta 1 requisição ao canal investments para confirmar que o app ainda aceita a sessão. Nunca mostra valores de token. Comece por aqui quando outra tool reclamar de sessão.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `verify` | boolean | — | Também confirma a sessão com 1 requisição ao canal investments |

## `login`

Salva a sessão do BTG. Abre uma janela dedicada do Google Chrome no app, espera você fazer o login (senha, "não sou robô", verificação em duas etapas) e escolher a conta, guarda a sessão cifrada e fecha a janela. Nada da senha ou do MFA é automatizado. Abre uma janela: rode no seu computador. Use quando `auth_status` disser que não há sessão ou que ela expirou.

**Escreve em disco/cache:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `attach` | boolean | — | Não abre janela: só copia a sessão de um Chrome que VOCÊ já abriu com --remote-debugging-port e logou |
| `endpoint` | string | — | Endpoint de depuração no modo attach (default http://localhost:9222) |
| `timeout_seconds` | integer (≥ 60, ≤ 900) | — | Tempo máximo esperando o login (default 300) |
| `fresh` | boolean | — | Apaga o perfil da janela de login antes (começa do zero) |

## `doctor`

Diagnóstico por camada: configuração, sessão salva, cache, navegador e, com deep=true, o canal investments (1 requisição) e uma tela do banking (1 render). Diz qual camada quebrou e o que fazer. Sem deep não usa a rede. Use quando outra tool falhar sem motivo claro.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `deep` | boolean | — | Testa também o BTG ao vivo (1 requisição + 1 tela) |

## `sync`

Baixa os dados do BTG para o cache local: saldos, carteira, extrato da conta investimento e futuros (canal investments, ~5 requisições, segundos) e as telas de cartões e da conta corrente (2 telas, dezenas de segundos; a primeira chamada abre o Chrome em segundo plano). Precisa de sessão ativa: se falhar por sessão, rode `login`. `reparse` reprocessa o que já está salvo, sem rede.

**Escreve em disco/cache:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `parts` | `all` \| `investments` \| `banking` | — | all (padrão), investments (rápido, só JSON) ou banking (telas de cartão e extrato) |
| `reparse` | boolean | — | Reprocessa o cache com os parsers atuais, sem rede |
| `period_days` | integer (≥ 1, ≤ 365) | — | Dias do extrato da conta investimento (default 30) |

## `account_balance`

Saldo da conta corrente (com e sem o limite do cheque especial) e da conta investimento (total, investido, disponível, bloqueado, rendimento acumulado), em reais, do último sync. Não usa a rede: lê o cache. Se disser que não há dados, rode `sync`. `asOf` diz quando o saldo foi lido.

**Escreve em disco/cache:** não

Sem parâmetros.

## `account_statement`

Extrato da conta corrente (Pix, transferências, contas, compras no débito) linha a linha, com totais de entradas e saídas do filtro, em reais. Não usa a rede: lê o cache, que guarda as linhas vistas nos syncs (a tela do banco pagina; `coverage` diz quantas o cache tem versus o período). Também lista os agendamentos (Pix recorrente, débito automático). Sem dados: rode `sync`.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `from` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Data inicial (YYYY-MM-DD) |
| `to` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Data final (YYYY-MM-DD) |
| `query` | string (min 2 chars) | — | Busca em contraparte, descrição e categoria (sem acento) |
| `category` | string | — | Categoria exata, ex.: Transferência, Compras |
| `direction` | `in` \| `out` | — | in = entradas, out = saídas |
| `limit` | integer (≥ 1, ≤ 200) | — | Máximo de itens (default 50) |
| `offset` | integer (≥ 0) | — | Linhas a pular (paginação) |

## `cards_list`

Cartões de crédito do BTG: limite total, usado, disponível e valor da fatura, mais quanto o titular e cada cartão adicional gastaram na fatura aberta (o gasto corrente do mês). Não usa a rede: lê o cache. Sem dados: rode `sync`. Os 4 últimos dígitos podem vir vazios (o BTG nem sempre os envia).

**Escreve em disco/cache:** não

Sem parâmetros.

## `invoice`

Fatura do cartão de um mês: status (aberta, fechada, paga, futura), gasto por portador (titular x adicional) e o resumo dos lançamentos (compras, parcelas, estornos, pagamentos). Sem `month`, usa a fatura fechada (a do topo do app). O valor total informado pelo BTG só existe para a fatura fechada; para as outras use o gasto por portador e o resumo. Lista os meses conhecidos. Não usa a rede.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `month` | string (`^\d{4}-\d{2}$`) | — | Mês de referência (YYYY-MM) |

## `invoice_transactions`

Lançamentos das faturas do cartão: data, estabelecimento, valor, parcela (ex.: 3/10), portador (titular ou adicional, com o nome) e tipo (compra, parcelada, internacional, estorno, pagamento). Valor negativo é cobrança; positivo é crédito. Compras parceladas mostram a data da compra original. Não usa a rede: lê o cache. Sem dados: rode `sync`.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `month` | string (`^\d{4}-\d{2}$`) | — | Mês de referência (YYYY-MM) |
| `holder` | `all` \| `titular` \| `adicional` | — | Filtra por portador: all (padrão), titular ou adicional |
| `kind` | `purchase` \| `installment` \| `international` \| `cancelled` \| `payment` \| `other` | — | Filtra pelo tipo de lançamento |
| `installments_only` | boolean | — | Só compras parceladas |
| `query` | string (min 2 chars) | — | Busca no estabelecimento e na descrição (sem acento) |
| `from` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Data inicial da compra (YYYY-MM-DD) |
| `to` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Data final da compra (YYYY-MM-DD) |
| `limit` | integer (≥ 1, ≤ 500) | — | Máximo de itens (default 100) |
| `offset` | integer (≥ 0) | — | Linhas a pular (paginação) |

## `investments_position`

Carteira de investimentos consolidada: total, cada classe (renda variável, renda fixa, cripto e outras) e cada produto com quantidade, preço médio, preço atual, valor bruto e líquido, investido, ganho e rentabilidade (ganho / investido, em %). Renda fixa traz emissor, indexador e vencimento. Não usa a rede: lê o cache. Sem dados: rode `sync`.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `asset_class` | string | — | Filtra a classe pelo código (RV, RF, CRY) ou pelo nome, sem acento |
| `include_products` | boolean | — | Inclui cada produto (default true) |

## `investments_statement`

Extrato da conta investimento (saldo anterior, créditos, débitos, saldo atual e movimentações do período sincronizado) e os lançamentos futuros (liquidações e créditos agendados). Não usa a rede: lê o cache. Sem dados: rode `sync` (o período padrão é 30 dias).

**Escreve em disco/cache:** não

Sem parâmetros.

## `open_finance_summary`

Patrimônio agregado via Open Finance: investimentos e contas de OUTRAS instituições conectadas ao BTG (nome, saldo, limite), totais e avisos de consentimento. Números de conta saem mascarados (só os 4 últimos dígitos). Não usa a rede: lê o cache. Sem dados: rode `sync`.

**Escreve em disco/cache:** não

Sem parâmetros.

## `spending_summary`

Quanto foi gasto no cartão, agrupado por fatura, mês da compra, estabelecimento, portador (titular x adicional) ou tipo. Soma compras, parcelas e internacionais (valores positivos) e mostra os estornos à parte; pagamentos de fatura nunca entram. Não usa a rede: lê o cache. Só considera as faturas já sincronizadas. Sem dados: rode `sync`.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `group_by` | `invoice` \| `month` \| `merchant` \| `holder` \| `kind` | sim | invoice = mês da fatura; month = mês da compra; merchant; holder; kind |
| `month` | string (`^\d{4}-\d{2}$`) | — | Mês de referência (YYYY-MM) |
| `holder` | `all` \| `titular` \| `adicional` | — | Filtra por portador: all (padrão), titular ou adicional |
| `from` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Data inicial da compra (YYYY-MM-DD) |
| `to` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Data final da compra (YYYY-MM-DD) |
| `limit` | integer (≥ 1, ≤ 200) | — | Máximo de itens (default 30) |

## `export`

Exporta do cache para um arquivo CSV ou JSON: lançamentos das faturas do cartão, extrato da conta corrente ou posições de investimento. Grava só dentro de BTG_EXPORT_DIR (padrão ~/Downloads/btgpactual-export), com permissão 0600. Não usa a rede. Sem dados: rode `sync`.

**Escreve em disco/cache:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `scope` | `invoice_lines` \| `statement` \| `positions` | sim | invoice_lines, statement ou positions |
| `format` | `csv` \| `json` | sim | csv ou json |
| `filename` | string | — | Nome do arquivo (sem pasta); padrão btg-<scope>-<data>.<ext> |

## `raw_get`

Faz um GET em um endpoint do canal investments do BTG e devolve o JSON cru, sem interpretar. Serve para redescobrir um endpoint quando o app muda; use com parcimônia. Só caminhos /investments/api/... (que devolvem JSON); o canal banking é cifrado e não tem acesso cru. Qualquer outro caminho é recusado, porque este servidor nunca altera a conta.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `path` | string | sim | Caminho a partir de app.btgpactual.com, ex.: /investments/api/statement-position/home |
| `max_bytes` | integer (≥ 1024, ≤ 65536) | — | Corta a resposta neste tamanho (default 65536) |
