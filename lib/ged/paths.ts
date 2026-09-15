// GED — o armazenamento interno da plataforma. O caminho é o mesmo qualquer que
// seja o provedor por baixo (Supabase Storage hoje; o Drive da plataforma quando
// a conta de serviço estiver configurada), então trocar de provedor não muda
// telas nem links salvos nos cards.
//
//   Clientes/<Cliente> (<slug>)/Marca | Arquivos | Edição | Roteiros | Planilhas | Relatórios
//
// As três primeiras casam com CLIENT_SUBFOLDERS de lib/googleDriveApi.ts.

import { sanitizeFileName } from "@/lib/documentFiles";
import type { GoogleDriveKind, GoogleDriveLink } from "@/lib/googleDrive";

export const GED_AREAS = [
  { key: "marca", label: "Marca" },
  { key: "arquivos", label: "Arquivos" },
  { key: "edicao", label: "Edição" },
  { key: "roteiros", label: "Roteiros" },
  { key: "planilhas", label: "Planilhas" },
  { key: "relatorios", label: "Relatórios" },
] as const;

export type GedArea = (typeof GED_AREAS)[number]["key"];

export function isGedArea(value: string): value is GedArea {
  return GED_AREAS.some((area) => area.key === value);
}

export function gedAreaLabel(area: GedArea): string {
  return GED_AREAS.find((entry) => entry.key === area)?.label ?? area;
}

export function gedClientFolderName(client: { name: string; slug: string }): string {
  return `${client.name} (${client.slug})`;
}

/** Caminho legível, igual no Storage e no Drive: "Clientes/Tock Fatal (tock-fatal)/Roteiros". */
export function gedFolderPath(client: { name: string; slug: string }, area: GedArea): string {
  return ["Clientes", gedClientFolderName(client), gedAreaLabel(area)].join("/");
}

/** Chave no bucket `documents` — sempre com 3+ segmentos (storagePathSchema). */
export function gedStoragePath(slug: string, area: GedArea, fileName: string, id = crypto.randomUUID()): string {
  return `ged/clientes/${slug}/${area}/${id}-${sanitizeFileName(fileName)}`;
}

export function gedAreaForDriveKind(kind: GoogleDriveKind): GedArea {
  if (kind === "document") return "roteiros";
  if (kind === "spreadsheet") return "planilhas";
  return "arquivos";
}

export type GoogleExport = { url: string; extension: string; mime: string };
export type GoogleExportPlan = { original: GoogleExport; text: GoogleExport | null };

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * De onde baixar a cópia de um link do Google. Docs e Sheets viram arquivo
 * Office (a cópia fiel) + texto (o que o Estúdio lê); Slides vira PDF; arquivo
 * comum é baixado como está. Pasta não é copiável por link — null.
 */
export function googleExportPlan(link: Pick<GoogleDriveLink, "kind" | "id">): GoogleExportPlan | null {
  const id = encodeURIComponent(link.id);
  switch (link.kind) {
    case "document":
      return {
        original: { url: `https://docs.google.com/document/d/${id}/export?format=docx`, extension: "docx", mime: DOCX },
        text: { url: `https://docs.google.com/document/d/${id}/export?format=txt`, extension: "txt", mime: "text/plain" },
      };
    case "spreadsheet":
      return {
        original: { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, extension: "xlsx", mime: XLSX },
        text: { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`, extension: "csv", mime: "text/csv" },
      };
    case "presentation":
      return { original: { url: `https://docs.google.com/presentation/d/${id}/export/pdf`, extension: "pdf", mime: "application/pdf" }, text: null };
    case "file":
      return { original: { url: `https://drive.google.com/uc?export=download&id=${id}`, extension: "", mime: "application/octet-stream" }, text: null };
    default:
      return null;
  }
}
