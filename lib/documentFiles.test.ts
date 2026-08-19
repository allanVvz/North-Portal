import { describe, expect, it } from "vitest";
import { documentPreviewKind, documentStoragePath, fileTypeLabel, formatFileSize, sanitizeFileName } from "./documentFiles";

describe("document file helpers", () => {
  it("sanitizes names while preserving a safe extension", () => {
    expect(sanitizeFileName("Proposta João / final (2).DOCX")).toBe("Proposta-Joao-final-2.docx");
    expect(sanitizeFileName("!!!")).toBe("arquivo");
  });

  it("builds a collision-resistant client path", () => {
    expect(documentStoragePath("cliente-north", "Relatório 2026.pdf", "1234"))
      .toBe("cliente-north/1234/Relatorio-2026.pdf");
  });

  it("shows the real file format and size", () => {
    expect(fileTypeLabel({ original_file_name: "dados.xlsx", mime_type: "application/vnd.ms-excel" })).toBe("XLSX");
    expect(fileTypeLabel({ original_file_name: null, mime_type: "image/png" })).toBe("PNG");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("selects a native preview from MIME type or a legacy URL extension", () => {
    expect(documentPreviewKind({ file_url: "https://files.test/document", original_file_name: "contrato.pdf", mime_type: "application/pdf" })).toBe("pdf");
    expect(documentPreviewKind({ file_url: "https://files.test/foto.webp", original_file_name: null, mime_type: null })).toBe("image");
    expect(documentPreviewKind({ file_url: "https://files.test/dados.csv", original_file_name: "dados.csv", mime_type: "text/csv" })).toBe("text");
    expect(documentPreviewKind({ file_url: "https://files.test/planilha.xlsx", original_file_name: "planilha.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })).toBe("unsupported");
  });
});
