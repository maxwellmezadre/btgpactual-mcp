# btgpactual-mcp

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.3-black.svg)](https://bun.sh)
[![TypeScript: strict](https://img.shields.io/badge/typescript-strict-3178c6.svg)](tsconfig.json)
[![CI](https://github.com/maxwellmezadre/btgpactual-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/maxwellmezadre/btgpactual-mcp/actions/workflows/ci.yml)

CLI + servidor MCP para a **sua conta no BTG Pactual**: saldo da conta
corrente e do cheque especial, extrato, cartões, fatura com lançamentos e
parcelas (titular e adicional separados), carteira de investimentos por classe
e produto, extrato da conta investimento e o patrimônio que você conectou via
Open Finance. Tudo vai para um cache local, então as perguntas são respondidas
sem bater no banco a cada vez, e continuam respondidas depois que a sessão do
banco expira.

O BTG não tem API para pessoa física consultar a própria conta. Este projeto
usa o app web (`app.btgpactual.com`) por dentro de um Chrome autenticado: o
canal de investimentos devolve JSON, e as telas do banco (que trafegam
cifradas) são lidas já renderizadas, sem reimplementar a criptografia do app.
**Somente leitura**: nenhuma operação que mexa na conta existe no código, o
`raw_get` só aceita GETs no canal de investimentos, e o login (senha,
"não sou robô", verificação em duas etapas) é sempre feito por você.

## Sumário

- [Instalação](#instalação)
- [Login](#login)
- [Uso — CLI](#uso--cli)
- [Uso — MCP](#uso--mcp)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Tools](#tools)
- [Como funciona](#como-funciona)
- [Troubleshooting](#troubleshooting)
- [Documentação](#documentação)
- [Licença](#licença)

## Instalação

Requer [Bun](https://bun.sh) 1.3 ou mais novo (o cache usa `bun:sqlite`) e o
Google Chrome instalado.

### Tudo de uma vez (Claude Code)

```sh
git clone https://github.com/maxwellmezadre/btgpactual-mcp.git
cd btgpactual-mcp
bun install
bun run setup
```

`setup` compila o binário para `~/.local/bin/btgpactual`, registra o servidor
MCP `btgpactual` no escopo de usuário do seu `~/.claude.json` e instala a
Skill em `~/.claude/skills/btgpactual-mcp/`.

### npm

```sh
npm i -g @maxwellmezadre/btgpactual-mcp   # instala `btgpactual` e `btgpactual-mcp` no PATH
btgpactual --version
```

O pacote roda com o Bun (`bun:sqlite`), então o Bun precisa estar instalado.

### Binário único

```sh
bun run build:binary   # gera ./btgpactual
./btgpactual --version
```

O binário faz tudo, inclusive o `login`.

## Login

```sh
btgpactual login
```

Abre uma janela dedicada do Google Chrome no app do BTG. Você faz o login
normalmente (senha, "não sou robô", verificação em duas etapas), clica em
**Acessar** na conta e espera a tela inicial. A ferramenta percebe sozinha,
confere que a sessão funciona, guarda tudo cifrado e fecha a janela.

A janela é um Chrome comum, não controlado por automação, por isso o reCAPTCHA
do banco aceita. A sessão fica em `~/.config/btgpactual-mcp/session.enc`
(AES-256-GCM, permissão 0600). Detalhes em [docs/LOGIN.md](docs/LOGIN.md).

## Uso — CLI

```sh
btgpactual status                  # há sessão? de quando? (sem rede)
btgpactual sync                    # baixa tudo para o cache (precisa de sessão ativa)
btgpactual balance                 # conta corrente e conta investimento
btgpactual statement --direction out --from 2026-09-01
btgpactual cards                   # limites e gasto do titular e do adicional
btgpactual invoice                 # fatura da tela no último sync
btgpactual transactions --installments
btgpactual positions --class "renda fixa"
btgpactual spending --by merchant
btgpactual export --scope invoice_lines --format csv
btgpactual doctor                  # qual camada quebrou
```

Todo comando aceita `--json`. Referência completa em [docs/CLI.md](docs/CLI.md).

## Uso — MCP

```sh
claude mcp add -s user btgpactual -- /Users/voce/.local/bin/btgpactual mcp
```

Ou direto no `~/.claude.json`:

```json
{
  "mcpServers": {
    "btgpactual": {
      "command": "/Users/voce/.local/bin/btgpactual",
      "args": ["mcp"]
    }
  }
}
```

Use caminho absoluto: clientes MCP não herdam o `PATH` do seu shell. Depois é
só perguntar: "qual meu saldo no BTG?", "o que está parcelado na fatura?",
"quanto o cartão adicional gastou este mês?", "como está minha carteira de
renda fixa?".

## Variáveis de ambiente

Todas opcionais.

| Variável | Default | Para quê |
| --- | --- | --- |
| `BTG_CONFIG_DIR` | `~/.config/btgpactual-mcp` | Sessão, cache e perfis do Chrome |
| `BTG_SESSION_KEY` | `session.key` gerada (0600) | Chave da sessão cifrada (base64 de 32 bytes) |
| `BTG_EXPORT_DIR` | `~/Downloads/btgpactual-export` | Único diretório onde `export` grava |
| `BTG_READ_ONLY` | `0` | `1` não registra `login`, `sync` nem `export` |
| `BTG_ACCOUNT` | descoberta sozinha | Número da conta de investimento |
| `BTG_HEADLESS` | `1` | `0` mostra a janela do navegador de leitura |
| `BTG_CHROME_PATH` | Chrome do sistema | Executável usado pelo `login` |

A tabela completa está em [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Tools

São 15, iguais no MCP e no CLI.

| Tool | Comando | Rede |
| --- | --- | --- |
| `auth_status` | `status [--verify]` | não (1 requisição com `verify`) |
| `login` | `login [--attach] [--fresh]` | abre o Chrome |
| `doctor` | `doctor [--deep]` | não (1 requisição + 1 tela com `deep`) |
| `sync` | `sync [--parts p] [--reparse]` | ~5 requisições + 2 telas e cliques (~1,5 min) |
| `account_balance` | `balance` | não |
| `account_statement` | `statement` | não |
| `cards_list` | `cards` | não |
| `invoice` | `invoice [--month m]` | não |
| `invoice_transactions` | `transactions` | não |
| `investments_position` | `positions` | não |
| `investments_statement` | `inv-statement` | não |
| `open_finance_summary` | `open-finance` | não |
| `spending_summary` | `spending --by g` | não |
| `export` | `export --scope s --format f` | não |
| `raw_get` | `raw <path>` | 1 requisição |

Parâmetros de cada uma em [docs/TOOLS.md](docs/TOOLS.md).

## Como funciona

1. O `login` abre um Chrome comum para você entrar e copia a sessão da aba
   (sessionStorage, localStorage, cookies) pela porta de depuração local. A
   porta só fica aberta durante o login.
2. O app do BTG guarda a sessão no `sessionStorage`, que o Chrome não persiste
   entre execuções. Por isso o navegador de leitura (headless) restaura essa
   cópia antes de o app carregar, e o app acorda logado.
3. O canal de investimentos (`/investments/api/`) responde JSON. A ferramenta
   repete as chamadas de dentro da página, com os cabeçalhos de sessão que o
   próprio app emitiu.
4. O canal do banco (`/banking/api/`) é cifrado pelo app. Em vez de quebrar a
   cifra, a ferramenta abre as telas de cartões e da conta corrente e lê o
   HTML já desenhado. Na tela de cartões ela clica em cada mês do gráfico (com
   mouse de verdade) e só aceita a lista quando o próprio gráfico confirma o mês
   escolhido; no extrato, avança página por página até o fim.
5. Tudo vai para um SQLite local, com os valores em centavos inteiros e a
   resposta bruta guardada, para reprocessar sem rede quando um parser mudar.

## Troubleshooting

| Sintoma | O que fazer |
| --- | --- |
| "Nenhuma sessão salva" ou "pediu login" | `btgpactual login` |
| "Nada sincronizado ainda" | `btgpactual sync` (com sessão ativa) |
| O login não passa do "não sou robô" | Use o `btgpactual login` (janela comum), nunca um navegador automatizado |
| "A sessão salva para na seleção de conta" | Rode `login` de novo e clique em **Acessar** antes de a janela fechar |
| Uma etapa do `sync` falha e as outras não | `btgpactual doctor --deep` diz qual camada quebrou |
| Uma tela parou de ser lida depois de um deploy do BTG | [docs/REDISCOVERY.md](docs/REDISCOVERY.md) |
| "O BTG exigiu verificação adicional" | Pare, abra o app no navegador, resolva e espere o tempo indicado |

## Documentação

| Arquivo | Conteúdo |
| --- | --- |
| [docs/USAGE.md](docs/USAGE.md) | Do zero à primeira resposta |
| [docs/CLI.md](docs/CLI.md) | Todos os comandos e opções |
| [docs/TOOLS.md](docs/TOOLS.md) | Todas as tools e parâmetros (gerado) |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Variáveis, arquivos, registro no Claude Code |
| [docs/LOGIN.md](docs/LOGIN.md) | Como a sessão é obtida, guardada e revogada |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Camadas, fluxo de uma pergunta, regras |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | O que cada número significa, o cache, o que não existe |
| [docs/INTERNAL-API.md](docs/INTERNAL-API.md) | Os dois canais do app e as telas lidas |
| [docs/REDISCOVERY.md](docs/REDISCOVERY.md) | O que fazer quando o BTG mudar |
| [docs/adr/](docs/adr/) | Decisões de arquitetura (13) |

## Licença

MIT. Projeto independente, sem relação com o BTG Pactual, para uso com a sua
própria conta.
