# Plano de Ação — view Estratégica e filtro composto

Status: planejado, não implementado.

Relacionado: [[task-model-v2]] (plano de ação como card real, acordeão em `/admin/plano`),
[[CHECKPOINTS-COMERCIAIS]] (checkpoint pode nascer como plano de ação), o componente de
calendário composto descrito em [[PERFORMANCE-CUSTOMIZACAO]] (para ser reaproveitado aqui,
não recriado), e [[CLIENTES-BOTAO-CADASTRO]] (mesmo padrão de botão de criação).

## View Estratégica — quem, quando, porquê

- `Quem`, `Quando` e `Porquê` viram **filtros dropdown em caixa de texto composta**, no
  mesmo padrão visual da box imediatamente superior da tela (mesmo componente do item de
  filtro composto abaixo).
- As informações vêm preenchidas por padrão a partir do card, mas ao clicar no filtro elas
  podem ser editadas/autocompletadas para funcionar como filtro de busca.
- Quando restam **poucos planos visíveis (< 5)** após o filtro, os planos expandem
  automaticamente no dropdown/acordeão (hoje cada plano nasce recolhido, por
  [[task-model-v2]] — este comportamento passa a ser condicional ao total filtrado, não
  sempre recolhido).
- `Porquê` mostra o início da justificativa do plano de ação, e é também onde vivem os
  **templates de plano** pré-definidos: automação de ads, automação de copy, plano de
  melhoria de fluxo de atendimento, automação de agentes de atendimento — ver
  [[AUTOMACOES-IA-HARNESS]] para o desenho completo dessas automações; aqui é só o ponto
  de entrada de "criar plano a partir de template".
- `Quando` abre um **calendário composto de 2 lados com seleção de range** — reaproveitar
  o mesmo componente descrito em [[PERFORMANCE-CUSTOMIZACAO]] (1 box, 2 meses lado a lado,
  reproduzindo o design do `CalendarPicker.tsx`), sem recriar a lógica.

## Filtro composto — trazer a versão certa

**As duas telas de Plano de Ação (Lista e Estratégica) estão com a versão errada do filtro
composto.** A tela de Tarefas já tem uma versão melhor: permite selecionar primeiro o
**atributo**, e só depois o **filtro** daquele atributo — aqui hoje só existem 2 atributos
fixos (sem essa seleção em duas etapas). Portar a mesma tecnologia da tela de Tarefas para
cá, em vez de manter uma implementação paralela mais simples.

Junto com o filtro, trazer para esta tela:

- A **engrenagem de atributos** (mesmo componente/posição de Tarefas).
- A **lista de ordenação** (`SortMenu`, já existe em `app/admin/SortMenu.tsx` e é usado em
  Tarefas/Clientes — ver `memory.md`, seção "Entregue nesta rodada" de 2026-08-19) — deve
  ficar ao lado do botão "+ Plano", no mesmo padrão posicional das outras telas.
- O próprio botão **"+ Plano"** precisa ser **reposicionado e ter o visual atualizado**
  para bater com o padrão das outras telas (mesmo espírito do botão descrito em
  [[CLIENTES-BOTAO-CADASTRO]] — 1 botão principal de criação por tela, no fim da linha do
  toggle/filtro).
