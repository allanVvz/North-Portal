import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "admin@north.com";
const ADMIN_PASSWORD = "SenhaForte123!";
const RUN = Date.now();

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Credenciais Supabase ausentes para o E2E.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 20_000 });
}

test.describe("Kanban publicado, calendário temático e escala global", () => {
  test.setTimeout(90_000);
  let sb: SupabaseClient;
  let approvedId = "";
  let publishedId = "";
  const approvedTitle = `[e2e ${RUN}] Concluído`;
  const publishedTitle = `[e2e ${RUN}] Publicado`;

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error: clientError } = await sb.from("clients").select("id").eq("disabled", false).limit(1).single();
    if (clientError || !client) throw new Error(`Cliente para E2E não encontrado: ${clientError?.message}`);
    const { data, error } = await sb.from("tasks").insert([
      { client_id: client.id, kind: "criativo", title: approvedTitle, status: "aprovado", due_date: "2026-08-05", position: 7000 },
      { client_id: client.id, kind: "criativo", title: publishedTitle, status: "concluido", due_date: "2026-08-06", position: 7010 },
    ]).select("id,status");
    if (error || !data || data.length !== 2) throw new Error(`Falha ao criar cards E2E: ${error?.message}`);
    approvedId = data.find((task) => task.status === "aprovado")?.id as string;
    publishedId = data.find((task) => task.status === "concluido")?.id as string;
  });

  test.afterAll(async () => {
    if (approvedId || publishedId) await sb.from("tasks").delete().in("id", [approvedId, publishedId].filter(Boolean));
  });

  test("mescla apenas a projeção visual, preserva o status e mantém o calendário opaco nos dois temas", async ({ page }) => {
    await login(page);
    const original = await (await page.request.get("/api/admin/settings/tabs-visibility")).json();

    try {
      expect((await page.request.patch("/api/admin/settings/tabs-visibility", { data: { publicadoColumnVisible: false } })).ok()).toBeTruthy();
      await page.goto("/admin/kanban");

      const completed = page.locator(".kb-col", { has: page.locator(".kb-col-head", { hasText: "Concluído" }) });
      await expect(completed.getByText(approvedTitle)).toBeVisible({ timeout: 20_000 });
      const publishedCard = completed.locator(".kb-card", { hasText: publishedTitle });
      await expect(publishedCard).toContainText("Publicado");
      await expect(page.locator(".kb-col-head", { hasText: "Publicado" })).toHaveCount(0);

      await publishedCard.dragTo(completed.locator(".kb-col-head"));
      await expect.poll(async () => {
        const response = await page.request.get(`/api/admin/tasks/${publishedId}`);
        return (await response.json()).status;
      }).toBe("concluido");

      await publishedCard.click();
      const modal = page.locator(".tm");
      await modal.getByRole("button", { name: "Abrir calendário" }).first().click();
      const calendar = page.locator(".admin-shell > .cal-pop.cal-pop-range");
      await expect(calendar).toBeVisible();
      const light = await calendar.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow };
      });
      expect(light.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(light.shadow).not.toBe("none");
      await page.locator(".admin-shell").evaluate((element) => element.setAttribute("data-theme", "dark"));
      const dark = await calendar.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow };
      });
      expect(dark.background).not.toBe(light.background);
      expect(dark.border).not.toBe("rgba(0, 0, 0, 0)");
      expect(dark.shadow).not.toBe("none");

      expect(await page.locator("html").evaluate((element) => getComputedStyle(element).zoom)).toBe("0.8");
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(modal).toBeVisible();
      const modalBox = await modal.boundingBox();
      expect(modalBox).not.toBeNull();
      expect(modalBox!.x).toBeGreaterThanOrEqual(0);
      expect(modalBox!.width).toBeLessThanOrEqual(390 / 0.8 + 2);

      expect((await page.request.patch("/api/admin/settings/tabs-visibility", { data: { publicadoColumnVisible: true } })).ok()).toBeTruthy();
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto("/admin/kanban");
      await expect(page.locator(".kb-col", { has: page.locator(".kb-col-head", { hasText: "Concluído" }) }).getByText(approvedTitle)).toBeVisible();
      await expect(page.locator(".kb-col", { has: page.locator(".kb-col-head", { hasText: "Publicado" }) }).getByText(publishedTitle)).toBeVisible();
    } finally {
      await page.request.patch("/api/admin/settings/tabs-visibility", { data: { publicadoColumnVisible: Boolean(original.publicadoColumnVisible) } });
    }
  });
});
