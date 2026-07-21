import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "admin@north.com";
const ADMIN_PASSWORD = "SenhaForte123!";
const TITLE = `[e2e ${Date.now()}] Progresso do modal`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Credenciais do Supabase ausentes.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
}

test.describe("progresso do modal de tarefa", () => {
  let sb: SupabaseClient;
  let taskId = "";

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error: clientError } = await sb.from("clients").select("id").eq("disabled", false).limit(1).single();
    if (clientError || !client) throw new Error(`Cliente para E2E não encontrado: ${clientError?.message}`);
    const { data: task, error } = await sb.from("tasks").insert({
      client_id: client.id,
      kind: "operacional",
      title: TITLE,
      status: "backlog",
      priority: "media",
    }).select("id").single();
    if (error || !task) throw new Error(`Falha ao criar tarefa E2E: ${error?.message}`);
    taskId = task.id as string;
  });

  test.afterAll(async () => {
    if (taskId) await sb.from("tasks").delete().eq("id", taskId);
  });

  test("respeita a flag visual e acompanha o status antes e depois de salvar", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await page.evaluate(() => localStorage.setItem("kb-attr-visible", JSON.stringify({ progress: false })));
    await page.goto("/admin/kanban");

    await page.locator(".kb-card", { hasText: TITLE }).click();
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible();
    await expect(modal.locator(".tm-head-progress")).toHaveCount(0);

    await page.evaluate(() => {
      localStorage.setItem("kb-attr-visible", JSON.stringify({ progress: true }));
      window.dispatchEvent(new Event("kb-attr-visible-change"));
    });
    await expect(modal.locator(".tm-head-progress b")).toHaveText("0%");

    await modal.getByRole("button", { name: "Em produção", exact: true }).click();
    await expect(modal.locator(".tm-head-progress b")).toHaveText("60%");
    await modal.getByRole("button", { name: "Concluído", exact: true }).click();
    await expect(modal.locator(".tm-head-progress b")).toHaveText("100%");
    await modal.getByRole("button", { name: "Salvar card" }).click();
    // The first PATCH route compilation in development can take several
    // seconds; wait for the real save completion instead of aborting its body.
    await expect(modal).toBeHidden({ timeout: 20_000 });

    const { data, error } = await sb.from("tasks").select("status").eq("id", taskId).single();
    if (error) throw error;
    expect(data.status).toBe("aprovado");
  });
});
