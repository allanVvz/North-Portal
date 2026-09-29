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
