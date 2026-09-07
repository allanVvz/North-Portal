import { describe, expect, it } from "vitest";
import { notifiableChange, taskUpdatedMessage, type TaskChangeShape } from "./notifiableChange";

function card(over: Partial<TaskChangeShape> = {}): TaskChangeShape {
  return {
    id: "t1",
    title: "Post de lançamento",
    status: "em_producao",
    reviewer_id: null,
    approver_id: null,
    payload: {},
    assignee_profile_ids: [],
    position: 10,
    due_date: null,
    start_date: null,
    end_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    priority: "media",
    description: null,
    kind: "operacional",
    subtype: null,
    client_id: "c1",
    client_visible: false,
    assignee: null,
    plan_id: null,
    progress_weight: 1,
    requires_review: false,
    requires_approval: false,
    recurrence_cadence: null,
    recurrence_weekdays: [],
    recurrence_day_of_month: null,
    completed_at: null,
    updated_at: "2026-09-06T10:00:00Z",
    ...over,
  };
}

describe("o que NÃO notifica", () => {
  // O motivo de existir deste módulo: arrastar um card no quadro manda um PATCH
  // por card RENUMERADO, e os vizinhos avisavam "foi editado" para gente que
  // nem tinha aberto o card.
  it("posição sozinha é silêncio — é o arrasto do Kanban", () => {
    const antes = card({ position: 10 });
    const depois = card({ position: 40, updated_at: "2026-09-06T11:00:00Z" });
    expect(notifiableChange(antes, depois)).toEqual({ fanout: null, direct: [] });
  });

  // `patchWithTopPosition` injeta um position novo em todo PATCH que não mande
  // um, então um salvamento que não mudou nada ainda chega aqui com diferença.
  it("salvamento sem mudança nenhuma é silêncio", () => {
    expect(notifiableChange(card(), card({ updated_at: "2026-09-06T12:00:00Z" })).fanout).toBeNull();
  });

  it("comentário novo não passa por aqui — quem avisa é a rota de comentários", () => {
    const antes = card({ payload: { comments: [{ author: "Ana", text: "oi", at: "2026-09-06T10:00:00Z" }] } });
    const depois = card({
      payload: { comments: [{ author: "Ana", text: "oi", at: "2026-09-06T10:00:00Z" }, { author: "Bia", text: "ok", at: "2026-09-06T11:00:00Z" }] },
    });
    expect(notifiableChange(antes, depois).fanout).toBeNull();
  });

  // A lista branca de payload existe para isto: o bookkeeping das automações
  // muda o payload o tempo todo e não é acontecimento para ninguém.
  it("bookkeeping de recorrência e automação no payload é invisível", () => {
    const antes = card({ payload: { recurrence_cycle: 3, trafego_report_at: "2026-09-01" } });
    const depois = card({ payload: { recurrence_cycle: 4, trafego_report_at: "2026-09-08", pre_parada_status: "revisao" } });
    expect(notifiableChange(antes, depois).fanout).toBeNull();
  });

  // completed_at é carimbado por trigger a partir do status; contá-lo faria a
  // mesma mudança ser avisada duas vezes.
  it("completed_at sem mudança de status é silêncio", () => {
    expect(notifiableChange(card(), card({ completed_at: "2026-09-06T12:00:00Z" })).fanout).toBeNull();
  });
});

describe("o que notifica, e com qual tipo", () => {
  it("status vira task_status_changed com o rótulo da coluna", () => {
    const { fanout } = notifiableChange(card(), card({ status: "aprovado" }));
    expect(fanout?.type).toBe("task_status_changed");
    expect(fanout?.message).toBe('"Post de lançamento" mudou para Concluído.');
  });

  it("o card arrastado de coluna ainda avisa, mesmo mudando de posição junto", () => {
    const { fanout } = notifiableChange(card({ position: 10 }), card({ status: "revisao", position: 0 }));
    expect(fanout?.type).toBe("task_status_changed");
  });

  it("prazo tem tipo próprio e a mensagem já traz a data nova", () => {
    const { fanout } = notifiableChange(card(), card({ due_date: "2026-09-15" }));
    expect(fanout?.type).toBe("task_due_changed");
    expect(fanout?.message).toBe('"Post de lançamento": prazo para 15/09/2026.');
  });

  it("prazo removido diz que foi removido", () => {
    const { fanout } = notifiableChange(card({ due_date: "2026-09-15" }), card({ due_date: null }));
    expect(fanout?.message).toContain("removido");
  });

  it("edição de conteúdo nomeia os campos em vez de dizer só 'foi editado'", () => {
    const { fanout } = notifiableChange(card(), card({ title: "Outro título", description: "agora tem" }));
    expect(fanout?.type).toBe("task_updated");
    expect(fanout?.message).toBe('"Outro título": título e descrição alterados.');
  });

  it("visibilidade para o cliente conta como edição", () => {
    expect(notifiableChange(card(), card({ client_visible: true })).fanout?.type).toBe("task_updated");
  });

  it("chave observada do payload conta como edição", () => {
    const { fanout } = notifiableChange(card({ payload: { formato: "reels" } }), card({ payload: { formato: "carrossel" } }));
    expect(fanout?.type).toBe("task_updated");
    expect(fanout?.message).toContain("formato");
  });

  // Um salvamento é um acontecimento só. Avisar "mudou para Revisão" e "prazo
  // alterado" pelo mesmo save conta a mesma coisa duas vezes.
  it("status ganha de data, que ganha de edição — uma linha por salvamento", () => {
    const tudo = card({ status: "revisao", due_date: "2026-09-20", title: "Novo" });
    expect(notifiableChange(card(), tudo).fanout?.type).toBe("task_status_changed");

    const semStatus = card({ due_date: "2026-09-20", title: "Novo" });
    expect(notifiableChange(card(), semStatus).fanout?.type).toBe("task_due_changed");
  });
});

describe("atribuição vai direto, não pelo leque", () => {
  it("quem entra como responsável recebe; quem já estava, não", () => {
    const antes = card({ assignee_profile_ids: ["p1"] });
    const depois = card({ assignee_profile_ids: ["p1", "p2"] });
    const { direct } = notifiableChange(antes, depois);
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({ profileId: "p2", role: "responsavel" });
    expect(direct[0].message).toContain("responsável");
  });

  // "Você não é mais responsável" não é uma tarefa que alguém precise fazer.
  it("sair do card não gera aviso", () => {
    const antes = card({ assignee_profile_ids: ["p1", "p2"] });
    const depois = card({ assignee_profile_ids: ["p1"] });
    expect(notifiableChange(antes, depois).direct).toEqual([]);
  });

  it("aprovador novo é avisado", () => {
    const { direct } = notifiableChange(card(), card({ approver_id: "p3" }));
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({ profileId: "p3", role: "aprovador" });
  });

  // O trigger notify_task_reviewer_assigned já manda o aviso dedicado quando o
  // card entra em revisão; os dois juntos seriam a mesma frase duas vezes.
  it("revisor entrando junto com o status 'revisao' NÃO duplica o trigger do banco", () => {
    const { direct } = notifiableChange(card(), card({ reviewer_id: "p4", status: "revisao" }));
    expect(direct).toEqual([]);
  });

  it("revisor trocado fora de 'revisao' é avisado — é o buraco que o trigger não cobre", () => {
    const { direct } = notifiableChange(card(), card({ reviewer_id: "p4", status: "em_producao" }));
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({ profileId: "p4", role: "revisor" });
  });

  it("atribuir e mudar o status no mesmo save são dois fatos para duas plateias", () => {
    const { fanout, direct } = notifiableChange(card(), card({ status: "revisao", assignee_profile_ids: ["p5"] }));
    expect(fanout?.type).toBe("task_status_changed");
    expect(direct).toHaveLength(1);
  });
});

describe("mensagem de edição", () => {
  it("cai no texto genérico só quando não sabe o campo", () => {
    expect(taskUpdatedMessage("X")).toBe('"X" foi editado.');
    expect(taskUpdatedMessage("X", ["título"])).toBe('"X": título alterado.');
    expect(taskUpdatedMessage("X", ["título", "prazo", "prioridade"])).toBe('"X": título, prazo e prioridade alterados.');
  });
});
