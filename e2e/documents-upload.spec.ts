import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RUN = Date.now();
const EMAIL = `e2e-documents-${RUN}@e2e-test.com`;
const PASSWORD = "SenhaForte123!";
const FIRST_TITLE = `Documento E2E ${RUN}`;
const REPLACED_TITLE = `${FIRST_TITLE} editado`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials are required.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(EMAIL);
  await page.getByPlaceholder("Sua senha").fill(PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/);
}

test.describe("upload real de documentos", () => {
  let sb: SupabaseClient;
  let userId = "";
  let documentId = "";
  let storagePath = "";

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data, error } = await sb.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role: "admin", level: "editor" },
    });
    if (error || !data.user) throw new Error(error?.message || "Não foi possível criar o admin E2E.");
    userId = data.user.id;
    const { error: profileError } = await sb.from("profiles").upsert({ id: userId, role: "admin", level: "editor", client_id: null }, { onConflict: "id" });
    if (profileError) throw new Error(profileError.message);
  });

  test.afterAll(async () => {
    if (documentId) await sb.from("documents").delete().eq("id", documentId);
    if (storagePath) await sb.storage.from("documents").remove([storagePath]);
    if (userId) await sb.auth.admin.deleteUser(userId);
  });

  test("cria, baixa, substitui e exclui arquivo não-PDF", async ({ page, request }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto("/admin/documentos");
    // "Enviar documento" is now a drag-and-drop zone, not a button — picking a
    // file directly on its (hidden) file input opens the same upload modal,
    // pre-filled with that file, same as a real drop would.
    await page.locator(".doc-dropzone-input").setInputFiles({ name: "contrato inicial.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF") });

    const modal = page.locator(".kb-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel("Nome")).toHaveValue("contrato inicial");
    await modal.getByLabel("Nome").fill(FIRST_TITLE);
    await modal.getByRole("button", { name: "Salvar" }).click();
    await expect(modal).toBeHidden({ timeout: 30_000 });

    const { data: created, error: createReadError } = await sb.from("documents").select("id,file_url,storage_path,original_file_name,mime_type,size_bytes").eq("name", FIRST_TITLE).single();
    if (createReadError || !created) throw new Error(createReadError?.message);
    documentId = created.id as string;
    const firstPath = created.storage_path as string;
    storagePath = firstPath;
    expect(created.original_file_name).toBe("contrato inicial.pdf");
    expect(created.mime_type).toBe("application/pdf");
    expect(created.size_bytes).toBeGreaterThan(0);
    expect((await request.get(created.file_url as string)).ok()).toBe(true);

    const row = page.locator(".doc-table tbody tr", { hasText: FIRST_TITLE });
    await expect(row.getByText("PDF")).toBeVisible();
    await row.click();
    const preview = page.locator(".docprev");
    await expect(preview.locator("iframe")).toBeVisible();
    await preview.getByRole("button", { name: "Fechar" }).click();
    await row.getByRole("button", { name: "Editar" }).click();
    await modal.getByRole("button", { name: "Substituir arquivo" }).click();
    await modal.locator('input[type="file"]').setInputFiles({ name: "resumo.txt", mimeType: "text/plain", buffer: Buffer.from("arquivo substituído") });
    await modal.getByLabel("Nome").fill(REPLACED_TITLE);
    await modal.getByRole("button", { name: "Salvar" }).click();
    await expect(modal).toBeHidden({ timeout: 30_000 });

    const { data: replaced, error: replaceReadError } = await sb.from("documents").select("file_url,storage_path,original_file_name,mime_type").eq("id", documentId).single();
    if (replaceReadError || !replaced) throw new Error(replaceReadError?.message);
    storagePath = replaced.storage_path as string;
    expect(replaced.original_file_name).toBe("resumo.txt");
    expect(replaced.mime_type).toBe("text/plain");
    expect(replaced.storage_path).not.toBe(firstPath);
    expect((await request.get(replaced.file_url as string)).ok()).toBe(true);

    const replacedRow = page.locator(".doc-table tbody tr", { hasText: REPLACED_TITLE });
    await replacedRow.click();
    await expect(preview.locator("iframe")).toBeVisible();
    await preview.getByRole("button", { name: "Fechar" }).click();
    await replacedRow.getByRole("button", { name: "Editar" }).click();
    await modal.getByRole("button", { name: "Excluir" }).click();
    await expect(modal).toBeHidden({ timeout: 30_000 });
    const { count } = await sb.from("documents").select("id", { count: "exact", head: true }).eq("id", documentId);
    expect(count).toBe(0);
    documentId = "";
    const pathParts = storagePath.split("/");
    const removedFileName = pathParts.pop()!;
    const { data: remainingObjects, error: listError } = await sb.storage.from("documents").list(pathParts.join("/"), { search: removedFileName });
    if (listError) throw new Error(listError.message);
    expect(remainingObjects?.some((object) => object.name === removedFileName)).toBe(false);
    storagePath = "";
  });
});
