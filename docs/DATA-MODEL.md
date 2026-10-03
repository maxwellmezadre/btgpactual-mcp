# Modelo de dados

## Conta corrente

Vem do hub `statement-position/home` (canal de investimentos):

- `balance`: saldo da conta corrente;
- `balanceWithOverdraft`: saldo somado ao limite do cheque especial;
- `overdraftLimit` e `hasOverdraftLimit`.

O extrato vem da tela `/conta-corrente`: data (do cabeçalho do dia), hora,
contraparte, categoria (`Transferência`, `Compras`...), descrição (`Pix
recebido`, `Pix enviado via assistente virtual no WhatsApp`...) e valor com o
sinal da tela (negativo saiu da conta). Agendamentos (Pix recorrente, débito
automático da fatura) vêm à parte, com a recorrência `N/total`.

## Cartões e fatura

- `cards_list`: limite = disponível + usado (vazio quando o cartão é sem
  limite definido). Os 4 últimos dígitos costumam vir vazios do BTG.
- Faturas: todas desde a primeira do cartão. As do gráfico do app (em geral a
  paga anterior, a fechada, a aberta e três futuras) vêm da tela `/cartoes`;
  as mais antigas, da página "Fatura completa", lidas uma vez (fatura paga não
  muda). A aberta é o gasto corrente do mês; as futuras trazem as parcelas já
  comprometidas.
- `invoice.total`: o "Valor da fatura" da página completa (ou o "Valor total
  da fatura" do topo de `/cartoes`, para a fechada). É o que a fatura cobra,
  **já descontados os pagamentos feitos antes do fechamento**. **Não é a soma
  dos lançamentos**: pagamentos antecipados, cashback e tarifas mexem nele.
- `paid`: o "Valor pago", que só aparece depois do pagamento. `dueDate` e
  `closingDate`: vencimento e fechamento da própria fatura.
- Gasto por portador, por mês: o quadro "Gastos por cartão" (titular e cada
  adicional) da fatura selecionada. Para o adicional bate com a soma das
  linhas; para o titular fica de 0 a 2% acima (IOF e tarifas não viram linha).
- Lançamento: data (a da compra original nas parcelas), estabelecimento,
  descrição, valor com o sinal da tela (negativo é cobrança), parcela `N/T`,
  portador (`titular`, `adicional` ou, nas faturas antigas, `desconhecido`:
  a página completa não diz de quem era o cartão) e tipo: `purchase`, `installment`, `international`, `cancelled`
  (estorno), `payment` (pagamento de fatura), `other`.
- `spending_summary` soma `purchase`, `installment` e `international`; mostra
  `cancelled` à parte como estorno e ignora `payment`.

## Investimentos

- Posição por classe (`summary[]` do endpoint de alocação) e por produto.
- Investido: `investedValue` (ações e ETFs), `totalInitialInvestment` (renda
  fixa), `costBasis` (cripto).
- `yieldPercent`: ganho dividido pelo investido, em %. Nas ações e na cripto
  coincide com o retorno que o BTG informa. O campo `yield` da renda fixa não é
  retorno (parece a taxa contratada) e não é usado.
- Preço de mercado: `marketPrice`, `price` (renda fixa) ou `asset.value`
  (cripto). Preços unitários ficam em reais, sem arredondar.
- `accumulatedYieldPercent` das classes e da conta é o número do BTG, na base
  dele.

## Regras de dinheiro

- O canal de investimentos manda reais decimais; o banking manda texto
  (`- R$ 1.234,56`). Os dois viram centavos inteiros na entrada.
- Texto que não parece dinheiro vira `null`, nunca zero.
- As tools devolvem reais com duas casas.

## O cache

| Tabela | Conteúdo |
| --- | --- |
| `snapshots` | Último estado de cada fonte (home, alocação, telas), parseado e bruto |
| `invoices` | Mês, status, valor, valor pago, vencimento, fechamento e o id da fatura no app |
| `invoice_lines` | Lançamentos; o mês inteiro é substituído a cada sync daquela fatura |
| `invoice_holders` | Gasto por portador de cada mês, como o BTG mostra |
| `statement_entries` | Extrato; acumula entre syncs, com id estável (hash) |
| `meta` | Versão do esquema, último sync, cursor do sync em fases, pausa anti-bot, primeira fatura do cartão |

`sync --reparse` reprocessa `snapshots.raw` com os parsers atuais, sem rede,
usando o horário da captura como referência para datas sem ano.

## O que não existe

- Portador (titular x adicional) e gasto por cartão das faturas antigas: só a
  tela `/cartoes` diz isso, e só para os meses do gráfico. O PDF da fatura
  ("Baixar Fatura") provavelmente separa por cartão; não é lido.
- Extrato além do período padrão da tela do banco (o sync lê todas as páginas
  desse período; períodos maiores exigiriam mexer no filtro).
- Número completo de conta de outros bancos (só os 4 últimos dígitos).
- Cotação de câmbio: o endpoint não foi mapeado nesta versão.
- Qualquer operação de escrita.
