import { describe, expect, it } from "vitest";
import { gedAreaForDriveKind, gedFolderPath, gedStoragePath, googleExportPlan, isGedArea } from "./paths";

describe("GED paths", () => {
  const client = { name: "Tock Fatal", slug: "tock-fatal" };

  it("monta o caminho legível e a chave do bucket", () => {
    expect(gedFolderPath(client, "roteiros")).toBe("Clientes/Tock Fatal (tock-fatal)/Roteiros");
    expect(gedStoragePath("tock-fatal", "roteiros", "Roteiros Diária 22/09.docx", "abc")).toBe("ged/clientes/tock-fatal/roteiros/abc-Roteiros-Diaria-22-09.docx");
  });

  it("escolhe a área pelo tipo do link", () => {
    expect(gedAreaForDriveKind("document")).toBe("roteiros");
    expect(gedAreaForDriveKind("spreadsheet")).toBe("planilhas");
    expect(gedAreaForDriveKind("file")).toBe("arquivos");
    expect(isGedArea("edicao")).toBe(true);
    expect(isGedArea("qualquer")).toBe(false);
  });

  it("Docs e Sheets viram cópia Office + texto; pasta não é copiável", () => {
    expect(googleExportPlan({ kind: "document", id: "doc1" })).toMatchObject({
      original: { extension: "docx", url: "https://docs.google.com/document/d/doc1/export?format=docx" },
      text: { extension: "txt" },
    });
    expect(googleExportPlan({ kind: "spreadsheet", id: "s1" })?.text?.extension).toBe("csv");
    expect(googleExportPlan({ kind: "presentation", id: "p1" })?.text).toBeNull();
    expect(googleExportPlan({ kind: "folder", id: "f1" })).toBeNull();
  });
});
