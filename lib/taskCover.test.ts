import { describe, expect, it } from "vitest";

import { MAX_COVER_CANDIDATES, taskCover, taskCoverCandidates, taskDriveFolders } from "./taskCover";

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

  // Caso real, tirado do card "REELS FEED - Quando cliente não vem"
  // (cbdfcd10-b14a-4dc6-991f-4e3c06690397). Serve de guarda contra dois
  // detalhes que a equipe usa na prática e que um teste sintético não pegaria:
  // o link vem no formato `/open?id=...&usp=drive_fs` (o que o botão de
  // compartilhar do Drive para desktop gera, não o `/file/d/...`), e a
  // descrição tem um link do Instagram antes, que não pode virar capa.
  it("caso real: descrição com Instagram, capa vem do primeiro Drive nos comentários", () => {
    const cover = taskCover({
      description: "https://www.instagram.com/p/DYfAkrINUVj/\nquando aquele cliente que sempre vem não aparece",
      payload: {
        comments: [
          { author: "Allan", at: "1", text: "Aparentemente só tenho o take da Kaome na frente da Baita." },
          { author: "Allan", at: "2", text: "https://drive.google.com/open?id=1MNnZqZA6_6BiXdCIsVc6tyjxcXLnlCd_&usp=drive_fs" },
          { author: "Allan", at: "3", text: "https://drive.google.com/open?id=1W3Xjputkp2GLR9iCXQIxm05_Tk2A10jR&usp=drive_fs" },
          { author: "Allan", at: "4", text: "Capa https://drive.google.com/open?id=1s1WhkToAyjd22sxewRJ2M2RyaSHsSOHB&usp=drive_fs" },
        ],
      },
    });
    expect(cover).toEqual({ fileId: "1MNnZqZA6_6BiXdCIsVc6tyjxcXLnlCd_", source: "comments" });
  });
});

// Por que uma LISTA e não um só: medido em produção, a maioria dos arquivos
// colados nos comentários não está compartilhada publicamente. Se o card
// apostasse tudo no primeiro link, ficaria sem capa mesmo tendo arquivos
// perfeitamente exibíveis logo abaixo — foi exatamente o que aconteceu no card
// "REELS FEED - Quando cliente não vem".
describe("candidatos a capa", () => {
  it("junta descrição e comentários, descrição primeiro", () => {
    const candidatos = taskCoverCandidates({
      description: driveUrl(FILE_A),
      payload: { comments: [comment(driveUrl(FILE_B), "2026-08-01T10:00:00Z")] },
    });
    expect(candidatos).toEqual([
      { fileId: FILE_A, source: "description" },
      { fileId: FILE_B, source: "comments" },
    ]);
  });

  it("não repete o mesmo arquivo citado duas vezes", () => {
    const candidatos = taskCoverCandidates({
      description: driveUrl(FILE_A),
      payload: { comments: [comment(`de novo: ${driveUrl(FILE_A)}`, "2026-08-01T10:00:00Z")] },
    });
    expect(candidatos).toHaveLength(1);
  });

  it("pega vários arquivos do mesmo texto, na ordem", () => {
    const candidatos = taskCoverCandidates({ description: `${driveUrl(FILE_A)} e ${driveUrl(FILE_B)}` });
    expect(candidatos.map((c) => c.fileId)).toEqual([FILE_A, FILE_B]);
  });

  it("respeita o teto — cada candidato que falha é uma requisição perdida", () => {
    const comments = Array.from({ length: 20 }, (_, i) =>
      comment(driveUrl(`1file${String(i).padStart(20, "x")}`), `2026-08-${String(i + 1).padStart(2, "0")}T10:00:00Z`),
    );
    expect(taskCoverCandidates({ payload: { comments } })).toHaveLength(MAX_COVER_CANDIDATES);
  });

  it("taskCover é só o primeiro candidato", () => {
    const task = { description: driveUrl(FILE_A), payload: { comments: [comment(driveUrl(FILE_B), "1")] } };
    expect(taskCover(task)).toEqual(taskCoverCandidates(task)[0]);
  });

  it("caso real: o card tem 4 candidatos, não 1", () => {
    // O 1º e o 2º não estão compartilhados (404 na miniatura); o 3º está. Com
    // um candidato só o card ficaria sem capa; com a lista, ele cai no 3º.
    const candidatos = taskCoverCandidates({
      description: "https://www.instagram.com/p/DYfAkrINUVj/",
      payload: {
        comments: [
          { author: "Allan", at: "1", text: "Aparentemente só tenho o take da Kaome." },
          { author: "Allan", at: "2", text: "https://drive.google.com/open?id=1MNnZqZA6_6BiXdCIsVc6tyjxcXLnlCd_&usp=drive_fs" },
          { author: "Allan", at: "3", text: "https://drive.google.com/open?id=1W3Xjputkp2GLR9iCXQIxm05_Tk2A10jR&usp=drive_fs" },
          { author: "Allan", at: "4", text: "https://drive.google.com/open?id=1z-X1-amdHLOfbsQMyuwfqs8L0HHt1vCC&usp=drive_fs" },
          { author: "Allan", at: "5", text: "Capa https://drive.google.com/open?id=1s1WhkToAyjd22sxewRJ2M2RyaSHsSOHB&usp=drive_fs" },
        ],
      },
    });
    expect(candidatos.map((c) => c.fileId)).toEqual([
      "1MNnZqZA6_6BiXdCIsVc6tyjxcXLnlCd_",
      "1W3Xjputkp2GLR9iCXQIxm05_Tk2A10jR",
      "1z-X1-amdHLOfbsQMyuwfqs8L0HHt1vCC",
      "1s1WhkToAyjd22sxewRJ2M2RyaSHsSOHB",
    ]);
  });
});

// No card o link aparece solto no meio de um comentário, sem campo que o
// qualifique — então só a forma inequívoca conta. Abrir um navegador de pastas
// em cima de um arquivo seria pior que não abrir nada.
describe("pastas do Drive citadas no card", () => {
  const FOLDER = "https://drive.google.com/drive/folders/14fk0asXkJD2Dm5S1FmOdO5hkRnjCYh1Z";
  const AMBIGUO = "https://drive.google.com/open?id=10yfhwlbsCrBsINQWqMvmYmrfm-eYe3qZ&usp=drive_fs";

  it("pega a pasta da descrição e a do comentário, sem repetir", () => {
    const pastas = taskDriveFolders({
      description: FOLDER,
      payload: { comments: [comment(`de novo ${FOLDER}`, "1"), comment(driveUrl(FILE_A), "2")] },
    });
    expect(pastas).toEqual([{ folderId: "14fk0asXkJD2Dm5S1FmOdO5hkRnjCYh1Z", url: FOLDER }]);
  });

  it("NÃO trata /open?id= como pasta — no comentário não há como saber", () => {
    expect(taskDriveFolders({ description: AMBIGUO })).toEqual([]);
  });

  it("arquivo nunca vira pasta, e pasta nunca vira capa", () => {
    const task = { description: `${FOLDER} e ${driveUrl(FILE_A)}` };
    expect(taskDriveFolders(task).map((f) => f.folderId)).toEqual(["14fk0asXkJD2Dm5S1FmOdO5hkRnjCYh1Z"]);
    expect(taskCoverCandidates(task).map((c) => c.fileId)).toEqual([FILE_A]);
  });

  it("card sem pasta devolve lista vazia", () => {
    expect(taskDriveFolders({ description: "sem link" })).toEqual([]);
    expect(taskDriveFolders({})).toEqual([]);
  });
});
