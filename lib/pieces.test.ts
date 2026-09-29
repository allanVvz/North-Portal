import { describe, expect, it } from "vitest";
import { buildPieces, pieceCounts } from "./pieces";

const base = { client_id: "c", subtype: null, status: "backlog", description: null, payload: {}, parents: [], completed_at: null, due_date: null, workflow_version_id: null, recurrence_cadence: null, clientName: "Baita", clientSlug: "baita" };
const task = (id: string, extra: Record<string, unknown>) => ({ ...base, id, title: id, kind: "operacional", ...extra }) as never;
const driveLink = (fileId: string) => ({ comments: [{ author: "Luiza", text: `https://drive.google.com/file/d/${fileId}/view`, at: "2026-08-06T10:00:00Z" }] });

describe("peças do Feed", () => {
  const today = "2026-09-29";
  const workspace = { id: "w", plan_task_id: "p", capture_task_id: "cap", creative_task_id: "entrega", status: "ok", raw_links: [], final_versions: [],
    assets: [{ id: "a", drive_file_id: "final-video", name: "v.mp4", mime_type: "video/mp4", size_bytes: 1, role: "final", state: "active", web_view_link: null, created_at: "2026-09-28T10:00:00Z" }] } as never;

  const pieces = buildPieces([
    task("entrega", { kind: "criativo", workflow_version_id: "wv", due_date: "2026-09-27", status: "revisao" }),
    task("etapa-edicao", { subtype: "edicao", payload: driveLink("etapa-file"), parents: [{ id: "entrega", relation_kind: "workflow_step", slot: "s", position: 20 }] }),
    // O card legado de 40158eeb: tarefa comum, subtipo reels, dentro de um plano.
    task("reels-legado", { subtype: "reels", status: "revisao", due_date: "2026-09-16", payload: { publicado_em: "2026-08-06", ...driveLink("reels-file") }, parents: [{ id: "plano", relation_kind: "structural_member", slot: null, position: 0 }] }),
    task("publicado", { subtype: "publicacao", status: "aprovado", completed_at: "2026-09-10T10:00:00Z", payload: driveLink("pub-file") }),
    task("sem-capa", { subtype: "publicacao" }),
    // IMAGENS TVs - PROMOÇÕES (b761524f): banner sem fluxo, links nos comentários.
    task("banner-tv", { subtype: "banner", status: "aprovado", completed_at: "2026-09-03T19:48:58Z", payload: driveLink("tv-file") }),
    task("tarefa-qualquer", { payload: driveLink("x") }),
  ], [workspace], today);

  it("entrega usa o último final como capa; a etapa não vira peça própria", () => {
    const entrega = pieces.find((piece) => piece.id === "entrega")!;
    expect(entrega).toMatchObject({ covers: ["final-video", "etapa-file"], coverSource: "final", isVideo: true, legacy: false, state: "atrasada" });
    expect(pieces.some((piece) => piece.id === "etapa-edicao")).toBe(false);
  });

  it("card legado com link do Drive entra, com a data de publicação", () => {
    expect(pieces.find((piece) => piece.id === "reels-legado")).toMatchObject({ covers: ["reels-file"], legacy: true, format: "Reels", date: "2026-08-06", state: "atrasada" });
  });

  it("sem imagem ou sem ser peça, fica fora; os três estados são contados", () => {
    expect(pieces.map((piece) => piece.id).sort()).toEqual(["banner-tv", "entrega", "publicado", "reels-legado"]);
    expect(pieceCounts(pieces)).toEqual({ concluida: 2, atrasada: 2, producao: 0 });
  });

  it("todo formato do catálogo é peça: banner entra com o rótulo do catálogo", () => {
    expect(pieces.find((piece) => piece.id === "banner-tv")).toMatchObject({ format: "Banner", legacy: true, covers: ["tv-file"], state: "concluida" });
  });
});

describe("colunas do Feed", async () => {
  const { isProfilePiece, isReels } = await import("@/app/admin/plano/CreativeFeedView");
  const piece = (format: string, title = "x", isVideo = false) => ({ format, title, isVideo });
  it("carrossel e post só no Feed; reels no Feed e em Reels; banner, anúncio e story só em Outros", () => {
    expect([isProfilePiece(piece("Carrossel")), isReels(piece("Carrossel"))]).toEqual([true, false]);
    expect([isProfilePiece(piece("Reels")), isReels(piece("Reels"))]).toEqual([true, true]);
    for (const format of ["Banner", "Anúncio", "Story"]) expect([isProfilePiece(piece(format)), isReels(piece(format, "x", true))]).toEqual([false, false]);
  });
});
