# ADR-0002: Só Bun

Status: Aceito

## Contexto

O cache precisa de SQLite, os testes de um runner e o binário de compilação.
Juntar Node, um driver nativo de SQLite, um runner e um bundler multiplica
dependências e pontos de falha.

## Decisão

Bun 1.3 ou mais novo para tudo: `bun:sqlite`, `bun:test`, `bun build --compile`
e o `WebSocket` nativo usado pelo cliente CDP do login.

## Consequências

Uma dependência de runtime a menos para manter. O pacote npm exige o Bun
instalado, o que o README avisa.
