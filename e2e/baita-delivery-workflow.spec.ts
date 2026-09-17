import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Regressão real reportada em Operação. Este teste não cria nem altera dados:
// confirma o grafo publicado e o modal que a pessoa usa para lê-lo.
const DELIVERY_ID = "e0b23dce-3f4f-4d2a-bd30-eaa377dbba80";

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

test("Entrega Baita mostra as quatro etapas comuns vinculadas", async ({ page }) => {
  test.setTimeout(90_000);
  const sb = serviceClient();
  const { data: links, error } = await sb
    .from("task_links")
    .select("slot, child:tasks!task_links_child_id_fkey(kind, subtype)")
    .eq("parent_id", DELIVERY_ID)
    .eq("relation_kind", "workflow_step")
    .order("position");
  if (error) throw new Error(`leitura dos vínculos falhou: ${error.message}`);

  expect(links?.map((link) => link.slot)).toEqual(["roteiro", "captacao", "edicao", "publicacao"]);
  for (const link of links ?? []) {
    const child = link.child as unknown as { kind: string; subtype: string | null } | null;
    expect(child).toMatchObject({ kind: "operacional", subtype: link.slot });
  }

  await login(page);
  await page.goto(`/admin/operacao?task=${DELIVERY_ID}`);
  const modal = page.locator(".tm");
  await expect(modal).toBeVisible({ timeout: 20_000 });
  const steps = modal.locator(".tm-planmembers", { hasText: "Etapas" });
  await expect(steps).toBeVisible({ timeout: 20_000 });
  await expect(steps.locator(".tm-box-label")).toContainText("(4/4)");
  for (const label of ["Roteiro", "Captação", "Edição", "Publicação"]) {
    await expect(steps.getByText(label, { exact: true })).toBeVisible();
  }
});
