import { describe, expect, it } from "vitest";
import { deliveryDriveLinks } from "./deliveryLinks";

const file = (id: string) => `https://drive.google.com/open?id=${id}&usp=drive_fs`;
const comment = (at: string, text: string, extra: Record<string, unknown> = {}) => ({ author: "Allan", at, text, ...extra });

// O caso do "Evento Baita 10/10": Reels e Carrossel dividem a mesma Edição.
const REELS = "reels-entrega";
const CARROSSEL = "carrossel-entrega";
const edicao = {
  id: "edicao", subtype: "edicao", description: null,
  payload: { comments: [
    comment("2026-09-11T23:00:00Z", file("pasta-feed-antiga")),
    comment("2026-09-29T09:31:00Z", file("video-reels"), { for_task_id: REELS }),
    comment("2026-09-29T09:40:00Z", file("slides-carrossel"), { for_task_id: CARROSSEL }),
  ] },
};
const captacao = { id: "captacao", subtype: "captacao", description: null, payload: { comments: [comment("2026-09-12T22:32:00Z", file("bruto"))] } };
const roteiro = { id: "roteiro", subtype: "roteiro", description: "materiais: https://drive.google.com/drive/folders/pasta-roteiro", payload: {} };

describe("links do Drive de uma Entrega sem automação de pastas", () => {
  it("etapa compartilhada: cada Entrega vê só o marcado para ela (e o que não tem marca)", () => {
    const reels = deliveryDriveLinks({ id: REELS, payload: {} }, [edicao, captacao, roteiro]).map((link) => link.id);
    const carrossel = deliveryDriveLinks({ id: CARROSSEL, payload: {} }, [edicao, captacao, roteiro]).map((link) => link.id);
    expect(reels).toContain("video-reels");
    expect(reels).not.toContain("slides-carrossel");
    expect(carrossel).toContain("slides-carrossel");
    expect(carrossel).not.toContain("video-reels");
    expect(reels).toContain("pasta-feed-antiga");
  });

  it("Edição mais recente primeiro; Roteiro e Captação por último; pasta reconhecida", () => {
    const links = deliveryDriveLinks({ id: CARROSSEL, payload: {} }, [captacao, roteiro, edicao]);
    expect(links.map((link) => link.id)).toEqual(["slides-carrossel", "pasta-feed-antiga", "pasta-roteiro", "bruto"]);
    expect(links.find((link) => link.id === "pasta-roteiro")).toMatchObject({ kind: "folder", source: "roteiro" });
  });

  it("o mesmo arquivo colado duas vezes entra uma vez, na posição mais forte", () => {
    const repetido = { id: "edicao2", subtype: "edicao", payload: { comments: [comment("2026-09-29T09:33:00Z", file("bruto"))] } };
    const links = deliveryDriveLinks({ id: REELS, payload: {} }, [captacao, repetido]);
    expect(links).toEqual([expect.objectContaining({ id: "bruto", source: "edicao" })]);
  });
});
