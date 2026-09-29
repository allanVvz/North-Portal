import { describe, expect, it } from "vitest";
import { latestFinalCover, type CreativeMaterialAsset, type CreativeMaterialWorkspace } from "./cardMaterials";

const asset = (id: string, extra: Partial<CreativeMaterialAsset>): CreativeMaterialAsset => ({
  id, drive_file_id: `f-${id}`, name: id, mime_type: "image/jpeg", size_bytes: 1, role: "final", state: "active", web_view_link: null, created_at: "2026-09-20T10:00:00Z", ...extra,
});
const workspace = (assets: CreativeMaterialAsset[]) => ({ id: "w", plan_task_id: "p", capture_task_id: "c", creative_task_id: "cr", status: "ok", assets, raw_links: [], final_versions: [] }) as CreativeMaterialWorkspace;

describe("capa do Feed = último arquivo final", () => {
  it("escolhe o final mais recente, imagem ou vídeo", () => {
    const cover = latestFinalCover([workspace([
      asset("velho", { created_at: "2026-09-10T10:00:00Z" }),
      asset("video", { mime_type: "video/mp4", created_at: "2026-09-25T10:00:00Z" }),
      asset("preview", { role: "preview", created_at: "2026-09-28T10:00:00Z" }),
    ])]);
    expect(cover?.id).toBe("video");
  });

  it("sem final ativo não há capa (o criativo fica fora do Feed)", () => {
    expect(latestFinalCover([workspace([asset("lixo", { state: "trashed" }), asset("doc", { mime_type: "application/pdf" })])])).toBeNull();
  });
});

describe("capa de carrossel", () => {
  it("os finais são o conjunto de artes: a capa é a primeira pela ordem de nome", () => {
    const ws = { id: "w", plan_task_id: "p", capture_task_id: null, creative_task_id: "c", status: "ready", raw_links: [], final_versions: [], assets: [
      { id: "a3", drive_file_id: "f3", name: "03 Perfil — fade.png", mime_type: "image/png", size_bytes: 1, role: "final", state: "active", web_view_link: null, created_at: "2026-09-11T22:57:47.412Z" },
      { id: "a1", drive_file_id: "f1", name: "01 Capa — perfil fade.png", mime_type: "image/png", size_bytes: 1, role: "final", state: "active", web_view_link: null, created_at: "2026-09-11T22:57:47.336Z" },
      { id: "a2", drive_file_id: "f2", name: "02 Serviço + promos.png", mime_type: "image/png", size_bytes: 1, role: "final", state: "active", web_view_link: null, created_at: "2026-09-11T22:57:47.381Z" },
    ] } as unknown as CreativeMaterialWorkspace;
    expect(latestFinalCover([ws], { carousel: true })?.drive_file_id).toBe("f1");
    expect(latestFinalCover([ws])?.drive_file_id).toBe("f3");
  });
});
