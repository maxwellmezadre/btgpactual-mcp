# ADR-0010: Aquisição híbrida por canal

Status: Aceito

## Contexto

O canal de investimentos devolve JSON quando recebe os cabeçalhos de sessão
que o app emite. O canal do banco devolve só conteúdo cifrado.

## Decisão

Investimentos: um gancho em `fetch` e `XMLHttpRequest`, instalado antes do app
carregar, captura os cabeçalhos que o próprio app envia (e o número da conta
das URLs); a ferramenta repete os GETs de dentro da página. Banco: a
ferramenta abre as telas `/cartoes` e `/conta-corrente`, espera as linhas
aparecerem e lê o HTML.

## Consequências

O JSON é estável e rico; as telas mostram só o que está selecionado (uma
fatura, uma página do extrato), então o sync navega nelas com cliques
confirmados (ADR-0013).
