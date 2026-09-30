import { describe, expect, it } from "vitest";
import { projectCardConversation, type ConversationTask } from "./cardConversation";

const task = (id: string, title: string, patch: Partial<ConversationTask> = {}): ConversationTask => ({
  id, client_id: "client-a", kind: "plano_acao", subtype: null, title,
  payload: { comments: [{ id: `${id}-comment`, author: "Ana", author_id: "user-a", text: `Comentário ${id}`, at: "2026-09-16T13:00:00Z" }] },
  plan_id: null, recurrence_cadence: null, due_date: null, workflow_version_id: null, parents: [], ...patch,
});
const links = (...rows: Array<[string, string, string?]>) => rows.map(([parent_id, child_id, relation_kind = "structural_member"]) => ({ parent_id, child_id, relation_kind }));

describe("card conversation projection", () => {
  it("shows the full linked plan history on the 16/09 meeting and each explicitly linked meeting", () => {
    const meeting = task("meeting-16", "Rotina Allan · 16/09", { kind: "rotina", recurrence_cadence: null, payload: { recurrence_parent_id: "template", occurrence_date: "2026-09-16", comments: [] } });
    const plan = task("plan", "Plano Allan");
    const activity = task("activity", "Atividade");
    const cycle17 = task("meeting-17", "Rotina Allan · 17/09", { kind: "rotina", payload: { recurrence_parent_id: "template", occurrence_date: "2026-09-17", comments: [] } });
    const relations = { taskLinks: links(["plan", "activity"]), routineLinks: [
      { template_id: "template", cycle_id: meeting.id, occurrence_date: "2026-09-16", task_id: plan.id },
      { template_id: "template", cycle_id: cycle17.id, occurrence_date: "2026-09-17", task_id: plan.id },
    ] };
    const tasks = [meeting, cycle17, plan, activity];
    const on16 = projectCardConversation({ rootId: meeting.id, tasks, relations });
    const on17 = projectCardConversation({ rootId: cycle17.id, tasks, relations });
    expect(on16.filter((item) => item.kind === "comment").map((item) => item.text).sort()).toEqual(["Comentário plan", "Comentário activity"].sort());
    expect(on16.every((item) => item.meetingDate === "2026-09-16")).toBe(true);
    expect(on17.filter((item) => item.kind === "comment").map((item) => item.text).sort()).toEqual(["Comentário plan", "Comentário activity"].sort());
    expect(on17.every((item) => item.meetingDate === "2026-09-17")).toBe(true);
  });

  it("a template includes its cycles while an occurrence never imports sibling history", () => {
    const template = task("template", "Rotina", { kind: "rotina", recurrence_cadence: "semanal" });
    const one = task("one", "Ciclo 1", { kind: "rotina", plan_id: template.id, payload: { recurrence_parent_id: template.id, occurrence_date: "2026-09-16", comments: [{ id: "one", author: "A", text: "semana um", at: "2026-09-16" }] } });
    const two = task("two", "Ciclo 2", { kind: "rotina", plan_id: template.id, payload: { recurrence_parent_id: template.id, occurrence_date: "2026-09-23", comments: [{ id: "two", author: "A", text: "semana dois", at: "2026-09-23" }] } });
    const tasks = [template, one, two];
    expect(projectCardConversation({ rootId: template.id, tasks, relations: { taskLinks: [], routineLinks: [] } }).filter((i) => i.kind === "comment").map((i) => i.text).sort()).toEqual(["Comentário template", "semana um", "semana dois"].sort());
    expect(projectCardConversation({ rootId: one.id, tasks, relations: { taskLinks: [], routineLinks: [] } }).filter((i) => i.kind === "comment").map((i) => i.text)).toEqual(["semana um"]);
  });

  it("keeps a shared stage event and comments scoped to the selected delivery", () => {
    const delivery = task("delivery", "Entrega", { workflow_version_id: "workflow", payload: { comments: [] } });
    const other = task("other", "Outra entrega", { workflow_version_id: "workflow", payload: { comments: [] } });
    const stage = task("stage", "Edição", { workflow_version_id: null, payload: { comments: [
      { id: "mine", author: "A", text: "desta entrega", at: "2026-09-16", for_task_id: delivery.id },
      { id: "theirs", author: "B", text: "da outra entrega", at: "2026-09-16", for_task_id: other.id },
    ] } });
    const base = { tasks: [delivery, other, stage], relations: { taskLinks: links([delivery.id, stage.id, "workflow_step"], [other.id, stage.id, "workflow_step"]), routineLinks: [] } };
    const events = [
      { id: "e1", task_id: stage.id, event_type: "review_approved", body: "Aprovado", created_at: "2026-09-16", delivery_id: delivery.id },
      { id: "e2", task_id: stage.id, event_type: "review_approved", body: "Outro", created_at: "2026-09-16", delivery_id: other.id },
    ];
    const projected = projectCardConversation({ ...base, rootId: delivery.id, events });
    expect(projected.map((item) => item.text).sort()).toEqual(["Aprovado", "desta entrega"].sort());
    expect(projected.some((item) => item.text === "da outra entrega" || item.text === "Outro")).toBe(false);
  });

  it("the shared stage opened on its own shows what every delivery wrote in it", () => {
    const delivery = task("delivery", "Entrega", { workflow_version_id: "workflow", payload: { comments: [] } });
    const other = task("other", "Outra entrega", { workflow_version_id: "workflow", payload: { comments: [] } });
    const stage = task("stage", "Edição", { payload: { comments: [
      { id: "mine", author: "A", text: "desta entrega", at: "2026-09-16", for_task_id: delivery.id },
      { id: "theirs", author: "B", text: "da outra entrega", at: "2026-09-16", for_task_id: other.id },
      { id: "own", author: "C", text: "na etapa", at: "2026-09-16" },
    ] } });
    const relations = { taskLinks: links([delivery.id, stage.id, "workflow_step"], [other.id, stage.id, "workflow_step"]), routineLinks: [] };
    const events = [{ id: "e1", task_id: stage.id, event_type: "review_approved", body: "Aprovado", created_at: "2026-09-16", delivery_id: delivery.id }];
    const projected = projectCardConversation({ rootId: stage.id, tasks: [delivery, other, stage], relations, events });
    expect(projected.map((item) => item.text).sort()).toEqual(["Aprovado", "da outra entrega", "desta entrega", "na etapa"].sort());
  });

  it("deduplicates repeated source items and keeps generated PDFs plus preview/final versions", () => {
    const root = task("root", "Plano");
    const source = task("source", "Relatório");
    const tasks = [root, source];
    const relations = { taskLinks: links([root.id, source.id]), routineLinks: [] };
    const document = { id: "pdf", client_id: "client-a", task_id: source.id, source_task_id: source.id, name: "relatorio.pdf", file_url: "https://files.test/report.pdf", mime_type: "application/pdf", source_document_id: null, version_number: 3, created_at: "2026-09-16" };
    const asset = { id: "final", client_id: "client-a", creative_task_id: source.id, role: "final", state: "active", version_number: 2, drive_file_id: "file-final", name: "final.pdf", web_view_link: "https://drive.test/final", created_at: "2026-09-17" };
    const preview = { ...asset, id: "preview", role: "preview", version_number: undefined, name: "preview.pdf" };
    const raw = { ...asset, id: "raw", role: "raw", name: "raw.mp4" };
    const projected = projectCardConversation({ rootId: root.id, tasks, relations, documents: [document, document], driveAssets: [asset, preview, raw] });
    expect(projected.filter((item) => item.kind === "file").map((item) => item.id)).toEqual(["document:pdf", "drive:final", "drive:preview"]);
    expect(projected.find((item) => item.id === "document:pdf")?.file).toMatchObject({ version_number: 3 });
  });

  it("filters tasks and file rows before aggregation for the client portal", () => {
    const root = task("root", "Plano");
    const foreign = task("foreign", "Outro cliente", { client_id: "client-b" });
    const projected = projectCardConversation({
      rootId: root.id, clientId: "client-a", tasks: [root, foreign],
      relations: { taskLinks: links([root.id, foreign.id]), routineLinks: [] },
      documents: [
        { id: "foreign-doc", client_id: "client-b", task_id: root.id, name: "segredo.pdf" },
        { id: "visible-with-foreign-origin", client_id: "client-a", task_id: root.id, source_task_id: root.id, source_document_id: "foreign-doc", name: "publico.pdf" },
      ],
      driveAssets: [{ id: "foreign-drive", client_id: "client-b", creative_task_id: root.id, role: "final", state: "active" }],
    });
    expect(projected.every((item) => item.taskId === root.id)).toBe(true);
    expect(projected.filter((item) => item.kind === "file")).toHaveLength(1);
    expect(projected.find((item) => item.kind === "file")?.file?.sourceDocument).toBeNull();
  });
});
