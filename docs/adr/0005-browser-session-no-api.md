# ADR-0005: Sessão do navegador, sem API

Status: Aceito

## Contexto

O BTG não oferece API para pessoa física consultar a própria conta. O app web
autentica com senha, reCAPTCHA e verificação em duas etapas, e guarda a sessão
no `sessionStorage`.

## Decisão

A ferramenta usa a sessão de um login feito pelo usuário no app. Nenhuma
credencial é pedida, digitada ou guardada; nenhum passo do login é automatizado.

## Consequências

A sessão expira e o usuário precisa refazer o login de tempos em tempos. Em
troca, a verificação em duas etapas continua com quem é dono da conta, e o
projeto não carrega senha nenhuma.
