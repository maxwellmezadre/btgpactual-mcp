# ADR-0012: Somente leitura, sem exceção

Status: Aceito

## Contexto

Uma ferramenta com sessão bancária e acesso a um modelo pode, por engano ou
por instrução maliciosa, tentar mover dinheiro.

## Decisão

Não existe código que escreva na conta. `raw_get` aceita só GET em
`/investments/api/`, recusa o canal do banco e caminhos com `..`. A descoberta
de telas clica só em itens de navegação de uma lista fechada. `BTG_READ_ONLY=1`
tira do servidor até o que grava localmente (`login`, `sync`, `export`).

## Consequências

Perguntas como "pague a fatura" ou "faça um Pix" não têm tool, por desenho.
O `verify` confere essas recusas a cada execução do CI.
