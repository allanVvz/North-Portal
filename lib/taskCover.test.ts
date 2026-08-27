import { describe, expect, it } from "vitest";

import { taskCover } from "./taskCover";

const FILE_A = "1AaBbCcDdEeFfGgHhIiJjKkLlMmNn";
const FILE_B = "2ZzYyXxWwVvUuTtSsRrQqPpOoNnMm";
const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view?usp=sharing`;

function comment(text: string, at: string) {
  return { author: "Allan", text, at };
}

describe("capa do card", () => {
  it("não inventa capa quando não há link nenhum", () => {
    expect(taskCover({ description: "gravar o vídeo na quinta", payload: {} })).toBeNull();
    expect(taskCover({})).toBeNull();
    expect(taskCover({ description: null, payload: null })).toBeNull();
  });

  it("pega o arquivo colado na descrição", () => {
    expect(taskCover({ description: `referência: ${driveUrl(FILE_A)}` })).toEqual({
      fileId: FILE_A,
      source: "description",
    });
  });

  it("pega o arquivo colado num comentário quando a descrição não tem", () => {
    const payload = { comments: [comment(`pronto: ${driveUrl(FILE_B)}`, "2026-08-01T10:00:00Z")] };
    expect(taskCover({ description: "sem link aqui", payload })).toEqual({
      fileId: FILE_B,
      source: "comments",
    });
  });

  it("prefere a descrição ao comentário", () => {
    // A descrição é o conteúdo do próprio card: quem escreveu a tarefa e já
    // anexou a referência está dizendo qual é o material.
    const payload = { comments: [comment(driveUrl(FILE_B), "2026-08-01T10:00:00Z")] };
    expect(taskCover({ description: driveUrl(FILE_A), payload })?.fileId).toBe(FILE_A);
  });

  it("entre comentários, fica com o mais antigo", () => {
    // Assim a capa não troca sozinha a cada comentário novo na thread.
    const payload = {
      comments: [
        comment(driveUrl(FILE_A), "2026-08-01T10:00:00Z"),
        comment(driveUrl(FILE_B), "2026-08-02T10:00:00Z"),
      ],
    };
    expect(taskCover({ payload })?.fileId).toBe(FILE_A);
  });

  it("entende o formato [rótulo](url) que a automação escreve", () => {
    const payload = { comments: [comment(`Relatório: [capa.jpg](${driveUrl(FILE_A)})`, "2026-08-01T10:00:00Z")] };
    expect(taskCover({ payload })?.fileId).toBe(FILE_A);
  });

  it("ignora pasta, Docs, Sheets e Slides", () => {
    // São links de trabalho, não material publicável — o quadro ficaria cheio
    // de miniatura de planilha.
    const naoViram = [
      "https://drive.google.com/drive/folders/1FolderAaBbCcDdEeFfGgHh",
      "https://docs.google.com/document/d/1DocAaBbCcDdEeFfGgHhIiJj/edit",
      "https://docs.google.com/spreadsheets/d/1SheetAaBbCcDdEeFfGgHh/edit",
      "https://docs.google.com/presentation/d/1SlideAaBbCcDdEeFfGgHh/edit",
    ];
    for (const url of naoViram) {
      expect(taskCover({ description: url }), url).toBeNull();
    }
  });

  it("ignora link que não é do Drive", () => {
    expect(taskCover({ description: "https://www.instagram.com/p/abc123/" })).toBeNull();
  });

  it("pula o link não-Drive e fica com o do Drive que vem depois", () => {
    const texto = `briefing em https://notion.so/algo e o arquivo em ${driveUrl(FILE_A)}`;
    expect(taskCover({ description: texto })?.fileId).toBe(FILE_A);
  });

  it("não quebra com payload sem comentários ou com formato estranho", () => {
    expect(taskCover({ payload: { comments: "não é array" } })).toBeNull();
    expect(taskCover({ payload: { outraCoisa: 1 } })).toBeNull();
  });
});
