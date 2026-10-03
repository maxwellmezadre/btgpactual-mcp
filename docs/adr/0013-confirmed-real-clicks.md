# ADR-0013: Cliques reais, confirmados pela própria tela

Status: Aceito

## Contexto

As telas do banco mostram uma fatura e uma página do extrato por vez. A
primeira versão lia só o que vinha na tela, o que deixava de fora a fatura
aberta (o gasto do mês), as futuras (parcelas comprometidas) e a maior parte do
extrato. Trocar de fatura exige clicar numa coluna de um gráfico Highcharts, que
ignora `click()` por JavaScript; e, no carregamento, o gráfico destaca uma
fatura diferente da que a lista mostra.

## Decisão

`Bridge.interact` clica com o mouse real do navegador num ponto devolvido por um
script da página, afasta o ponteiro e espera um script `done` confirmar a
mudança. Para a fatura, `done` exige que a coluna destacada seja a do mês
pedido, que a lista tenha terminado de carregar, que seja diferente da anterior
e que fique parada por um instante; o mês confirmado é marcado no HTML
(`data-btg-selected`) e o parser recusa a lista se ele não bater com o pedido. A
primeira coluna clicada nunca é a da fatura fechada (que já está na lista).
Cliques nunca são repetidos automaticamente: clicar "próximo" duas vezes
pularia uma página.

## Consequências

Um sync traz todas as faturas do gráfico e o extrato inteiro do período, em
cerca de um minuto e meio. Se um clique não produzir a mudança esperada, aquela
etapa falha e nada é gravado com o mês errado. A continuidade das parcelas
(`N/T` num mês, `N+1/T` no seguinte) foi usada para validar a atribuição na
conta real.
