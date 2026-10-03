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
- Faturas: todas as que aparecem no gráfico do app (em geral a paga anterior,
  a fechada, a aberta e três futuras). A aberta é o gasto corrente do mês; as
  futuras trazem as parcelas já comprometidas.
- `invoice.total`: o "Valor total da fatura" que o BTG mostra no topo da tela,
  que é sempre o da fatura **fechada**. **Não é a soma dos lançamentos**:
  depende de saldo anterior, pagamentos antecipados e tarifas.
- Gasto por portador, por mês: o quadro "Gastos por cartão" (titular e cada
  adicional) da fatura selecionada. Para o adicional bate com a soma das
  linhas; para o titular fica de 0 a 2% acima (IOF e tarifas não viram linha).
- Lançamento: data (a da compra original nas parcelas), estabelecimento,
  descrição, valor com o sinal da tela (negativo é cobrança), parcela `N/T`,
  portador e tipo: `purchase`, `installment`, `international`, `cancelled`
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
| `invoices` | Mês, status e total quando conhecido |
| `invoice_lines` | Lançamentos; o mês inteiro é substituído a cada sync daquela fatura |
| `invoice_holders` | Gasto por portador de cada mês, como o BTG mostra |
| `statement_entries` | Extrato; acumula entre syncs, com id estável (hash) |
| `meta` | Versão do esquema, último sync, pausa anti-bot |

`sync --reparse` reprocessa `snapshots.raw` com os parsers atuais, sem rede,
usando o horário da captura como referência para datas sem ano.

## O que não existe

- Valor total das faturas que não são a fechada: o app só o mostra no topo
  para a fechada, e as barras do gráfico não trazem o número no HTML. Use o
  gasto por portador e a soma das linhas.
- Extrato além do período padrão da tela do banco (o sync lê todas as páginas
  desse período; períodos maiores exigiriam mexer no filtro).
- Número completo de conta de outros bancos (só os 4 últimos dígitos).
- Cotação de câmbio: o endpoint não foi mapeado nesta versão.
- Qualquer operação de escrita.
