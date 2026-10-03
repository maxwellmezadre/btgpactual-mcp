# ADR-0011: Login num Chrome comum, cópia pela porta de depuração

Status: Aceito

## Contexto

O plano inicial abria o login num Chrome controlado pelo Playwright. O
reCAPTCHA do BTG recusa navegador automatizado, e o login não passava. Além
disso, a sessão mora no `sessionStorage`, que o perfil do Chrome não guarda
entre execuções.

## Decisão

`login` abre o Chrome como processo comum, com perfil próprio e
`--remote-debugging-port`, e um cliente CDP mínimo lê a aba (sessionStorage,
localStorage, cookies, user agent). Antes de gravar, a cópia é testada no
navegador de leitura; uma cópia feita antes de o usuário escolher a conta é
recusada e o login continua esperando. Depois de gravar, a janela é fechada (a
sessão sobrevive a isso). O navegador de leitura restaura a cópia com um
script que roda antes do app.

`--remote-allow-origins` nunca é usado: o cliente não envia `Origin`, que o
Chrome aceita sem a opção, e com `*` qualquer página web aberta na máquina
conseguiria ler a sessão pela porta. O `connectOverCDP` do Playwright foi
descartado: travava nos alvos novos do Chrome 154 e seu `close()` podia fechar
o navegador do usuário.

## Consequências

O usuário faz um login normal numa janela normal. A porta de depuração fica
aberta só durante o login. Importar cookies de outro navegador não faz sentido
aqui (a sessão não está nos cookies), então essa opção da casa não existe.
