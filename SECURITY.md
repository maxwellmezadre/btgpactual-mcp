# Segurança

## O modelo de ameaça

Enquanto a sessão do banco valer, `session.enc` com a sua chave é acesso de
leitura à sua conta: saldos, extrato, faturas, carteira. A ferramenta nunca vê
a sua senha e não tem código que mova dinheiro, mas os dados que ela guarda
são financeiros e pessoais, e é assim que o projeto os trata.

| Proteção | Como |
| --- | --- |
| Sessão cifrada | AES-256-GCM em `session.enc`, escrita atômica, 0600; chave em `BTG_SESSION_KEY` ou `session.key` (0600) |
| Cache e exportações | `cache.db` e arquivos de `export` com 0600; exportação só dentro de `BTG_EXPORT_DIR` |
| Login humano | Senha, reCAPTCHA e verificação em duas etapas são feitos por você; nada é automatizado |
| Porta de depuração | Aberta só durante o `login`, e sem `--remote-allow-origins`, para que nenhuma página web consiga lê-la |
| Somente leitura | Nenhuma tool escreve na conta; `raw_get` aceita só GET em `/investments/api/` |
| Logs | Só no stderr, com os valores da sessão apagados |
| Dados de terceiros | Números de conta de outros bancos saem mascarados (4 últimos dígitos) |
| Repositório público | Fixtures sintéticas e um teste que barra número de conta e nomes reais |

## Nunca faça

- Colar `session.enc`, `session.key`, `cache.db` ou os diretórios
  `browser-profile/` e `login-chrome/` em issue, chat ou commit.
- Rodar o Chrome de login com `--remote-allow-origins=*`.
- Deixar o servidor MCP sem `BTG_READ_ONLY=1` num cliente em que você não
  confia.
- Compartilhar exportações: são o seu extrato.

## Revogando uma sessão

1. `rm ~/.config/btgpactual-mcp/session.enc`
2. `rm -rf ~/.config/btgpactual-mcp/login-chrome ~/.config/btgpactual-mcp/browser-profile`
3. No app do BTG, encerre as sessões ativas nas configurações de segurança.

## Reportando

Use os [GitHub Security Advisories](https://github.com/maxwellmezadre/btgpactual-mcp/security/advisories/new)
deste repositório. Não abra issue pública sobre vulnerabilidade.
