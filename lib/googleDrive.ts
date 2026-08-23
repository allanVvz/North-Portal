// Recognizes a Google Drive / Docs / Sheets / Slides URL pasted into a task
// description or comment and maps it to Google's own embeddable preview URL
// (the same `/preview` iframe Google's "Share > Embed" flow produces) — no
// Drive API/OAuth involved, so this works for any link shared "Anyone with
// the link can view".
export type GoogleDriveKind = "file" | "folder" | "document" | "spreadsheet" | "presentation";

export type GoogleDriveLink = {
  kind: GoogleDriveKind;
  id: string;
  embedUrl: string;
};

const ID_RE = /^[a-zA-Z0-9_-]+$/;

function fileLink(id: string): GoogleDriveLink {
  return { kind: "file", id, embedUrl: `https://drive.google.com/file/d/${id}/preview` };
}

function docsLink(kind: "document" | "spreadsheet" | "presentation", id: string): GoogleDriveLink {
  const path = kind === "document" ? "document" : kind === "spreadsheet" ? "spreadsheets" : "presentation";
  return { kind, id, embedUrl: `https://docs.google.com/${path}/d/${id}/preview` };
}

export function parseGoogleDriveUrl(raw: string): GoogleDriveLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname;

  if (host === "drive.google.com") {
    const fileMatch = /^\/file\/d\/([^/]+)/.exec(path);
    if (fileMatch && ID_RE.test(fileMatch[1])) return fileLink(fileMatch[1]);

    const folderMatch = /^\/drive\/folders\/([^/]+)/.exec(path);
    if (folderMatch && ID_RE.test(folderMatch[1])) {
      return { kind: "folder", id: folderMatch[1], embedUrl: `https://drive.google.com/embeddedfolderview?id=${folderMatch[1]}#grid` };
    }

    if (path === "/open" || path === "/uc") {
      const id = url.searchParams.get("id");
      if (id && ID_RE.test(id)) return fileLink(id);
    }
    return null;
  }

  if (host === "docs.google.com") {
    const documentMatch = /^\/document\/d\/([^/]+)/.exec(path);
    if (documentMatch && ID_RE.test(documentMatch[1])) return docsLink("document", documentMatch[1]);

    const sheetMatch = /^\/spreadsheets\/d\/([^/]+)/.exec(path);
    if (sheetMatch && ID_RE.test(sheetMatch[1])) return docsLink("spreadsheet", sheetMatch[1]);

    const slideMatch = /^\/presentation\/d\/([^/]+)/.exec(path);
    if (slideMatch && ID_RE.test(slideMatch[1])) return docsLink("presentation", slideMatch[1]);
    return null;
  }

  return null;
}

export const GOOGLE_DRIVE_KIND_LABEL: Record<GoogleDriveKind, string> = {
  file: "Arquivo do Drive",
  folder: "Pasta do Drive",
  document: "Google Docs",
  spreadsheet: "Google Sheets",
  presentation: "Google Slides",
};
