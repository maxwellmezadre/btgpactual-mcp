# ADR-0007: Dinheiro em centavos inteiros

Status: Aceito

## Contexto

Os dois canais mandam dinheiro de formas diferentes: reais decimais no JSON de
investimentos e texto (`- R$ 1.234,56`) nas telas do banco. Somar decimais em
ponto flutuante acumula erro.

## Decisão

Todo valor vira centavo inteiro na entrada e fica assim no cache; vira reais
só na saída das tools. Texto que não parece dinheiro vira `null`, nunca zero.
Preços unitários (cotas, cripto) ficam em reais sem arredondar, porque nunca
são somados.

## Consequências

`SUM()` no SQLite é exato. Quem lê o cache direto precisa dividir por 100.
