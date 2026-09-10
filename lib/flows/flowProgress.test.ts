import { describe, expect, it } from "vitest";
import { FLOW_TOTAL_WEIGHT_KEY, dedupePlanMembers, taskProgress } from "@/lib/taskCatalog";
import { flowFunnelSize, flowFunnelStops, flowStepCasas, flowStepPct } from "./flowProgress";
import { mirroredParentStatus } from "./parentStatus";
import type { TaskStatus } from "@/lib/validation";

// step() agora aceita as flags de revisão/aprovação — default sem nenhuma das
// duas (3 casas), o degrau mais raso da tabela. Testes que precisam de 4 ou 5
// casas passam as flags explicitamente.
const step = (
  status: TaskStatus,
  id: string = status,
  progress_weight = 1,
  flags: { requires_review?: boolean; requires_approval?: boolean } = {},
) => ({ id, kind: "criativo", status, progress_weight, payload: {}, ...flags });

// A entrega é reconhecida pela marca no payload, não pelo tipo: existem cards
// `criativo` legados que são trabalho comum e não podem virar pais.
const delivery = (totalWeight: number, flags: { requires_review?: boolean; requires_approval?: boolean } = {}) => ({
  id: "entrega",
  kind: "criativo",
  status: "em_producao" as TaskStatus,
  progress_weight: 1,
  payload: { flow_parent: true, [FLOW_TOTAL_WEIGHT_KEY]: totalWeight },
  ...flags,
});

// ---- lib/flows/flowProgress.ts — a régua de casas, isolada -------------------
//
// Tabela fechada pelo usuário (plan/ESTRATEGIA-FLUXOS.md P1-C): quantas casas
// uma etapa vale depende só de revisão/aprovação estarem ligadas PARA AQUELE
// CARD. Testada aqui em isolamento antes de entrar na média ponderada do
// rollup, porque é a peça nova e a mais fácil de errar por um só ("off by one").
describe("flowFunnelStops / flowStepCasas — a régua de casas por etapa", () => {
  it("revisão + aprovação: 5 casas — entrada 20 / produção 40 / rev 60 / aprov 80 / concluído 100", () => {
    const flags = { requires_review: true, requires_approval: true };
    expect(flowFunnelSize(flags)).toBe(5);
    expect(flowStepPct("backlog", flags)).toBe(20);
    expect(flowStepPct("em_producao", flags)).toBe(40);
    expect(flowStepPct("revisao", flags)).toBe(60);
    expect(flowStepPct("aprovacao", flags)).toBe(80);
    expect(flowStepPct("aprovado", flags)).toBe(100);
  });

  it("só revisão (sem aprovação): 4 casas — entrada 25 / produção 50 / rev 75 / concluído 100", () => {
    const flags = { requires_review: true, requires_approval: false };
    expect(flowFunnelSize(flags)).toBe(4);
    expect(flowStepPct("backlog", flags)).toBe(25);
    expect(flowStepPct("em_producao", flags)).toBe(50);
    expect(flowStepPct("revisao", flags)).toBe(75);
    expect(flowStepPct("aprovado", flags)).toBe(100);
  });

  it("nenhuma das duas: 3 casas — entrada 33 / produção 67 / concluído 100", () => {
    const flags = { requires_review: false, requires_approval: false };
    expect(flowFunnelSize(flags)).toBe(3);
    expect(flowStepPct("backlog", flags)).toBe(33);
    expect(flowStepPct("em_producao", flags)).toBe(67);
    expect(flowStepPct("aprovado", flags)).toBe(100);
  });

  it("entrar numa etapa já conta uma casa — backlog nunca é 0 dentro da régua do fluxo", () => {
    // O contraste que motivou a mudança: STATUS_PCT.backlog (fora do fluxo)
    // continua 0; flowStepCasas (dentro do fluxo) começa em 1.
    expect(flowStepCasas("backlog", { requires_review: true, requires_approval: true })).toBe(1);
  });

  it("uma etapa marcada revisao depois que o cliente desligou a revisão cai no degrau anterior, não em zero", () => {
    // Regra órfã: a régua atual não tem "revisao", mas o card ainda existe —
    // mesma defesa que statusPct já fazia contra um status fora do mapa.
    const flags = { requires_review: false, requires_approval: false };
    expect(flowStepCasas("revisao", flags)).toBe(flowStepCasas("em_producao", flags));
  });
});

describe("progresso de uma entrega em cascata", () => {
  // O erro que motivou o snapshot: com só a primeira etapa materializada, um
  // rollup sobre "os membros que existem" dá 100% e o cliente vê a peça como
  // pronta antes de existir gravação, edição ou publicação.
  it("conta as etapas que ainda não nasceram no denominador", () => {
    expect(taskProgress(delivery(4), [step("aprovado", "roteiro")])).toBe(25);
  });

  it("chega a 100% só quando todas as etapas do molde existem e terminaram", () => {
    const all = [
      step("aprovado", "roteiro"),
      step("aprovado", "captacao"),
      step("aprovado", "edicao"),
      step("aprovado", "publicacao"),
    ];
    expect(taskProgress(delivery(4), all)).toBe(100);
  });

  // Cliente sem revisão e sem aprovação: 3 casas por etapa (a régua mais rasa
  // da tabela). roteiro concluído (3/3 = 100%) + captação em produção
  // (2/3 ≈ 67%) sobre 4 etapas: (100 + 67) / 4 = 41,75.
  it("pondera a etapa parcial pela régua de casas do molde, não pela contagem de membros", () => {
    const flags = { requires_review: false, requires_approval: false };
    expect(
      taskProgress(delivery(4, flags), [
        step("aprovado", "roteiro", 1, flags),
        step("em_producao", "captacao", 1, flags),
      ]),
    ).toBe(42);
  });

  it("é 0 quando nenhuma etapa foi materializada ainda", () => {
    expect(taskProgress(delivery(4), [])).toBe(0);
  });

  // O snapshot é congelado de propósito: editar o molde não pode reescrever o
  // progresso de entregas que já estão em andamento com outra forma.
  it("usa o peso congelado, e não o molde vigente", () => {
    const frozen = delivery(4);
    expect(taskProgress(frozen, [step("aprovado", "roteiro")])).toBe(25);
  });

  it("cai para o peso dos membros quando o snapshot sumiu (molde apagado)", () => {
    const orphan = { ...delivery(0), payload: { flow_parent: true } };
    expect(taskProgress(orphan, [step("aprovado", "roteiro")])).toBe(100);
  });

  // O exemplo do usuário (P1-C): 4 etapas, cliente com revisão mas sem
  // aprovação (4 casas/etapa — 16 casas no total). Roteiro concluído vale as 4
  // casas dele; captação, só de nascer em Entrada, já vale a 1ª casa própria —
  // que é a 5ª casa do total de 16. 5/16 = 31,25%.
  it("roteiro concluído + captação em Entrada ≈ 31–32%, com revisão e sem aprovação", () => {
    const flags = { requires_review: true, requires_approval: false };
    const pct = taskProgress(delivery(4, flags), [
      step("aprovado", "roteiro", 1, flags),
      step("backlog", "captacao", 1, flags),
    ]);
    expect(pct).toBe(31);
    expect(pct).toBeGreaterThanOrEqual(31);
    expect(pct).toBeLessThanOrEqual(32);
  });

  // Generalização para 5 etapas (revisão + aprovação — 5 casas/etapa, 25 no
  // total): duas concluídas (10 casas) + uma em revisão (3ª casa da régua de
  // 5) = 13/25 = 52%.
  it("generaliza para um fluxo de 5 etapas", () => {
    const flags = { requires_review: true, requires_approval: true };
    const pct = taskProgress(delivery(5, flags), [
      step("aprovado", "roteiro", 1, flags),
      step("aprovado", "captacao", 1, flags),
      step("revisao", "edicao", 1, flags),
    ]);
    expect(pct).toBe(52);
  });

  // Molde recorrente: o denominador continua vindo dos FILHOS (as ocorrências),
  // nunca do peso congelado — flowTotalWeight devolve 0 de propósito para quem
  // carrega recurrence_group, então este teste também prova que a régua de
  // casas não se intromete nesse caminho (a ocorrência é ela mesma um rollup,
  // não uma etapa-folha, e cai no ramo antigo dentro de rollupProgress).
  it("molde de entrega recorrente continua dividindo pelas ocorrências, não pela régua de casas", () => {
    const molde = {
      id: "molde",
      kind: "criativo",
      status: "em_producao" as TaskStatus,
      progress_weight: 1,
      payload: { flow_parent: true, recurrence_group: true },
    };
    const ocorrencia1 = delivery(4, { requires_review: true, requires_approval: false });
    const byParent = new Map([
      ["entrega", [step("aprovado", "roteiro", 1, { requires_review: true, requires_approval: false })]],
    ]);
    // 1 ocorrência, 25% de progresso dela mesma (1 de 4 etapas, aprovada) →
    // o molde rola 25% também, e não algum número vindo de uma régua de casas
    // aplicada diretamente à ocorrência.
    expect(taskProgress(molde, [ocorrencia1], byParent)).toBe(25);
  });
});

// A regra de "a Entrega conta como UM item": se alguém ligar também as etapas
// ao mesmo Plano, a peça pesaria cinco vezes na média.
describe("dedupePlanMembers — a peça não conta cinco vezes", () => {
  it("tira do peso a etapa que já pertence a uma Entrega da mesma lista", () => {
    const entrega = delivery(4);
    const roteiro = step("aprovado", "roteiro");
    const avulsa = { id: "avulsa", kind: "operacional", status: "aprovado" as TaskStatus, progress_weight: 1, payload: {} };
    const byParent = new Map([["entrega", [roteiro]]]);

    // Alguém ligou a entrega E o roteiro dela ao mesmo plano.
    const membros = [entrega, roteiro, avulsa];
    expect(dedupePlanMembers(membros, byParent).map((m) => m.id)).toEqual(["entrega", "avulsa"]);
  });

  it("sem o mapa não há o que deduzir, e nada é removido", () => {
    const entrega = delivery(4);
    expect(dedupePlanMembers([entrega], undefined)).toEqual([entrega]);
  });

  // Entrega dentro de um Plano de Ação: a peça pesa 1 (o próprio progresso
  // rolado dela), nunca 5 — nem depois da régua de casas mudar o QUANTO cada
  // etapa vale por dentro, o peso da entrega para FORA continua sendo o dela
  // mesma como um item só.
  it("a entrega pesa 1 no Plano, mesmo com a régua de casas mudando o progresso interno dela", () => {
    const plano = { id: "plano", kind: "plano_acao", status: "backlog" as TaskStatus, progress_weight: 1 };
    const flags = { requires_review: true, requires_approval: false };
    const entrega = delivery(4, flags);
    const byParent = new Map([["entrega", [step("aprovado", "roteiro", 1, flags), step("backlog", "captacao", 1, flags)]]]);
    // A entrega sozinha, pela régua de 4 casas: 31% (mesmo cálculo do teste
    // "roteiro concluído + captação em Entrada" acima). Como ela é o único
    // membro do plano, o plano rola exatamente esse número — prova de que ela
    // entrou como 1 item, não como 5 casas soltas.
    expect(taskProgress(plano, [entrega], byParent)).toBe(31);
  });
});

describe("rollup aninhado", () => {
  // Bug pré-existente que a cascata tornaria regra: taskProgress era chamado
  // recursivamente sem os filhos do membro, então um pai dentro de outro pai
  // respondia 0 honestamente e derrubava a média de fora.
  it("resolve uma entrega que é membro de um Plano de Ação", () => {
    const plano = { id: "plano", kind: "plano_acao", status: "backlog" as TaskStatus, progress_weight: 1 };
    const entrega = delivery(4);
    const byParent = new Map([["entrega", [step("aprovado", "roteiro"), step("aprovado", "captacao")]]]);

    expect(taskProgress(plano, [entrega], byParent)).toBe(50);
    // Sem o mapa, o comportamento antigo (0) permanece — nenhum call site quebra.
    expect(taskProgress(plano, [entrega])).toBe(0);
  });

  it("não estoura a pilha com um grafo cíclico", () => {
    const a = { id: "a", kind: "plano_acao", status: "backlog" as TaskStatus, progress_weight: 1 };
    const b = { id: "b", kind: "plano_acao", status: "backlog" as TaskStatus, progress_weight: 1 };
    const byParent = new Map([["a", [b]], ["b", [a]]]);
    expect(() => taskProgress(a, [b], byParent)).not.toThrow();
  });
});

// A restrição do usuário: "a barra de progresso não deve voltar". O status
// espelhado do pai (lib/flows/parentStatus.ts#mirroredParentStatus) PODE
// retroceder — a etapa seguinte nasce em Entrada de novo — mas o progresso
// nunca pode, porque ele soma casas de TODAS as etapas materializadas,
// concluídas inclusive, e uma etapa concluída nunca perde a casa que já tem.
describe("monotonicidade: progresso nunca recua enquanto o status espelhado sobe e desce", () => {
  it("percorre a corrente inteira de um fluxo de 4 etapas", () => {
    const flags = { requires_review: true, requires_approval: false }; // 4 casas/etapa
    const STEP_KEYS = ["roteiro", "captacao", "edicao", "publicacao"];
    const molde = delivery(4, flags);

    // Cada etapa passa por backlog → em_producao → revisao → aprovado (a
    // régua de 4 casas para este cliente). Etapas já concluídas ficam no
    // array de membros junto com a etapa "corrente" — exatamente como o board
    // acumula linhas no banco: nada é removido quando a próxima nasce.
    const sequence: TaskStatus[] = ["backlog", "em_producao", "revisao", "aprovado"];

    const progresses: number[] = [];
    const mirroredStatuses: TaskStatus[] = [];

    for (let stepIndex = 0; stepIndex < STEP_KEYS.length; stepIndex++) {
      for (const status of sequence) {
        // Etapas anteriores já concluídas: completed_at preenchido, então
        // `mirroredParentStatus` as reconhece como passado e pula para a
        // corrente — igual ao trigger `tasks_sync_completed_at` no banco.
        const done = STEP_KEYS.slice(0, stepIndex).map((key) => ({
          ...step("aprovado", key, 1, flags),
          completed_at: "2026-09-01T00:00:00Z",
        }));
        const current = { ...step(status, STEP_KEYS[stepIndex], 1, flags), completed_at: status === "aprovado" ? "2026-09-01T00:00:00Z" : null };
        const members = [...done, current];

        progresses.push(taskProgress(molde, members));
        // A corrente inteira, na ordem — é isto que mirroredParentStatus lê
        // para decidir o status do pai.
        mirroredStatuses.push(mirroredParentStatus(members)!);
      }
    }

    // Monotonicidade: cada passo é >= o anterior, do primeiro ao último.
    for (let i = 1; i < progresses.length; i++) {
      expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
    }
    // Termina em 100% (as 4 etapas, aprovadas).
    expect(progresses[progresses.length - 1]).toBe(100);

    // E, no entanto, o status espelhado sobe e desce: a etapa 1 chega a
    // "revisao" (índice 2 na ordem de TASK_STATUSES) e a etapa 2 recomeça em
    // "backlog" (índice 0) — uma queda no status, sem queda no progresso.
    const idxRevisaoDaEtapa1 = sequence.length - 2; // "revisao", penúltimo da régua de 4
    const idxBacklogDaEtapa2 = sequence.length; // primeiro item da 2ª etapa
    expect(mirroredStatuses[idxRevisaoDaEtapa1]).toBe("revisao");
    expect(mirroredStatuses[idxBacklogDaEtapa2]).toBe("backlog");
    expect(progresses[idxBacklogDaEtapa2]).toBeGreaterThan(progresses[idxRevisaoDaEtapa1]);

    // A transição "roteiro concluído → captação em Entrada" do exemplo do
    // usuário está literalmente nesta corrida: é o salto do índice 3 (fim da
    // 1ª etapa, aprovado) para o índice 4 (início da 2ª, backlog).
    expect(progresses[3]).toBe(25); // roteiro só, aprovado: 4/16
    expect(progresses[4]).toBe(31); // + captação em Entrada: 5/16
  });
});
