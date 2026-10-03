# Quando o BTG mudar

## 1. Pergunte ao doctor primeiro

```sh
btgpactual doctor --deep
```

Ele testa as camadas em ordem (configuração, sessão, cache, navegador, canal de
investimentos, tela de cartões) e diz qual quebrou. Corrija só aquela.

## 2. Sessão

Se `session` ou `investments` falham com "pediu login" ou "seleção de conta",
não é mudança do BTG: rode `btgpactual login` e clique em **Acessar**.

## 3. Canal de investimentos

Um endpoint mudou de nome ou de forma:

```sh
btgpactual raw /investments/api/statement-position/home --json | jq 'keys'
```

Compare com os campos lidos em `src/btg/investments/*.ts`. Os parsers usam
acessores tolerantes: um campo renomeado vira `null` em vez de derrubar tudo.
Ajuste o nome, rode o teste da `test/local/` com uma captura nova
(`bun run scripts/capture-fixtures.ts --write`) e incremente `PARSER_VERSION` em
`src/cache/repo.ts`.

## 4. Telas do banco

Uma tela parou de ser lida (`banking` falha no doctor, ou o sync dá
`BankingRenderError`):

1. Capture a tela: `bun run scripts/capture-fixtures.ts --write --render
   /cartoes --selector body --name cartoes`.
2. Abra o HTML salvo em `task/captures/` e procure as classes de
   `src/btg/banking/selectors.ts`.
3. Troque só os seletores que mudaram. Prefira classes BEM do design system
   (`timeline-item__title`, `extract__row`) e texto da interface; nunca as
   classes `_ngcontent-*`, que mudam a cada deploy.
4. Rode `bun test` e o teste local; depois `btgpactual sync --reparse` para
   reprocessar o que já está no cache.

## 5. Criptografia ou login

Se o app mudar a forma de guardar a sessão, a cópia do `sessionStorage` deixa
de funcionar e o teste do login falha. Investigue com a aba aberta pelo
`btgpactual login --attach` (Chrome com `--remote-debugging-port`), lendo as
chaves de storage e as chamadas de rede; nunca tente reproduzir a
criptografia do canal do banco.

## Nunca automatize

- Senha, "não sou robô" ou verificação em duas etapas.
- Cliques em qualquer coisa que não seja navegação (transferir, pagar, gerar
  boleto, investir, trocar de conta, sair).
- Chamadas que não sejam leitura.
