# Configuração

## Variáveis

Tudo vem do ambiente, com prefixo `BTG_`. Nenhuma é obrigatória. Valores
inválidos são reportados todos de uma vez, na partida.

| Variável | Default | Para quê |
| --- | --- | --- |
| `BTG_CONFIG_DIR` | `~/.config/btgpactual-mcp` | Onde ficam sessão, cache e perfis do Chrome |
| `BTG_SESSION_KEY` | `session.key` gerada (0600) | Chave AES-256 da sessão, base64 de 32 bytes (`openssl rand -base64 32`) |
| `BTG_EXPORT_DIR` | `~/Downloads/btgpactual-export` | Único diretório onde `export` grava |
| `BTG_READ_ONLY` | `0` | `1` não registra `login`, `sync` nem `export` |
| `BTG_COMPACT` | `0` | Sem efeito nesta versão (nenhuma tool tem modo compacto) |
| `BTG_ACCOUNT` | descoberta no sync | Número da conta de investimento, se a descoberta falhar |
| `BTG_BROWSER_CHANNEL` | `chrome` | `chrome`, `chromium` ou `msedge` |
| `BTG_CHROME_PATH` | Chrome do sistema | Executável aberto pelo `login` |
| `BTG_DEBUG_PORT` | `9222` | Porta de depuração local, aberta só durante o `login` |
| `BTG_HEADLESS` | `1` | `0` mostra a janela do navegador de leitura |
| `BTG_MIN_INTERVAL_MS` | `1500` | Intervalo mínimo entre chamadas ao BTG |
| `BTG_JITTER_MS` | `1500` | Variação aleatória somada ao intervalo |
| `BTG_PAGE_TIMEOUT_MS` | `45000` | Tempo para abrir uma página |
| `BTG_RENDER_TIMEOUT_MS` | `20000` | Tempo para uma tela mostrar as linhas |
| `BTG_BASE_URL` | `https://app.btgpactual.com` | Só para testes |
| `BTG_LOCALE` | `pt-BR` | Idioma do navegador |
| `BTG_TIMEZONE` | `America/Sao_Paulo` | Fuso do navegador |
| `BTG_LOG_FILE` | | Copia os logs para um arquivo |
| `BTG_LIVE` | | `1` libera o teste de integração contra a conta real |

## Arquivos em disco

Tudo em `BTG_CONFIG_DIR`:

| Arquivo | O que é |
| --- | --- |
| `session.enc` | Cópia da sessão (sessionStorage, localStorage, cookies, user agent), AES-256-GCM, 0600 |
| `session.key` | Chave da sessão quando `BTG_SESSION_KEY` não está definida, 0600 |
| `cache.db` | SQLite com o cache, 0600 |
| `browser-profile/` | Perfil do navegador de leitura (headless), 0700 |
| `login-chrome/` | Perfil da janela de login, 0700 |

`session.enc` com a chave equivale ao acesso à sua conta enquanto a sessão
valer. Não copie para lugar nenhum.

## Registro no Claude Code

Escopo de usuário, caminho absoluto:

```sh
claude mcp add -s user btgpactual -- /Users/voce/.local/bin/btgpactual mcp
```

Somente leitura (o modelo nunca abre janela nem atualiza o cache):

```json
{
  "mcpServers": {
    "btgpactual": {
      "command": "/Users/voce/.local/bin/btgpactual",
      "args": ["mcp"],
      "env": { "BTG_READ_ONLY": "1" }
    }
  }
}
```

Outros clientes MCP (Claude Desktop, Cursor) usam o mesmo bloco.

## Ritmo e anti-bot

As chamadas ao BTG são estritamente seriais, com 1,5 a 3 segundos entre elas.
Falhas transitórias (rede, 5xx, 429, tela que não pintou) são tentadas de novo
com espera crescente; erros 4xx, sessão expirada e telas que mudaram nunca são
repetidos. Se o banco exigir uma verificação adicional, a ferramenta para e
grava uma pausa de 30 minutos no cache, que vale até para um processo novo.
