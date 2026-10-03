# Fixtures

Os arquivos em `investments/` são **sintéticos**: reproduzem a estrutura exata
(nomes de chaves, aninhamento, tipos) das respostas reais do canal investments
do BTG, capturadas numa sessão real em 03/10/2026, mas todos os valores, nomes,
códigos e números de conta são inventados. Nenhum dado de cliente entra no
repositório.

As identidades financeiras são coerentes de propósito, para que os testes as
verifiquem: soma das posições igual ao valor da classe (cripto com 50 centavos
de diferença, dentro da tolerância de 1%), soma das classes igual ao total,
saldo anterior + créditos − débitos igual ao saldo atual.

| Arquivo | Endpoint de origem |
| --- | --- |
| `investments/home.json` | `statement-position/home` |
| `investments/allocation.json` | `statement-position/allocation/{conta}/type/MARKET/summary` |
| `investments/statement.json` | `account-statement/period/{N}/history/grouped` |

As linhas de `statement.json` usam um formato provável, não confirmado: a
captura real veio sem movimentação. As capturas reais ficam em `task/captures/`
(fora do git) e são verificadas por `test/local/captures.local.test.ts`.

## Banking (HTML renderizado)

`banking/fatura-completa.html` (página "Fatura completa", com cabeçalho,
linhas e o detalhe oculto de cada uma) e `banking/seletor-faturas.html` (o
seletor de faturas depois de uma busca) seguem a mesma regra.

`banking/cartoes.html` e `banking/conta-corrente.html` são HTML **escrito à
mão** com as mesmas classes BEM das telas reais (`/cartoes` e
`/conta-corrente`, capturadas em 03/10/2026) e dados inventados. Cobrem: grupo
de dia sem cabeçalho herdando a data anterior, parcela `(N/T)` no fim do
título, cartão adicional com nome do portador, compra internacional, compra
cancelada, pagamento de fatura, ano explícito no `h2`, lançamento agendado com
recorrência e duas linhas idênticas no mesmo dia.
