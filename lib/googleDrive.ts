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

// ---- Drive file metadata (client-safe) --------------------------------------
// Shape and helper live here, next to the URL parser, because client components
// render the folder previews. lib/googleDriveApi.ts (which fetches these from
// the Drive REST API) imports node:crypto to sign its service-account JWT and
// must never reach a browser bundle.

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  thumbnailUrl: string | null;
  webViewLink: string | null;
};

export type DriveFileKind = "folder" | "image" | "video" | "doc" | "sheet" | "slide" | "pdf" | "other";

/** Mime que o Drive usa para pasta — o que separa "entrar" de "abrir". */
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

/** Um item listado é uma pasta? É por isto que o navegador decide se o clique
 *  desce um nível ou abre o arquivo no Drive. */
export function isDriveFolder(file: { mimeType: string }): boolean {
  return file.mimeType === DRIVE_FOLDER_MIME;
}

/**
 * O id da pasta por trás de uma URL colada NUM CAMPO DE PASTA.
 *
 * O contexto do campo é parte da informação, e é por isso que esta função
 * aceita mais formas que `parseGoogleDriveUrl`. A forma `/open?id=…` — que é a
 * que o Drive para desktop gera, e a mais comum nos dados reais — serve tanto
 * para arquivo quanto para pasta, e a URL sozinha não diz qual: os dois são
 * "um item do Drive com este id". Quando o link foi colado no campo "Pasta de
 * Edição", quem colou já respondeu essa pergunta.
 *
 * Por isso o card NÃO usa esta função (ver taskDriveFolders em lib/taskCover):
 * lá o link aparece solto no meio de um comentário, sem campo que o qualifique,
 * e só a forma inequívoca `/drive/folders/…` conta.
 */
export function driveFolderIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const link = parseGoogleDriveUrl(url.trim());
  if (!link) return null;
  return link.kind === "folder" || link.kind === "file" ? link.id : null;
}

/** Coarse file kind used to pick an icon in the preview grid. */
export function driveFileKind(mimeType: string): DriveFileKind {
  // Antes de tudo: pasta não é "outro", é o item que se navega.
  if (mimeType === DRIVE_FOLDER_MIME) return "folder";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.includes("spreadsheet")) return "sheet";
  if (mimeType.includes("presentation")) return "slide";
  if (mimeType.includes("document") || mimeType.startsWith("text/")) return "doc";
  return "other";
}
