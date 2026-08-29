import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

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

test.describe("agenda recorrente contínua", () => {
  test.setTimeout(90_000);
  let sb: SupabaseClient;
  let parentId = "";

  test.beforeAll(() => { sb = serviceClient(); });
  test.afterAll(async () => {
    if (!parentId) return;
    await sb.from("tasks").delete().eq("plan_id", parentId);
    await sb.from("tasks").delete().eq("id", parentId);
  });

  test("usa intervalo, conclui com idempotência e expande os limites", async ({ page }) => {
    await login(page);
    const title = `[e2e ${RUN}] Agenda contínua`;
    const created = await page.request.post("/api/admin/tasks?scope=task", {
      data: {
        title,
        kind: "operacional",
        status: "backlog",
        priority: "media",
        due_date: "2026-08-03",
        start_date: "2026-08-03",
        end_date: "2026-08-03",
        recurrence_cadence: "semanal",
        recurrence_weekdays: [1, 3],
      },
    });
    expect(created.status()).toBe(201);
    const first = await created.json();
    parentId = first.plan_id;
    expect(first).toMatchObject({ due_date: "2026-08-03", recurrence_cadence: null });
    expect(first.payload).toMatchObject({ recurrence_parent_id: parentId, recurrence_cycle: 0 });

    const parent = await (await page.request.get(`/api/admin/tasks/${parentId}`)).json();
    const token = { expectedCycle: 0, expectedRevision: 1, expectedDueDate: "2026-08-03" };
    const completed = await page.request.post(`/api/admin/tasks/${parentId}/complete-cycle`, { data: token });
    expect(completed.ok()).toBeTruthy();
    const completion = await completed.json();
    expect(completion.parent).toMatchObject({ due_date: "2026-08-05", end_date: "2026-08-05" });
    expect(completion.task.payload).toMatchObject({ recurrence_cycle: 1, recurrence_parent_id: parentId });

    const repeated = await page.request.post(`/api/admin/tasks/${parentId}/complete-cycle`, { data: token });
    expect(repeated.ok()).toBeTruthy();
    const repeatedBody = await repeated.json();
    expect(repeatedBody.created).toBe(false);
    expect(repeatedBody.task.id).toBe(completion.task.id);
    expect(repeatedBody.parent.due_date).toBe("2026-08-05");

    const moved = await page.request.patch(`/api/admin/tasks/${completion.task.id}`, { data: { due_date: "2026-08-20" } });
    expect(moved.ok()).toBeTruthy();
    const expandedParent = await (await page.request.get(`/api/admin/tasks/${parentId}`)).json();
    expect(expandedParent).toMatchObject({ start_date: "2026-08-03", end_date: "2026-08-20", due_date: "2026-08-05" });

    await page.goto(`/admin/kanban?task=${parentId}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });
    await modal.getByRole("button", { name: "Abrir calendário" }).click();
    const calendar = page.locator(".cal-pop");
    await expect(calendar.locator(".cal-pop-grid")).toBeVisible();
    await expect(calendar.getByLabel("Intervalo selecionado")).toBeVisible();
    await expect(calendar.getByText("Recorrente", { exact: true })).toBeVisible();
    const calendarBox = await calendar.boundingBox();
    const viewport = page.viewportSize();
    expect(calendarBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(calendarBox!.x).toBeGreaterThanOrEqual(0);
    expect(calendarBox!.x + calendarBox!.width).toBeLessThanOrEqual(viewport!.width);
    await expect(modal.locator('input[type="date"]')).toHaveCount(0);
    await expect(modal.getByRole("button", { name: "Adicionar data" })).toHaveCount(0);
    await expect(modal.locator(".cal-date-chip")).toHaveCount(0);
  });
});
