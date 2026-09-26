import { beforeEach, describe, expect, it, vi } from "vitest";

const drive = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/googleDriveApi", () => ({
  isGoogleDriveConfigured: () => true,
  listFolderFilesPage: drive.list,
  getDriveItemMetadata: vi.fn(),
  moveDriveItemBetweenFolders: vi.fn(),
}));

import { createFakeTaskDb, type Row } from "@/lib/testing/fakeTaskDb";
import { applyCaptureHomeArrivals, applyEditHomeArrival, creativesFollowingStage } from "./homeArrival";
import { isCreativeStatusScope, resolveStepResponsible, statusChangeText } from "./statusComments";

const ALLAN = "p-allan";
const LUIZA = "p-luiza";
const ALISSON = "p-alisson";

const profiles = [
  { id: ALLAN, full_name: "Allan" },
  { id: LUIZA, full_name: "Luiza" },
  { id: ALISSON, full_name: "Alisson" },
];

const link = (parent: string, child: string, override: string | null = null) => ({
  parent_id: parent, child_id: child, relation_kind: "workflow_step", status_override: override,
});

function world(extra: { tasks?: Row[]; links?: Row[]; assignees?: Row[]; captures?: Row[]; creativeWorkspaces?: Row[] } = {}) {
  const db = createFakeTaskDb({
    tasks: [
      { id: "criativo-a", kind: "criativo", title: "Divulgação", workflow_version_id: "wv", status: "backlog", payload: { comments: [] } },
      { id: "criativo-b", kind: "criativo", title: "Promoções", workflow_version_id: "wv", status: "backlog", payload: { comments: [] } },
      { id: "edicao", kind: "operacional", subtype: "edicao", title: "Edição — 6 Reels", status: "revisao", assignee: "Allan", payload: { comments: [] } },
      { id: "roteiro", kind: "operacional", subtype: "roteiro", title: "Roteiro do bloco", status: "em_producao", assignee: "Luiza", payload: { comments: [] } },
      { id: "captacao", kind: "operacional", subtype: "captacao", title: "Gravação do bloco", status: "em_producao", assignee: "Alisson", payload: { comments: [] } },
      { id: "relatorio", kind: "operacional", subtype: "relatorio_conversao", title: "Relatório", status: "revisao", payload: { comments: [] } },
      { id: "entrega-relatorio", kind: "automacao", title: "Relatórios", workflow_version_id: "wv2", status: "revisao", payload: { comments: [] } },
      ...(extra.tasks ?? []),
    ],
    task_links: extra.links ?? [
      link("criativo-a", "edicao", "em_producao"), link("criativo-b", "edicao"),
      link("criativo-a", "roteiro"), link("criativo-b", "roteiro"),
      link("entrega-relatorio", "relatorio"),
    ],
    task_assignees: extra.assignees ?? [{ task_id: "edicao", profile_id: ALLAN }],
    profiles,
    drive_capture_workspaces: extra.captures ?? [],
    drive_creative_workspaces: extra.creativeWorkspaces ?? [],
  });
  for (const profile of profiles) db.profiles.set(profile.id, profile.full_name);
  return db;
}

const session = () => ({ rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: null, error: null })) });
const file = (id: string, name = `${id}.mp4`) => ({ id, name });

describe("escopo: o que é status de criativo", () => {
  it("etapa de Entrega criativa entra; etapa de relatório fica de fora", async () => {
    const db = world();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await isCreativeStatusScope(db as any, { id: "edicao", kind: "operacional" })).toBe(true);
    // Comentário humano num card de relatório vira pedido de revisão na cascata.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await isCreativeStatusScope(db as any, { id: "relatorio", kind: "operacional" })).toBe(false);
  });

  it("criativo avulso, sem fluxo, entra", async () => {
    const db = world();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await isCreativeStatusScope(db as any, { id: "solto", kind: "criativo", workflow_version_id: null })).toBe(true);
  });

  it("etapa de formato canônico entra no thread sem ativar relatórios", async () => {
    const db = world({ tasks: [
      { id: "story", kind: "entrega_story", workflow_version_id: "wv-story" },
      { id: "story-edicao", kind: "operacional", subtype: "edicao" },
    ], links: [link("story", "story-edicao"), link("entrega-relatorio", "relatorio")] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await isCreativeStatusScope(db as any, { id: "story-edicao", kind: "operacional" })).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await isCreativeStatusScope(db as any, { id: "relatorio", kind: "operacional" })).toBe(false);
  });
});

describe("responsável da etapa", () => {
  it("perfil vinculado vence o texto", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await resolveStepResponsible(world() as any, { id: "edicao", assignee: "Luiza" })).toBe(ALLAN);
  });

  it("sem perfil vinculado, o primeiro nome do texto casa com o perfil", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await resolveStepResponsible(world() as any, { id: "roteiro", assignee: "luiza, Allan" })).toBe(LUIZA);
  });

  it("sem responsável conhecido: null — quem chama escreve como North Ai", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await resolveStepResponsible(world() as any, { id: "x", assignee: "North Ai" })).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await resolveStepResponsible(world() as any, { id: "x", assignee: "Fulano Inexistente" })).toBeNull();
  });
});

describe("texto do comentário de status", () => {
  it("usa os rótulos do quadro e marca a mudança por entrega", () => {
    expect(statusChangeText("Edição", "revisao", "em_producao", true)).toBe("Edição: Revisão → Em produção (só nesta entrega)");
    expect(statusChangeText("Roteiro", "em_producao", "aprovado", false)).toBe("Roteiro: Em produção → Concluído");
  });
});

describe("Edição: arquivo novo na Home → Revisão", () => {
  it("criativos que acompanham a etapa são só os sem andamento próprio", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await creativesFollowingStage(world() as any, "edicao")).toEqual(["criativo-b"]);
  });

  it("etapa compartilhada: muda SÓ neste criativo e comenta no card dele, em nome do responsável", async () => {
    const db = world();
    const s = session();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changed = await applyEditHomeArrival(db as any, s as any, { creativeTaskId: "criativo-a", stageTaskId: "edicao", files: [file("final-1", "Divulgação.mp4")] });
    expect(changed).toBe(true);
    expect(s.rpc).toHaveBeenCalledWith("set_delivery_stage_status", {
      p_delivery_id: "criativo-a", p_child_id: "edicao", p_expected_status: "em_producao", p_status: "revisao",
    });
    const [comment] = db.comments("criativo-a");
    expect(comment.author).toBe("Allan");
    expect(comment.author_id).toBe(ALLAN);
    expect(String(comment.text)).toContain("Divulgação.mp4");
    expect(comment.text).toBe("🎞️ Arquivo final — Edição: Em produção → Revisão (só nesta entrega) (automático).\n[Divulgação.mp4](https://drive.google.com/file/d/final-1/view)");
    // Nada no card da etapa compartilhada, nada no outro criativo.
    expect(db.comments("edicao")).toEqual([]);
    expect(db.comments("criativo-b")).toEqual([]);
  });

  it("com a Edição deste criativo já em Revisão (ou além), não muda — mas a chegada é comentada", async () => {
    const db = world();
    const s = session();
    // criativo-b acompanha a etapa, que está em Revisão.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await applyEditHomeArrival(db as any, s as any, { creativeTaskId: "criativo-b", stageTaskId: "edicao", files: [file("f")] })).toBe(false);
    expect(s.rpc).not.toHaveBeenCalled();
    const [comment] = db.comments("criativo-b");
    expect(comment.author).toBe("Allan");
    expect(comment.text).toBe("🎞️ Arquivo final.\n[f.mp4](https://drive.google.com/file/d/f/view)");
  });

  it("etapa só deste criativo: muda a etapa e comenta nela", async () => {
    const db = world({
      tasks: [{ id: "edicao-solo", kind: "operacional", subtype: "edicao", title: "Edição", status: "backlog", assignee: "Allan", payload: { comments: [] } }],
      links: [link("criativo-a", "edicao-solo")],
      assignees: [],
    });
    const s = session();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await applyEditHomeArrival(db as any, s as any, { creativeTaskId: "criativo-a", stageTaskId: "edicao-solo", files: [file("f")] })).toBe(true);
    expect(s.rpc).not.toHaveBeenCalled();
    expect(db.task("edicao-solo")!.status).toBe("revisao");
    // Responsável pelo texto do card (sem perfil vinculado).
    expect(db.comments("edicao-solo")[0].author).toBe("Allan");
  });

  it("outra pessoa mudou o andamento no meio: não sobrescreve, só comenta a chegada", async () => {
    const db = world();
    const s = { rpc: vi.fn(async () => ({ data: null, error: { message: "Stage status changed" } })) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await applyEditHomeArrival(db as any, s as any, { creativeTaskId: "criativo-a", stageTaskId: "edicao", files: [file("f")] })).toBe(false);
    expect(String(db.comments("criativo-a")[0].text)).not.toContain("→");
  });
});

describe("Roteiro e Captação: arquivo novo na pasta da diária → Revisão", () => {
  const capture = {
    id: "diaria", status: "ready", capture_task_id: "captacao",
    script_folder_id: "pasta-roteiro", capture_folder_id: "pasta-captacao",
    script_seen_file_ids: null as string[] | null, capture_seen_file_ids: null as string[] | null,
  };
  const creativeWorkspaces = [{ capture_workspace_id: "diaria", creative_task_id: "criativo-a" }];
  let contents: Record<string, Array<{ id: string; name: string }>>;

  beforeEach(() => {
    vi.clearAllMocks();
    contents = { "pasta-roteiro": [file("r1", "Roteiro.docx")], "pasta-captacao": [file("c1", "IMG_1.MOV")] };
    drive.list.mockImplementation(async (folder: string) => ({
      files: (contents[folder] ?? []).map((item) => ({ ...item, mimeType: "video/mp4" })), nextPageToken: null,
    }));
  });

  it("primeira leitura só grava a linha de base — o deploy não empurra ninguém para Revisão", async () => {
    const db = world({ captures: [{ ...capture }], creativeWorkspaces });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await applyCaptureHomeArrivals(db as any, "diaria");
    expect(db.task("roteiro")!.status).toBe("em_producao");
    expect(db.task("captacao")!.status).toBe("em_producao");
    const row = db.table("drive_capture_workspaces")[0];
    expect(row.script_seen_file_ids).toEqual(["r1"]);
    expect(row.capture_seen_file_ids).toEqual(["c1"]);
  });

  it("arquivo novo leva a etapa para Revisão, comentado pelo responsável dela", async () => {
    const db = world({ captures: [{ ...capture, script_seen_file_ids: ["r1"], capture_seen_file_ids: ["c1"] }], creativeWorkspaces });
    contents["pasta-captacao"].push(file("c2", "IMG_2.MOV"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await applyCaptureHomeArrivals(db as any, "diaria");
    expect(db.task("captacao")!.status).toBe("revisao");
    expect(db.task("roteiro")!.status).toBe("em_producao");
    const [comment] = db.comments("captacao");
    expect(comment.author).toBe("Alisson");
    expect(String(comment.text)).toContain("IMG_2.MOV");
    expect(String(comment.text)).not.toContain("IMG_1.MOV");
  });

  it("o mesmo arquivo não dispara duas vezes (sem loop Revisão → Em produção → Revisão)", async () => {
    const db = world({ captures: [{ ...capture, script_seen_file_ids: ["r1"], capture_seen_file_ids: ["c1"] }], creativeWorkspaces });
    contents["pasta-roteiro"].push(file("r2", "Roteiro v2.docx"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await applyCaptureHomeArrivals(db as any, "diaria");
    expect(db.task("roteiro")!.status).toBe("revisao");
    // Alguém pede ajuste: volta para produção. Nada novo na pasta.
    db.task("roteiro")!.status = "em_producao";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await applyCaptureHomeArrivals(db as any, "diaria");
    expect(db.task("roteiro")!.status).toBe("em_producao");
    expect(db.comments("roteiro")).toHaveLength(1);
  });

  it("sem responsável conhecido, o comentário sai como North Ai", async () => {
    const db = world({
      captures: [{ ...capture, script_seen_file_ids: ["r1"], capture_seen_file_ids: ["c1"] }],
      creativeWorkspaces,
      assignees: [],
    });
    db.task("captacao")!.assignee = null;
    contents["pasta-captacao"].push(file("c9"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await applyCaptureHomeArrivals(db as any, "diaria");
    expect(db.comments("captacao")[0].author).toBe("North Ai");
  });
});
