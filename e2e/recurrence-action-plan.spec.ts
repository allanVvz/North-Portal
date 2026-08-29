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

test.describe("ocorrência recorrente em Plano de Ação", () => {
  test.setTimeout(90_000);
  let sb: SupabaseClient;
  let planId = "";
  let parentId = "";
  let taskId = "";
  let clientSlug = "";
  let recurringPlanParentId = "";
  let recurringPlanExecutionId = "";
  let recurringPlanActivityId = "";
  const planTitle = `[e2e ${RUN}] Plano com ocorrência`;
  const taskTitle = `[e2e ${RUN}] Tarefa convertida`;

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error: clientError } = await sb.from("clients").select("id,slug").eq("disabled", false).limit(1).single();
    if (clientError || !client) throw new Error(`Cliente para E2E não encontrado: ${clientError?.message}`);
    const { data: plan, error: planError } = await sb.from("tasks").insert({
      client_id: client.id,
      kind: "plano_acao",
      title: planTitle,
      status: "backlog",
    }).select("id").single();
    if (planError || !plan) throw new Error(`Falha ao criar plano E2E: ${planError?.message}`);
    planId = plan.id as string;
    clientSlug = client.slug as string;
  });

  test.afterAll(async () => {
    if (parentId) {
      await sb.from("tasks").delete().eq("plan_id", parentId);
      await sb.from("tasks").delete().eq("id", parentId);
    }
    if (taskId) await sb.from("tasks").delete().eq("id", taskId);
    if (recurringPlanActivityId) await sb.from("tasks").delete().eq("id", recurringPlanActivityId);
    if (recurringPlanParentId) {
      await sb.from("tasks").delete().eq("plan_id", recurringPlanParentId);
      await sb.from("tasks").delete().eq("id", recurringPlanParentId);
    }
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
    // `plan_id` no corpo continua sendo o campo público de "Plano de Ação", mas
    // hoje ele vira um ELO: a coluna passou a significar só "ocorrência de
    // recorrência".
    expect(ordinary.plan_id).toBeNull();
    expect(ordinary.parents.map((p: { id: string }) => p.id)).toContain(planId);

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
    // Os DOIS vínculos convivem sem workaround: o pai da recorrência na coluna,
    // o plano no elo. Era exatamente para isso que existia `action_plan_id`.
    expect(first.payload).toMatchObject({ recurrence_parent_id: parentId });
    expect(first.parents.map((p: { id: string }) => p.id)).toContain(planId);

    const parent = await (await page.request.get(`/api/admin/tasks/${parentId}`)).json();
    expect(parent).toMatchObject({ plan_id: null, recurrence_cadence: "semanal", due_date: "2026-08-03" });
    expect(parent.parents).toHaveLength(0);

    const unlinked = await (await page.request.patch(`/api/admin/tasks/${first.id}`, { data: { plan_id: null } })).json();
    expect(unlinked.plan_id).toBe(parentId);
    expect(unlinked.parents).toHaveLength(0);
    const relinked = await (await page.request.patch(`/api/admin/tasks/${first.id}`, { data: { plan_id: planId } })).json();
    expect(relinked.plan_id).toBe(parentId);
    expect(relinked.parents.map((p: { id: string }) => p.id)).toEqual([planId]);

    // These assertions all follow a fresh page navigation/fetch against the
    // live DB — this suite has observed prod-network latency well past the
    // default 5s (see the 15-45s timeouts elsewhere in this file), so give
    // them real room instead of a tight default.
    await page.goto("/admin/plano");
    await page.getByRole("button", { name: "Lista", exact: true }).click();
    const planItem = page.locator(".plan-acc-item", { hasText: planTitle });
    await expect(planItem).toBeVisible({ timeout: 20_000 });
    await expect(planItem.locator(".plan-acc-progress b")).toHaveText("60%", { timeout: 20_000 });
    await planItem.getByRole("button", { name: "Expandir" }).click();
    await expect(planItem.locator(".plan-acc-list li")).toHaveCount(1, { timeout: 20_000 });
    await expect(planItem).toContainText(taskTitle);

    const completedResponse = await page.request.post(`/api/admin/tasks/${parentId}/complete-cycle`, {
      data: { expectedDueDate: "2026-08-03" },
    });
    expect(completedResponse.ok()).toBeTruthy();
    const completed = await completedResponse.json();
    expect(completed.task).toMatchObject({ plan_id: parentId, due_date: "2026-08-10", recurrence_cadence: null });
    // A ocorrência seguinte nasce fora do plano: o elo é da execução que estava
    // vinculada, não da regra de recorrência.
    expect(completed.task.parents ?? []).toHaveLength(0);

    const recurrenceMembers = (await (await page.request.get(`/api/admin/tasks?parentId=${parentId}`)).json()).tasks;
    expect(recurrenceMembers).toHaveLength(2);
    const planMembers = (await (await page.request.get(`/api/admin/tasks?parentId=${planId}`)).json()).tasks;
    expect(planMembers.map((task: { id: string }) => task.id)).toEqual([first.id]);

    await page.goto(`/admin/kanban?task=${parentId}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });
    await expect(modal.getByText(/Execuções da recorrência/)).toContainText("(2)", { timeout: 20_000 });

    await page.goto(`/admin/kanban?task=${first.id}`);
    const childModal = page.locator(".tm");
    await expect(childModal).toBeVisible({ timeout: 20_000 });
    const parentBox = childModal.locator(".tm-planmembers", { hasText: "Card pai (1)" });
    // parentBox's title comes from a separate client-side fetch
    // (TaskModal.tsx's recurrenceParent effect) that resolves after the modal
    // itself is already visible — needs its own generous timeout.
    await expect(parentBox).toContainText(parent.title, { timeout: 20_000 });
    await expect(parentBox.locator(".tm-member-unlink")).toHaveCount(1);
    await parentBox.locator(".tm-member-open").click();
    await expect(page.locator(".tm").getByText(/Execuções da recorrência/)).toContainText("(2)", { timeout: 20_000 });

    await page.goto(`/admin/kanban?task=${first.id}`);
    const reopenedChild = page.locator(".tm");
    await reopenedChild.locator(".tm-planmembers", { hasText: "Card pai (1)" }).locator(".tm-member-unlink").click();
    // The unlink DELETE is a real round-trip against the live DB (first-compile
    // of this route plus normal prod-network latency has been observed well
    // past the default 5s in this suite — see the 15-45s timeouts already used
    // elsewhere in this file for the same reason), so give it real room instead
    // of a tight default.
    await expect(reopenedChild.locator(".tm-planmembers", { hasText: "Card pai (1)" })).toHaveCount(0, { timeout: 45_000 });
    const standalone = await (await page.request.get(`/api/admin/tasks/${first.id}`)).json();
    expect(standalone.plan_id).toBeNull();
    expect(standalone.payload).not.toHaveProperty("recurrence_parent_id");
    // Soltar da recorrência não solta do plano: são dois vínculos separados, e
    // agora de fato independentes (um é coluna, o outro é elo).
    expect(standalone.parents.map((p: { id: string }) => p.id)).toEqual([planId]);

    const deletedParent = await page.request.delete(`/api/admin/tasks/${parentId}`);
    expect(deletedParent.ok()).toBeTruthy();
    const preservedChild = await page.request.get(`/api/admin/tasks/${completed.task.id}`);
    expect(preservedChild.ok()).toBeTruthy();
    const preserved = await preservedChild.json();
    expect(preserved).toMatchObject({ id: completed.task.id, plan_id: null });
    expect(preserved.payload).not.toHaveProperty("recurrence_parent_id");
    parentId = "";
  });

  test("cria, conclui, desativa e reativa um Plano recorrente sem duplicar atividades", async ({ page }) => {
    await login(page);
    const created = await page.request.post("/api/admin/tasks?scope=plan", {
      data: {
        slug: clientSlug,
        title: `[e2e ${RUN}] Plano recorrente`,
        kind: "plano_acao",
        due_date: "2026-08-03",
        start_date: "2026-08-03",
        end_date: "2026-08-03",
        recurrence_cadence: "semanal",
        recurrence_weekdays: [1],
      },
    });
    expect(created.status()).toBe(201);
    const firstPlan = await created.json();
    recurringPlanExecutionId = firstPlan.id;
    recurringPlanParentId = firstPlan.plan_id;
    expect(firstPlan).toMatchObject({ kind: "plano_acao", recurrence_cadence: null });

    const activityResponse = await page.request.post("/api/admin/tasks?scope=task", {
      data: { slug: clientSlug, title: `[e2e ${RUN}] Atividade original`, kind: "operacional", plan_id: firstPlan.id },
    });
    expect(activityResponse.status()).toBe(201);
    const activity = await activityResponse.json();
    recurringPlanActivityId = activity.id;

    const completed = await page.request.post(`/api/admin/tasks/${recurringPlanParentId}/complete-cycle`, {
      data: { expectedCycle: 0, expectedRevision: 1, expectedDueDate: "2026-08-03" },
    });
    expect(completed.ok()).toBeTruthy();
    const nextPlan = (await completed.json()).task;
    expect(nextPlan).toMatchObject({ kind: "plano_acao", due_date: "2026-08-10", plan_id: recurringPlanParentId });

    const originalActivities = (await (await page.request.get(`/api/admin/tasks?parentId=${firstPlan.id}`)).json()).tasks;
    const nextActivities = (await (await page.request.get(`/api/admin/tasks?parentId=${nextPlan.id}`)).json()).tasks;
    expect(originalActivities.map((item: { id: string }) => item.id)).toContain(activity.id);
    expect(nextActivities).toHaveLength(0);

    const disabled = await page.request.patch(`/api/admin/tasks/${recurringPlanParentId}`, { data: { recurrence_cadence: null } });
    expect(disabled.ok()).toBeTruthy();
    expect(await disabled.json()).toMatchObject({ id: recurringPlanParentId, recurrence_cadence: null, payload: { recurrence_group: true } });
    const history = (await (await page.request.get(`/api/admin/tasks?parentId=${recurringPlanParentId}`)).json()).tasks;
    expect(history).toHaveLength(2);

    const reactivated = await page.request.patch(`/api/admin/tasks/${recurringPlanParentId}`, {
      data: { recurrence_cadence: "semanal", recurrence_weekdays: [1] },
    });
    expect(reactivated.ok()).toBeTruthy();
    expect((await reactivated.json()).id).toBe(recurringPlanParentId);
    const sameHistory = (await (await page.request.get(`/api/admin/tasks?parentId=${recurringPlanParentId}`)).json()).tasks;
    expect(sameHistory).toHaveLength(2);
  });
});
