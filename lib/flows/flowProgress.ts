// A régua de "casas" de uma etapa dentro de um fluxo em cascata (P1-C).
//
// Fora de um fluxo, STATUS_PCT (lib/taskCatalog.ts) continua valendo do jeito
// que está — `backlog` vale 0%, porque uma Tarefa comum ou um Checkpoint em
// Entrada não fez nenhum trabalho ainda. DENTRO de uma entrega a leitura é
// outra: uma etapa nascer em Entrada já é a prova de que a etapa ANTERIOR foi
// aprovada — é progresso do fluxo como um todo, não zero. É por isso que
// "entrar numa etapa já conta uma casa" é uma regra do FLUXO, e mora aqui, e
// não em STATUS_PCT: mexer no global regrediria o progresso de toda tela que
// usa taskProgress fora de uma entrega (Tarefa solta, Checkpoint, membro de
// Plano que não é etapa).
//
// A régua também não é fixa: quantas paradas (casas) uma etapa atravessa
// depende de revisão/aprovação estarem ligadas PARA AQUELE CARD —
// `requires_review` / `requires_approval`, colunas de `tasks` já derivadas dos
// toggles do cliente em Configurações › Etapas e herdadas da entrega quando a
// etapa nasce (ver lib/flows/stepFields.ts). O sinal é lido direto do card,
// então esta régua fica pura e síncrona — nada de buscar flag no banco aqui.
//
// Tabela fechada pelo usuário (decisão de produto, não reabrir):
//   revisão + aprovação  → 5 casas: entrada 20 / produção 40 / rev 60 / aprov 80 / concluído 100
//   só revisão            → 4 casas: entrada 25 / produção 50 / rev 75 / concluído 100
//   nenhuma das duas      → 3 casas: entrada 33 / produção 67 / concluído 100

import { TASK_STATUSES, type TaskStatus } from "@/lib/validation";

export type FunnelFlags = {
  requires_review?: boolean | null;
  requires_approval?: boolean | null;
};

/** A sequência de status que uma etapa atravessa, na ordem, contendo só as
 * paradas que valem para este card. `backlog` e `em_producao` sempre entram;
 * `aprovado` é sempre o fim; `revisao`/`aprovacao` entram junto com o toggle
 * correspondente do cliente — é esse Boolean() que decide se a régua tem 3, 4
 * ou 5 casas. */
export function flowFunnelStops(flags: FunnelFlags): TaskStatus[] {
  const stops: TaskStatus[] = ["backlog", "em_producao"];
  if (flags.requires_review) stops.push("revisao");
  if (flags.requires_approval) stops.push("aprovacao");
  stops.push("aprovado");
  return stops;
}

/** Quantas casas esta etapa vale, isoladamente — 3, 4 ou 5 conforme a tabela
 * acima. É o "N" que a estratégia chama de "casas por etapa". */
export function flowFunnelSize(flags: FunnelFlags): number {
  return flowFunnelStops(flags).length;
}

/**
 * Casas ACUMULADAS por uma etapa no status atual (1-based: entrar numa etapa
 * já conta uma casa — a regra dura do usuário). `status` fora da régua desta
 * etapa (por exemplo: o card ficou marcado `revisao` antes de o cliente
 * desligar a revisão, e a etapa nunca foi resalva) cai no degrau anterior mais
 * próximo na ordem canônica de `TASK_STATUSES`, nunca em zero — mesma defesa
 * que `statusPct` já fazia em lib/taskCatalog.ts, só que contra uma régua que
 * agora varia de card para card em vez de ser uma constante global.
 */
export function flowStepCasas(status: TaskStatus, flags: FunnelFlags): number {
  const stops = flowFunnelStops(flags);
  const idx = stops.indexOf(status);
  if (idx >= 0) return idx + 1;
  const pos = TASK_STATUSES.indexOf(status);
  for (let i = pos - 1; i >= 0; i--) {
    const j = stops.indexOf(TASK_STATUSES[i]);
    if (j >= 0) return j + 1;
  }
  // Nunca zero: a etapa existe como card, então já entrou em algum lugar da
  // corrente — mesmo que o dado não bata com nenhum degrau conhecido.
  return 1;
}

/** Percentual (0–100) de UMA etapa, isolada, na régua que vale para ela.
 * `taskCatalog.ts` usa isto como o "statusPct" de dentro de um fluxo: é o
 * número que entra na média ponderada pelo peso da etapa (`progress_weight`),
 * exatamente como `statusPct` entrava antes — só a régua por baixo mudou. */
export function flowStepPct(status: TaskStatus, flags: FunnelFlags): number {
  const size = flowFunnelSize(flags);
  if (size <= 0) return 0;
  return Math.round((flowStepCasas(status, flags) / size) * 100);
}
