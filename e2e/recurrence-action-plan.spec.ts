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

test.describe("ocorrência recorrente em Plano de Ação", () => {
  test.setTimeout(90_000);
  let sb: SupabaseClient;
  let planId = "";
  let parentId = "";
  let taskId = "";
  const planTitle = `[e2e ${RUN}] Plano com ocorrência`;
  const taskTitle = `[e2e ${RUN}] Tarefa convertida`;

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error: clientError } = await sb.from("clients").select("id").eq("disabled", false).limit(1).single();
    if (clientError || !client) throw new Error(`Cliente para E2E não encontrado: ${clientError?.message}`);
    const { data: plan, error: planError } = await sb.from("tasks").insert({
      client_id: client.id,
      kind: "plano_acao",
      title: planTitle,
      status: "backlog",
    }).select("id").single();
    if (planError || !plan) throw new Error(`Falha ao criar plano E2E: ${planError?.message}`);
    planId = plan.id as string;
  });

  test.afterAll(async () => {
    if (parentId) {
      await sb.from("tasks").delete().eq("plan_id", parentId);
      await sb.from("tasks").delete().eq("id", parentId);
    }
    if (taskId) await sb.from("tasks").delete().eq("id", taskId);
    if (planId) await sb.from("tasks").delete().eq("id", planId);
  });

  test("preserva ambos os vínculos, conclui o ciclo e deixa a próxima ocorrência fora do plano", async ({ page }) => {
    await login(page);

    const createdResponse = await page.request.post("/api/admin/tasks?scope=task", {
      data: {
        title: taskTitle,
        kind: "operacional",
        status: "em_producao",
        priority: "media",
        due_date: "2026-08-03",
        start_date: "2026-08-03",
        plan_id: planId,
      },
    });
    expect(createdResponse.status()).toBe(201);
    const ordinary = await createdResponse.json();
    taskId = ordinary.id;
    expect(ordinary.plan_id).toBe(planId);

    const convertedResponse = await page.request.patch(`/api/admin/tasks/${ordinary.id}`, {
      data: {
        recurrence_cadence: "semanal",
        recurrence_weekdays: [1],
        recurrence_day_of_month: null,
      },
    });
    expect(convertedResponse.ok()).toBeTruthy();
    const first = await convertedResponse.json();
    expect(first.id).toBe(ordinary.id);
    parentId = first.plan_id;
    expect(parentId).toBeTruthy();
    expect(parentId).not.toBe(planId);
    expect(first).toMatchObject({ recurrence_cadence: null, status: "em_producao" });
    expect(first.payload).toMatchObject({ recurrence_parent_id: parentId, action_plan_id: planId });

    const parent = await (await page.request.get(`/api/admin/tasks/${parentId}`)).json();
    expect(parent).toMatchObject({ plan_id: null, recurrence_cadence: "semanal", due_date: "2026-08-03" });
    expect(parent.payload).not.toHaveProperty("action_plan_id");

    const unlinked = await (await page.request.patch(`/api/admin/tasks/${first.id}`, { data: { plan_id: null } })).json();
    expect(unlinked.plan_id).toBe(parentId);
    expect(unlinked.payload).not.toHaveProperty("action_plan_id");
    const relinked = await (await page.request.patch(`/api/admin/tasks/${first.id}`, { data: { plan_id: planId } })).json();
    expect(relinked.plan_id).toBe(parentId);
    expect(relinked.payload.action_plan_id).toBe(planId);

    await page.goto("/admin/plano");
    await page.getByRole("button", { name: "Lista", exact: true }).click();
    const planItem = page.locator(".plan-acc-item", { hasText: planTitle });
    await expect(planItem).toBeVisible();
    await expect(planItem.locator(".plan-acc-progress b")).toHaveText("60%");
    await planItem.getByRole("button", { name: "Expandir" }).click();
    await expect(planItem.locator(".plan-acc-list li")).toHaveCount(1);
    await expect(planItem).toContainText(taskTitle);

    const completedResponse = await page.request.post(`/api/admin/tasks/${parentId}/complete-cycle`, {
      data: { expectedDueDate: "2026-08-03" },
    });
    expect(completedResponse.ok()).toBeTruthy();
    const completed = await completedResponse.json();
    expect(completed.task).toMatchObject({ plan_id: parentId, due_date: "2026-08-10", recurrence_cadence: null });
    expect(completed.task.payload).not.toHaveProperty("action_plan_id");

    const recurrenceMembers = (await (await page.request.get(`/api/admin/tasks?parentId=${parentId}`)).json()).tasks;
    expect(recurrenceMembers).toHaveLength(2);
    const planMembers = (await (await page.request.get(`/api/admin/tasks?parentId=${planId}`)).json()).tasks;
    expect(planMembers.map((task: { id: string }) => task.id)).toEqual([first.id]);

    await page.goto(`/admin/kanban?task=${parentId}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });
    await expect(modal.getByText(/Execuções da recorrência/)).toContainText("(2)");
  });
});
