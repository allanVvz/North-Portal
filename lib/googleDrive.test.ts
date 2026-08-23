import { describe, expect, it } from "vitest";
import { parseGoogleDriveUrl } from "./googleDrive";

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
