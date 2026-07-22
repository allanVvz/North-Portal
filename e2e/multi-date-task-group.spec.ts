import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "admin@north.com";
const ADMIN_PASSWORD = "SenhaForte123!";
const RUN = Date.now();

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Credenciais Supabase ausentes para o E2E.");
  return createClient(url, key);
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 20_000 });
}

test.describe("tarefa com multiplas datas", () => {
  test.setTimeout(60_000);
  let sb: SupabaseClient;
  let parentId = "";
  const standaloneIds: string[] = [];

  test.beforeAll(() => { sb = serviceClient(); });
  test.afterAll(async () => {
    if (parentId) {
      await sb.from("tasks").delete().eq("plan_id", parentId);
      await sb.from("tasks").delete().eq("id", parentId);
    }
    if (standaloneIds.length) await sb.from("tasks").delete().in("id", standaloneIds);
  });

  test("salva card legado nao-Criativo em Publicado sem liberar novas transicoes invalidas", async ({ page }) => {
    const { data: legacy, error } = await sb.from("tasks").insert({
      kind: "agendamento",
      title: `[e2e ${RUN}] Publicado legado`,
      status: "concluido",
      priority: "baixa",
    }).select("id").single();
    if (error || !legacy) throw new Error(error?.message ?? "Falha ao criar card legado.");
    standaloneIds.push(legacy.id);
    await login(page);

    const saved = await page.request.patch(`/api/admin/tasks/${legacy.id}`, {
      data: { description: "Edicao nao relacionada ao status." },
    });
    expect(saved.ok()).toBeTruthy();

    const ordinary = await page.request.post("/api/admin/tasks?scope=task", {
      data: { title: `[e2e ${RUN}] Agendamento comum`, kind: "agendamento", status: "backlog" },
    });
    expect(ordinary.ok()).toBeTruthy();
    const ordinaryTask = await ordinary.json();
    standaloneIds.push(ordinaryTask.id);
    const rejected = await page.request.patch(`/api/admin/tasks/${ordinaryTask.id}`, { data: { status: "concluido" } });
    expect(rejected.status()).toBe(400);
  });

  test("mantem a primeira tarefa visivel e so materializa a futura ao concluir o ciclo", async ({ page }) => {
    await login(page);
    const title = `[e2e ${RUN}] Multidata`;
    const dates = ["2026-08-03", "2026-08-05"];
    const ordinaryResponse = await page.request.post("/api/admin/tasks?scope=task", {
      data: {
        title,
        kind: "operacional",
        status: "backlog",
        priority: "media",
        due_date: dates[0],
        start_date: dates[0],
      },
    });
    expect(ordinaryResponse.status()).toBe(201);
    const ordinary = await ordinaryResponse.json();
    expect(ordinary.plan_id).toBeNull();

    const convertedResponse = await page.request.patch(`/api/admin/tasks/${ordinary.id}`, {
      data: { payload: { explicit_occurrence_dates: dates } },
    });
    expect(convertedResponse.ok()).toBeTruthy();
    const first = await convertedResponse.json();
    expect(first.id).toBe(ordinary.id);
    parentId = first.plan_id;
    expect(parentId).toBeTruthy();
    expect(first).toMatchObject({ due_date: dates[0], recurrence_cadence: null });
    expect(first.payload).not.toHaveProperty("deferred_until_accessed");

    const parentResponse = await page.request.get(`/api/admin/tasks/${parentId}`);
    expect(parentResponse.ok()).toBeTruthy();
    expect(await parentResponse.json()).toMatchObject({ recurrence_cadence: "semanal", due_date: dates[0] });

    const relatedResponse = await page.request.get(`/api/admin/tasks?parentId=${parentId}`);
    expect(relatedResponse.ok()).toBeTruthy();
    const related = (await relatedResponse.json()).tasks;
    expect(related).toHaveLength(1);
    expect(related[0].id).toBe(first.id);

    const comment = { author: "Admin North", text: "Replicar no grupo", at: new Date().toISOString() };
    const patched = await page.request.patch(`/api/admin/tasks/${first.id}`, {
      data: { status: "em_producao", payload: { ...first.payload, comments: [comment] } },
    });
    expect(patched.ok()).toBeTruthy();

    const beforeCycle = (await (await page.request.get(`/api/admin/tasks?parentId=${parentId}`)).json()).tasks;
    expect(beforeCycle).toHaveLength(1);
    expect(beforeCycle[0]).toMatchObject({ status: "em_producao", due_date: dates[0] });

    await page.goto("/admin/kanban");
    await expect(page.locator(".kb-card", { hasText: title })).toHaveCount(1, { timeout: 15_000 });

    const firstCycle = await page.request.post(`/api/admin/tasks/${parentId}/complete-cycle`, { data: { expectedDueDate: dates[0] } });
    expect(firstCycle.ok()).toBeTruthy();
    const firstCycleBody = await firstCycle.json();
    expect(firstCycleBody.parent.due_date).toBe(dates[1]);
    expect(firstCycleBody.task.payload).toMatchObject({ deferred_until_accessed: true });

    const editedCurrent = await page.request.patch(`/api/admin/tasks/${first.id}`, {
      data: { description: "Edicao depois de materializar a futura.", payload: { ...first.payload, comments: [comment] } },
    });
    expect(editedCurrent.ok()).toBeTruthy();

    const afterFirstCycle = (await (await page.request.get(`/api/admin/tasks?parentId=${parentId}`)).json()).tasks;
    expect(afterFirstCycle).toHaveLength(2);
    expect(afterFirstCycle.map((task: { due_date: string }) => task.due_date).sort()).toEqual(dates);
    expect(afterFirstCycle.find((task: { due_date: string }) => task.due_date === dates[1]).payload)
      .toMatchObject({ deferred_until_accessed: true });

    await page.goto("/admin");
    await page.getByText(title, { exact: true }).first().click();
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible();
    await modal.getByText(/Futura.*abrir tarefa/).click();
    await expect(modal.getByRole("button", { name: "Voltar para o card anterior" })).toBeVisible({ timeout: 15_000 });

    const activated = (await (await page.request.get(`/api/admin/tasks?parentId=${parentId}`)).json()).tasks
      .find((task: { due_date: string }) => task.due_date === dates[1]);
    expect(activated.payload).not.toHaveProperty("deferred_until_accessed");

    const lastCycle = await page.request.post(`/api/admin/tasks/${parentId}/complete-cycle`, { data: { expectedDueDate: dates[1] } });
    expect(lastCycle.ok()).toBeTruthy();
    expect((await lastCycle.json()).parent.due_date).toBeNull();
    const afterCycles = (await (await page.request.get(`/api/admin/tasks?parentId=${parentId}`)).json()).tasks;
    expect(afterCycles).toHaveLength(2);

    await page.goto("/admin/kanban");
    await expect(page.locator(".kb-card", { hasText: title })).toHaveCount(2, { timeout: 15_000 });
  });
});
