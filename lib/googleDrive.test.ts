import { describe, expect, it } from "vitest";
import { DRIVE_FOLDER_MIME, driveFileKind, driveFolderIdFromUrl, isDriveFolder, parseGoogleDriveUrl } from "./googleDrive";

describe("parseGoogleDriveUrl", () => {
  it("recognizes a shared file link and builds its preview embed", () => {
    expect(parseGoogleDriveUrl("https://drive.google.com/file/d/1AbC-2xYz_9/view?usp=sharing")).toEqual({
      kind: "file", id: "1AbC-2xYz_9", embedUrl: "https://drive.google.com/file/d/1AbC-2xYz_9/preview",
    });
  });

  it("recognizes the legacy open?id= and uc?id= forms", () => {
    expect(parseGoogleDriveUrl("https://drive.google.com/open?id=1AbC-2xYz_9")).toEqual({
      kind: "file", id: "1AbC-2xYz_9", embedUrl: "https://drive.google.com/file/d/1AbC-2xYz_9/preview",
    });
    expect(parseGoogleDriveUrl("https://drive.google.com/uc?export=download&id=1AbC-2xYz_9")).toEqual({
      kind: "file", id: "1AbC-2xYz_9", embedUrl: "https://drive.google.com/file/d/1AbC-2xYz_9/preview",
    });
  });

  it("recognizes a shared folder link", () => {
    expect(parseGoogleDriveUrl("https://drive.google.com/drive/folders/1FolderId")).toEqual({
      kind: "folder", id: "1FolderId", embedUrl: "https://drive.google.com/embeddedfolderview?id=1FolderId#grid",
    });
  });

  it("recognizes Docs, Sheets and Slides links", () => {
    expect(parseGoogleDriveUrl("https://docs.google.com/document/d/1DocId/edit")).toEqual({
      kind: "document", id: "1DocId", embedUrl: "https://docs.google.com/document/d/1DocId/preview",
    });
    expect(parseGoogleDriveUrl("https://docs.google.com/spreadsheets/d/1SheetId/edit#gid=0")).toEqual({
      kind: "spreadsheet", id: "1SheetId", embedUrl: "https://docs.google.com/spreadsheets/d/1SheetId/preview",
    });
    expect(parseGoogleDriveUrl("https://docs.google.com/presentation/d/1SlideId/edit#slide=id.p")).toEqual({
      kind: "presentation", id: "1SlideId", embedUrl: "https://docs.google.com/presentation/d/1SlideId/preview",
    });
  });

  it("ignores unrelated URLs and malformed input", () => {
    expect(parseGoogleDriveUrl("https://example.com/file/d/1AbC")).toBeNull();
    expect(parseGoogleDriveUrl("https://docs.google.com/forms/d/1FormId/edit")).toBeNull();
    expect(parseGoogleDriveUrl("not-a-url")).toBeNull();
  });
});

// `/open?id=…` é a forma que o Drive para desktop gera e a mais comum nos dados
// reais — e é AMBÍGUA: serve para arquivo e para pasta. Quem resolve a
// ambiguidade é o contexto, e por isso as duas funções abaixo respondem
// diferente para a mesma URL. Caso real: a pasta "EDIÇÃO" da Baita chega assim.
describe("pasta a partir da URL, e a ambiguidade do /open?id=", () => {
  const OPEN = "https://drive.google.com/open?id=10yfhwlbsCrBsINQWqMvmYmrfm-eYe3qZ&usp=drive_fs";
  const FOLDERS = "https://drive.google.com/drive/folders/14fk0asXkJD2Dm5S1FmOdO5hkRnjCYh1Z";

  it("campo de pasta aceita /open?id= — quem colou ali já disse que é pasta", () => {
    expect(driveFolderIdFromUrl(OPEN)).toBe("10yfhwlbsCrBsINQWqMvmYmrfm-eYe3qZ");
  });

  it("campo de pasta aceita a forma inequívoca", () => {
    expect(driveFolderIdFromUrl(FOLDERS)).toBe("14fk0asXkJD2Dm5S1FmOdO5hkRnjCYh1Z");
  });

  it("ignora o que não é do Drive, nulo ou vazio", () => {
    expect(driveFolderIdFromUrl("https://www.instagram.com/p/abc/")).toBeNull();
    expect(driveFolderIdFromUrl(null)).toBeNull();
    expect(driveFolderIdFromUrl("")).toBeNull();
    expect(driveFolderIdFromUrl("   ")).toBeNull();
  });

  it("pasta é reconhecida como pasta, não como 'outro'", () => {
    expect(driveFileKind(DRIVE_FOLDER_MIME)).toBe("folder");
    expect(isDriveFolder({ mimeType: DRIVE_FOLDER_MIME })).toBe(true);
    expect(isDriveFolder({ mimeType: "image/png" })).toBe(false);
  });
});
