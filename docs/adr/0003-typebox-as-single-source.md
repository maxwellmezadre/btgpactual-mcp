# ADR-0003: TypeBox como fonte única de esquema

Status: Aceito

## Contexto

Cada tool precisa de um tipo estático, de validação em tempo de execução e de
um JSON Schema anunciado ao cliente MCP. Escrever os três à mão é garantia de
divergência.

## Decisão

Um esquema TypeBox por tool é ao mesmo tempo o tipo, o validador e o JSON
Schema. A configuração usa o mesmo mecanismo.

## Consequências

Nada de Zod nem de ponte entre bibliotecas. A spec original pedia Zod; o
padrão da casa venceu.
