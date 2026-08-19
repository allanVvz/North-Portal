# Clientes — botão "Novo Cliente" só em Cadastro

Status: planejado, não implementado.

Relacionado: [[PLANO-DE-ACAO-VIEW-ESTRATEGICA]] (mesmo padrão pedido para "+ Plano").

## Problema atual

O botão de criar novo cliente hoje tem um design irregular / posição inconsistente com o
padrão das outras telas.

## Comportamento esperado

- O botão **"Novo Cliente"** só deve estar disponível na sub-aba **"Cadastro"** da tela de
  Clientes (não nas outras sub-abas).
- Deve aparecer **na mesma linha do toggle e do filtro composto**, ao final da linha.
- Deve seguir exatamente o padrão visual/posicional do botão **"+ Nova Tarefa"** das outras
  telas — mesma altura, mesmo espaçamento, mesmo estilo de borda/cor.
- Regra geral confirmada pelo usuário: **1 botão principal de criação por tela** — não
  duplicar em sub-abas onde a ação não faz sentido (ex.: não deve aparecer em sub-abas de
  leitura/relatório de Clientes).
