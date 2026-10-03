# Do zero à primeira resposta

## 1. Instalar

```sh
git clone https://github.com/maxwellmezadre/btgpactual-mcp.git
cd btgpactual-mcp
bun install
bun run setup
```

Precisa do Bun 1.3 ou mais novo e do Google Chrome. O `setup` coloca o
binário em `~/.local/bin/btgpactual`, registra o MCP no Claude Code e instala a
Skill.

## 2. Entrar na conta

```sh
btgpactual login
```

Uma janela do Chrome abre no app do BTG. Faça o login como sempre (senha,
"não sou robô", verificação em duas etapas), clique em **Acessar** na conta e
espere a tela inicial. A janela fecha sozinha quando a sessão estiver salva e
testada.

Confira:

```sh
btgpactual status --verify
```

`verified: true` quer dizer que o BTG aceitou a sessão.

## 3. Baixar os dados

```sh
btgpactual sync
```

Leva cerca de um minuto e meio: saldos, carteira e extrato da conta
investimento vêm do canal de investimentos (segundos); as faturas (paga,
fechada, aberta e futuras) e o extrato completo da conta corrente vêm das telas
do banco, mês a mês e página a página. Para só o rápido (saldos e carteira),
use `btgpactual sync --parts investments`.

## 4. Perguntar

```sh
btgpactual balance
btgpactual invoice
btgpactual transactions --installments
btgpactual spending --by holder
btgpactual positions
```

Nada disso usa a rede: é tudo do cache.

## 5. Pelo Claude

Abra uma sessão nova do Claude Code e pergunte: "qual meu saldo no BTG?",
"o que está parcelado na fatura?", "quanto o cartão adicional gastou?". O
Claude usa as tools do MCP `btgpactual` e diz de quando é cada dado.

## Manutenção

A sessão do banco expira em pouco tempo, mas o cache não: as perguntas
continuam respondidas. Quando quiser dados novos, `btgpactual login` (se a
sessão caiu) e `btgpactual sync`. Se algo parar de funcionar, comece por
`btgpactual doctor --deep`.
