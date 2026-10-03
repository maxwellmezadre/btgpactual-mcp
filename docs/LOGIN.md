# Login

## Por que precisa de um navegador

O BTG não oferece API para pessoa física. O app web guarda a sessão no
`sessionStorage` do navegador, em chaves embaralhadas, e cifra as chamadas do
canal do banco. A única forma estável de obter uma sessão é a mesma de uma
pessoa: abrir o app, fazer login e passar pela verificação em duas etapas.

O login também precisa ser num navegador **comum**. O reCAPTCHA do BTG
reconhece um navegador controlado por automação (Playwright, Puppeteer) e não
deixa passar, por mais que você clique.

## O caminho normal

```sh
btgpactual login
```

1. A ferramenta abre o Google Chrome como um programa comum, com um perfil
   próprio (`login-chrome/`) e a porta de depuração local ligada.
2. Você faz o login, resolve o "não sou robô", aprova a verificação em duas
   etapas e clica em **Acessar** na conta.
3. A cada 2 segundos a ferramenta olha a aba pela porta de depuração. Enquanto
   a aba estiver na tela de login ou na seleção de conta, ela só espera.
4. Quando a aba chega à tela inicial, a ferramenta copia a sessão e testa: abre
   o navegador de leitura (headless) com a cópia e faz uma chamada ao BTG. Se a
   cópia parar na seleção de conta, continua esperando.
5. Com o teste aprovado, grava a sessão e fecha a janela.

A porta de depuração só fica aberta enquanto a janela existe. Ela é ligada sem
`--remote-allow-origins`: a ferramenta não precisa disso, e essa opção deixaria
qualquer página web aberta na máquina ler a sessão.

## Usando um Chrome que você já abriu

```sh
btgpactual login --attach
```

Copia a sessão de um Chrome que você abriu com `--remote-debugging-port=9222`
e onde já está logado. A janela não é fechada, porque não foi a ferramenta que
a abriu.

## O que é gravado, e onde

`~/.config/btgpactual-mcp/session.enc`, cifrado com AES-256-GCM, permissão
0600, contendo:

- o `sessionStorage` e o `localStorage` da origem `app.btgpactual.com`;
- os cookies que o app envia (inclusive os HttpOnly);
- o user agent do navegador do login, repetido pelo navegador de leitura;
- o número da conta de investimento, descoberto no teste.

Nenhuma senha é gravada, porque a ferramenta nunca a vê.

## Ciclo de vida

A sessão do banco expira cerca de uma hora depois do login, mesmo em uso (medido em outubro de 2026); usar não a renova. O cache não expira: as
perguntas continuam respondidas com os dados do último `sync`. Quando o `sync`
disser que a sessão caiu, rode `btgpactual login` de novo. Fechar a janela de
login não derruba a sessão copiada.

## Revogando

- Apague a sessão local: `rm ~/.config/btgpactual-mcp/session.enc`.
- Apague os perfis: `rm -rf ~/.config/btgpactual-mcp/login-chrome ~/.config/btgpactual-mcp/browser-profile`.
- Encerre as sessões no app do BTG (configurações de segurança) se suspeitar
  de qualquer cópia indevida.
