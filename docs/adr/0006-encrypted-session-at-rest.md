# ADR-0006: Sessão cifrada em repouso

Status: Aceito

## Contexto

A cópia da sessão dá acesso à conta enquanto valer. Um arquivo em texto puro
na pasta de configuração é um vazamento esperando acontecer.

## Decisão

`session.enc` com AES-256-GCM, gravado de forma atômica com permissão 0600. A
chave vem de `BTG_SESSION_KEY` ou de um `session.key` gerado (0600). Os valores
da sessão entram na redação dos logs.

## Consequências

Copiar só o `session.enc` não basta para usar a sessão. Perder a chave obriga
a um novo login, o que é aceitável.
