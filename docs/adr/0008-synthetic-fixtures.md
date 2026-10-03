# ADR-0008: Fixtures sintéticas

Status: Aceito

## Contexto

Os outros projetos da casa anonimizam capturas reais para usar como fixture.
Aqui as capturas são extratos bancários: saldos, nomes de terceiros, número de
conta. Um anonimizador que erre uma vez publica isso num repositório público.

## Decisão

As fixtures commitadas são escritas à mão com a estrutura exata das respostas
e telas reais (chaves, classes, aninhamento) e dados inventados, com as
identidades financeiras coerentes. As capturas reais ficam em `task/captures/`
(fora do git) e são verificadas por `test/local/`, que pula no CI. Um teste
falha se o número real da conta ou o nome real do portador do adicional
aparecer em qualquer fixture.

## Consequências

Não existe `anonymize-fixture.ts`. Uma mudança de estrutura no BTG exige
atualizar a fixture à mão, guiada pela captura local.
