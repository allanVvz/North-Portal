import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Real end-to-end coverage (no mocks) for the Informações redesign: 3 tabs
// (Documentos / Trilhas North / Onboarding, underline style matching
// Clientes), a real HTML upload landing in the Trilhas grid instead of the
// Documentos table, and the drag-and-drop entry point (documents-upload.spec.ts
// covers the full upload/replace/delete lifecycle for the Documentos side —
// this spec only proves the NEW tab/variant wiring, not the upload pipeline
// itself again).

const RUN = Date.now();
const EMAIL = `e2e-informacoes-${RUN}@e2e-test.com`;
const PASSWORD = "SenhaForte123!";
const TRILHA_TITLE = `Trilha E2E ${RUN}`;

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
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

test.describe("Informações — abas Documentos/Trilhas North/Onboarding (e2e contra o backend real)", () => {
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

  test("3 abas navegáveis; upload de HTML aparece no grid de Trilhas, não na tabela de Documentos", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await page.goto("/admin/documentos");

    const tabs = page.locator(".clients-section-tabs");
    await expect(tabs).toBeVisible({ timeout: 20_000 });
    await expect(tabs.getByRole("button", { name: /Documentos/ })).toBeVisible();
    await expect(tabs.getByRole("button", { name: /Trilhas North/ })).toBeVisible();
    await expect(tabs.getByRole("button", { name: /Onboarding/ })).toBeVisible();

    // Documentos tab: real drop zone + composite filter bar, no old button/select.
    await expect(page.locator(".doc-dropzone")).toBeVisible();
    await expect(page.getByRole("button", { name: /Enviar documento/ })).toHaveCount(0);
    await expect(page.locator(".doc-filterbar")).toBeVisible();

    // Trilhas North tab: upload an HTML file via the drop zone.
    await tabs.getByRole("button", { name: /Trilhas North/ }).click();
    await expect(page.locator(".doc-filterbar")).toHaveCount(0);
    await page.locator(".doc-dropzone-input").setInputFiles({
      name: "apresentacao.html",
      mimeType: "text/html",
      buffer: Buffer.from("<html><body><h1>Trilha</h1></body></html>"),
    });
    const modal = page.locator(".kb-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("heading", { name: "Enviar trilha" })).toBeVisible();
    await modal.getByLabel("Nome").fill(TRILHA_TITLE);
    await modal.getByRole("button", { name: "Salvar" }).click();
    await expect(modal).toBeHidden({ timeout: 30_000 });

    const { data: created, error: readError } = await sb
      .from("documents")
      .select("id,storage_path,mime_type")
      .eq("name", TRILHA_TITLE)
      .single();
    if (readError || !created) throw new Error(readError?.message);
    documentId = created.id as string;
    storagePath = created.storage_path as string;
    expect(created.mime_type).toBe("text/html");

    await expect(page.locator(".doc-grid-card", { hasText: TRILHA_TITLE })).toBeVisible({ timeout: 20_000 });

    // The same document must NOT show up under the Documentos tab (HTML is
    // excluded from that variant's row filter).
    await tabs.getByRole("button", { name: /^Documentos/ }).click();
    await expect(page.locator(".doc-table", { hasText: TRILHA_TITLE })).toHaveCount(0);

    // Onboarding tab: no upload affordance, renders the existing table.
    await tabs.getByRole("button", { name: /Onboarding/ }).click();
    await expect(page.locator(".doc-dropzone")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Etapas por cliente" })).toBeVisible();
  });
});
