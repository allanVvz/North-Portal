import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

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

test.describe("conclusão de ciclo três vezes por semana", () => {
  let sb: SupabaseClient;
  let parentId = "";

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error: clientError } = await sb.from("clients").select("id").eq("disabled", false).limit(1).single();
    if (clientError || !client) throw new Error(`Cliente para E2E não encontrado: ${clientError?.message}`);
    const { data: task, error } = await sb.from("tasks").insert({
      client_id: client.id,
      kind: "operacional",
      title: `[e2e ${Date.now()}] Rotina seg qua sex`,
      status: "backlog",
      due_date: "2026-07-20",
      recurrence_cadence: "semanal",
      recurrence_weekdays: [1, 3, 5],
      start_date: "2026-07-20",
      end_date: "2026-07-20",
      payload: { recurrence_group: true, recurrence_cycle: 0, recurrence_revision: 1 },
    }).select("id").single();
    if (error || !task) throw new Error(`Falha ao criar rotina E2E: ${error?.message}`);
    parentId = task.id as string;
  });

  test.afterAll(async () => {
    if (!parentId) return;
    await sb.from("tasks").delete().eq("plan_id", parentId);
    await sb.from("tasks").delete().eq("id", parentId);
  });

  test("avança segunda-quarta-sexta-segunda, cria uma execução por ciclo e recusa token antigo", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    const transitions = [
      ["2026-07-20", "2026-07-22"],
      ["2026-07-22", "2026-07-24"],
      ["2026-07-24", "2026-07-27"],
    ] as const;

    for (const [cycle, [current, next]] of transitions.entries()) {
      const response = await page.evaluate(async ({ id, expectedDueDate, expectedCycle }) => {
        const result = await fetch(`/api/admin/tasks/${id}/complete-cycle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedDueDate, expectedCycle, expectedRevision: 1 }),
        });
        return { status: result.status, body: await result.json() };
      }, { id: parentId, expectedDueDate: current, expectedCycle: cycle });
      expect(response.status).toBe(200);
      expect(response.body.parent.due_date).toBe(next);
      expect(response.body.task).toMatchObject({ due_date: next, plan_id: parentId, recurrence_cadence: null });
    }

    const stale = await page.evaluate(async ({ id }) => {
      const result = await fetch(`/api/admin/tasks/${id}/complete-cycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedDueDate: "2026-07-24", expectedCycle: 2, expectedRevision: 1 }),
      });
      return { status: result.status, body: await result.json() };
    }, { id: parentId });
    expect(stale.status).toBe(200);
    expect(stale.body.created).toBe(false);
    expect(stale.body.parent.due_date).toBe("2026-07-27");

    const changed = await page.request.patch(`/api/admin/tasks/${parentId}`, { data: { recurrence_weekdays: [1, 4] } });
    expect(changed.ok()).toBeTruthy();
    const staleRevision = await page.request.post(`/api/admin/tasks/${parentId}/complete-cycle`, {
      data: { expectedCycle: 3, expectedRevision: 1, expectedDueDate: "2026-07-27" },
    });
    expect(staleRevision.status()).toBe(409);
    const conflict = await staleRevision.json();
    expect(conflict.code).toBe("recurrence_schedule_changed");
    expect(conflict.parent.payload.recurrence_revision).toBe(2);

    const retried = await page.request.post(`/api/admin/tasks/${parentId}/complete-cycle`, {
      data: { expectedCycle: 3, expectedRevision: 2, expectedDueDate: "2026-07-27" },
    });
    expect(retried.ok()).toBeTruthy();
    expect((await retried.json()).parent.due_date).toBe("2026-07-30");

    const { data: children, error } = await sb.from("tasks").select("due_date,plan_id").eq("plan_id", parentId).order("due_date");
    if (error) throw error;
    expect(children).toEqual([
      { due_date: "2026-07-22", plan_id: parentId },
      { due_date: "2026-07-24", plan_id: parentId },
      { due_date: "2026-07-27", plan_id: parentId },
      { due_date: "2026-07-30", plan_id: parentId },
    ]);

    // Sem data-limite: a recorrência só encerra quando o molde vai para
    // aprovado/parada. Aí "Concluir ciclo" recusa e a data não avança.
    await sb.from("tasks").update({ status: "parada" }).eq("id", parentId);
    const ended = await page.request.post(`/api/admin/tasks/${parentId}/complete-cycle`, {
      data: { expectedCycle: 4, expectedRevision: 2, expectedDueDate: "2026-07-30" },
    });
    expect(ended.status()).toBe(409);
    expect((await ended.json()).code).toBe("recurrence_ended");
    const { data: frozen } = await sb.from("tasks").select("due_date").eq("id", parentId).single();
    expect(frozen?.due_date).toBe("2026-07-30");
    const { count } = await sb.from("tasks").select("id", { count: "exact", head: true }).eq("plan_id", parentId);
    expect(count).toBe(4);
  });
});
