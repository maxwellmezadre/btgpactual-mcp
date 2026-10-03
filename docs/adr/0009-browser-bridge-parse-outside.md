# ADR-0009: Navegador obrigatório, parsing fora dele

Status: Aceito

## Contexto

O canal do banco é cifrado pelo próprio app com uma criptografia ofuscada que
muda a cada deploy, e a sessão só existe dentro de uma página autenticada.

## Decisão

Um único Chrome headless, com a sessão restaurada, atende os dois canais. O
navegador só entrega texto (JSON de investimentos ou HTML já desenhado, sem
scripts nem estilos); os parsers são funções puras em Node, testadas sem
navegador.

## Consequências

Nunca se reimplementa a criptografia, então um deploy do BTG não a quebra. O
`sync` é mais lento que uma API (dezenas de segundos) e depende do Chrome
instalado.
