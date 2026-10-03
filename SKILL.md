---
name: btgpactual-mcp
description: >-
  Conta do usuário no BTG Pactual via MCP `btgpactual`: saldo da conta corrente
  e do cheque especial, extrato, cartões e limites, fatura com lançamentos,
  parcelas e o corte titular x adicional, carteira de investimentos por classe e
  produto, extrato da conta investimento e patrimônio de outras instituições
  via Open Finance, com cache local. Use para perguntas como "qual meu saldo no
  BTG", "quanto está a fatura", "o que está parcelado", "quanto o cartão
  adicional gastou", "como está minha renda fixa". Triggers: BTG, BTG Pactual,
  saldo, conta corrente, cheque especial, extrato, Pix, cartão, fatura,
  parcela, parcelado, adicional, titular, limite, investimento, carteira,
  renda fixa, CDB, ETF, cripto, rentabilidade, open finance.
---

# BTG Pactual — conta, cartões e investimentos

MCP `btgpactual` (`mcp__btgpactual__*`), 15 tools. Referência completa de
parâmetros em `TOOLS.md`, ao lado deste arquivo.

## Leia antes de responder

1. **Comece por `auth_status`.** Sem `verify` não usa a rede e diz se há sessão
   salva e de quando. Com `verify: true` gasta 1 requisição e confirma que o
   BTG ainda aceita a sessão.
2. **O cache responde quase tudo.** `account_balance`, `account_statement`,
   `cards_list`, `invoice`, `invoice_transactions`, `investments_position`,
   `investments_statement`, `open_finance_summary` e `spending_summary` leem o
   SQLite local, sem rede. Toda resposta traz `asOf`: diga ao usuário de
   quando é o dado. Se a tool disser que nada foi sincronizado, rode `sync`.
3. **`sync` precisa de sessão ativa** e roda em fases (investimentos,
   faturas, extrato). Cada chamada para entre fases depois de ~50 s e devolve
   `done: false`: chame `sync` de novo, com os mesmos `parts`, até `done:
   true`. A sessão do banco dura cerca de uma hora a partir do login, mesmo em uso: se `sync` falhar
   por sessão, peça para o usuário rodar `btgpactual login` no terminal (abre
   uma janela; ele faz o login e o MFA) e depois chame `sync` de novo, que
   retoma da fase onde parou. Você não consegue fazer o login por ele.
4. **O que cada número significa.** `invoice.total` é o "Valor da fatura"
   que o próprio BTG mostra: o que ela cobra, já descontados os pagamentos
   feitos antes do fechamento. Não precisa bater com a soma dos lançamentos
   (pagamentos antecipados, cashback e tarifas). `invoice.paid` é o "Valor
   pago" (só existe depois de pago); `dueDate` e `closingDate` são as datas da
   própria fatura, não as presuma.
   Em `invoice_transactions`, valor negativo é cobrança e positivo é crédito
   (pagamento de fatura, estorno). Parcelas mostram a data da compra original.
   `yieldPercent` é ganho dividido pelo investido.
5. **Cobertura.** O cache tem todas as faturas desde a primeira do cartão
   (as antigas vêm da página "Fatura completa", lidas uma vez), as futuras do
   gráfico e todas as páginas do extrato do período padrão da tela. Nas
   faturas antigas o portador é `desconhecido`: aquela página não diz se foi
   titular ou adicional. `account_statement.coverage` compara o cache com o
   total do período no banco. Fora disso não há dado: não afirme que um
   lançamento não existiu só porque não está no cache.
6. **Dado pessoal só quando pedido.** Não repita números de conta, nomes de
   terceiros do extrato nem valores além do que a pergunta precisa. Contas de
   outros bancos já vêm mascaradas.
7. **Verificação adicional do banco: pare.** Se uma tool disser que o BTG
   exigiu verificação, não tente de novo; explique e espere o horário indicado.

## Tools ↔ CLI

| Tool | CLI | Para quê |
| --- | --- | --- |
| `auth_status` | `btgpactual status` | Há sessão? De quando? |
| `login` | `btgpactual login` | Salvar a sessão (janela, MFA do usuário) |
| `doctor` | `btgpactual doctor` | Qual camada quebrou |
| `sync` | `btgpactual sync` | Atualizar o cache |
| `account_balance` | `btgpactual balance` | Saldo, cheque especial, conta investimento |
| `account_statement` | `btgpactual statement` | Extrato da conta corrente e agendamentos |
| `cards_list` | `btgpactual cards` | Limites e gasto por portador |
| `invoice` | `btgpactual invoice` | Status e total da fatura de um mês |
| `invoice_transactions` | `btgpactual transactions` | Lançamentos, parcelas, titular x adicional |
| `investments_position` | `btgpactual positions` | Carteira por classe e produto |
| `investments_statement` | `btgpactual inv-statement` | Extrato da conta investimento e futuros |
| `open_finance_summary` | `btgpactual open-finance` | Patrimônio em outras instituições |
| `spending_summary` | `btgpactual spending --by g` | Gastos no cartão agrupados |
| `export` | `btgpactual export` | CSV ou JSON em BTG_EXPORT_DIR |
| `raw_get` | `btgpactual raw <path>` | GET cru no canal de investimentos |

Todo comando do CLI aceita `--json`.

## Receitas

- "Qual meu saldo?" → `account_balance` (diga `asOf`).
- "Quanto está a fatura?" → `invoice` (sem `month` = a fechada, com o valor
  do BTG e o vencimento). "Fatura do mês passado" costuma ser a fechada.
- "Quanto já paguei da fatura?" → `invoice` do mês: `paid` quando já paga;
  antes disso, `lines.paymentsReceived` (pagamentos antecipados no ciclo).
- "Quando vence / quando fecha?" → `invoice` (`dueDate`, `closingDate`).
- "Quanto gastei no cartão este ano?" → `spending_summary` com
  `group_by: "invoice"` e `from`/`to`.
- "Quanto já gastei no cartão este mês?" → `invoice` do mês com status `open`
  (`spendingByHolder` e `lines`), ou `cards_list`.
- "Quanto de parcela vem nos próximos meses?" → `invoice` ou
  `invoice_transactions` dos meses `future`.
- "O que está parcelado e quanto falta?" → `invoice_transactions` com
  `installments_only: true`; cada linha traz `installment` no formato `N/T`.
- "Quanto o adicional gastou?" → `cards_list` (`spendingByHolder`) ou
  `spending_summary` com `group_by: "holder"`.
- "Onde mais gastei no cartão?" → `spending_summary` com `group_by: "merchant"`.
- "Quanto saiu da conta em setembro?" → `account_statement` com `from`, `to` e
  `direction: "out"`; use `totals.out` e avise da `coverage`.
- "Como está minha carteira?" → `investments_position`; filtre com
  `asset_class` ("renda fixa", "RV", "cripto").
- "Quanto tenho em outros bancos?" → `open_finance_summary`.
- Dado desatualizado → `sync` (ou `sync` com `parts: "investments"` para só
  saldos e carteira, em segundos).

## Avisos

- Somente leitura na conta: nenhuma tool transfere, paga, gera boleto, investe
  ou resgata. `raw_get` só faz GET no canal de investimentos.
- Não rode `sync` em sequência sem motivo: cada um abre telas do banco.
- Dados sensíveis: saldos e lançamentos são do usuário; não os copie para
  fora da conversa.
- Valores saem em reais com centavos; somas são exatas (o cache guarda
  centavos inteiros).
- Com `BTG_READ_ONLY=1`, `login`, `sync` e `export` não existem; responda com o
  que o cache tem.
