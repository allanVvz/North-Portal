import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_SIZE_BYTES, documentCreateSchema, documentPatchSchema } from "./validation";

const validDocument = {
  slug: "cliente-north",
  name: "Planilha mensal",
  file_url: "https://example.supabase.co/storage/v1/object/public/documents/cliente-north/id/dados.xlsx",
  storage_path: "cliente-north/id/dados.xlsx",
  original_file_name: "dados.xlsx",
  mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  size_bytes: 1024,
};

describe("document metadata validation", () => {
  it("accepts real Storage metadata and status-only legacy patches", () => {
    expect(documentCreateSchema.parse(validDocument)).toMatchObject(validDocument);
    expect(documentPatchSchema.parse({ status: "publicado" })).toEqual({ status: "publicado" });
  });

  it("rejects oversized files and unsafe paths", () => {
    expect(() => documentCreateSchema.parse({ ...validDocument, size_bytes: MAX_DOCUMENT_SIZE_BYTES + 1 })).toThrow();
    expect(() => documentCreateSchema.parse({ ...validDocument, storage_path: "../arquivo.pdf" })).toThrow();
  });
});

describe("documents storage migration", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260814000002_documents_storage.sql"), "utf8");
  const selectPolicySql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260814000003_documents_storage_delete_select.sql"), "utf8");

  it("creates the public 50 MB bucket and metadata columns", () => {
    expect(sql).toContain("add column if not exists storage_path text");
    expect(sql).toContain("add column if not exists original_file_name text");
    expect(sql).toContain("values ('documents', 'documents', true, 52428800, null)");
  });

  it("limits Storage writes to authenticated admins", () => {
    expect(sql.match(/public\.is_admin\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("for insert to authenticated");
    expect(sql).toContain("for update to authenticated");
    expect(sql).toContain("for delete to authenticated");
    expect(selectPolicySql).toContain("for select to authenticated");
    expect(selectPolicySql).toContain("bucket_id = 'documents' and public.is_admin()");
  });
});
