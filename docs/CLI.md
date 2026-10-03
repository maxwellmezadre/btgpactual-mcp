# CLI

O binário se chama `btgpactual`. Cada comando chama a tool de mesmo
propósito, pelo mesmo código que o servidor MCP usa.

## Sessão e diagnóstico

| Comando | Opções | Faz |
| --- | --- | --- |
| `status` | `--verify` | Estado da sessão salva; `--verify` gasta 1 requisição |
| `login` | `--attach`, `--endpoint <url>`, `--fresh`, `--timeout <s>` | Abre o Chrome, espera o login e salva a sessão |
| `doctor` | `--deep` | Diagnóstico por camada; `--deep` testa o BTG ao vivo |

`login --attach` não abre janela: copia a sessão de um Chrome que você já abriu
com `--remote-debugging-port=9222` e logou. `--fresh` apaga o perfil da janela
de login antes.

## Cache

| Comando | Opções | Faz |
| --- | --- | --- |
| `sync` | `--parts all\|investments\|banking`, `--reparse`, `--period-days <n>` | Atualiza o cache |

`--reparse` reprocessa o que já está salvo, sem rede. O sync roda em três
fases (investimentos, faturas, extrato); a tool para entre elas para manter
cada chamada MCP curta, e o comando `sync` do CLI repete sozinho até terminar,
mostrando cada etapa no stderr. Se a sessão cair no meio, depois do `login` o
próximo `sync` retoma da fase em que parou.

## Conta corrente

| Comando | Opções | Faz |
| --- | --- | --- |
| `balance` | | Saldo da conta corrente e da conta investimento |
| `statement` | `--from`, `--to`, `--query`, `--category`, `--direction in\|out`, `--limit`, `--offset` | Extrato com totais de entradas e saídas |

## Cartões

| Comando | Opções | Faz |
| --- | --- | --- |
| `cards` | | Limites e gasto do titular e de cada adicional |
| `invoice` | `--month YYYY-MM` | Status, total e resumo de uma fatura |
| `transactions` | `--month`, `--holder titular\|adicional`, `--kind`, `--installments`, `--query`, `--from`, `--to`, `--limit`, `--offset` | Lançamentos das faturas |

## Investimentos

| Comando | Opções | Faz |
| --- | --- | --- |
| `positions` | `--class <c>`, `--no-products` | Carteira por classe e produto |
| `inv-statement` | | Extrato da conta investimento e lançamentos futuros |
| `open-finance` | | Patrimônio em outras instituições |

## Análise

| Comando | Opções | Faz |
| --- | --- | --- |
| `spending` | `--by invoice\|month\|merchant\|holder\|kind`, `--month`, `--holder`, `--from`, `--to`, `--limit` | Gastos no cartão agrupados |
| `export` | `--scope invoice_lines\|statement\|positions`, `--format csv\|json`, `--filename` | Grava em `BTG_EXPORT_DIR` |

## Redescoberta

| Comando | Opções | Faz |
| --- | --- | --- |
| `raw <path>` | `--max-bytes <n>` | GET cru em `/investments/api/...` |

## Servidor

`btgpactual mcp` inicia o servidor MCP por stdio. O binário `btgpactual-mcp`
faz o mesmo sem subcomando.

## Saída

Sem opção, cada comando imprime uma tabela (listas) ou JSON indentado. Com
`--json` a saída é sempre JSON, pronta para `jq`. Erros vão para o stderr e o
código de saída é 1.

## Exemplos

```sh
btgpactual statement --direction out --from 2026-09-01 --to 2026-09-30
btgpactual transactions --holder adicional --month 2026-10
btgpactual spending --by merchant --limit 10
btgpactual positions --class RF --json | jq '.positions[] | {name, maturityDate}'
btgpactual export --scope statement --format csv --filename extrato.csv
```
