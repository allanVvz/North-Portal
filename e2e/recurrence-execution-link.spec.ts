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
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

// Cobre os dois pedidos de 2026-09-16 sobre recorrência: (1) concluir a
// EXECUÇÃO deve avançar o ciclo sozinho, igual a concluir uma etapa de fluxo
// avança a entrega — sem precisar do botão manual "Concluir ciclo"; (2)
// vincular um card já existente como execução de um ciclo substitui a
// execução automática pendente daquele ciclo, em vez de duplicar.
test.describe("recorrência: conclusão automática e vínculo de execução existente", () => {
  let sb: SupabaseClient;
  let clientId = "";
  let parentId = "";
  let childId = "";

  test.beforeEach(async () => {
    sb = serviceClient();
    const { data: client, error: clientError } = await sb.from("clients").select("id").eq("disabled", false).limit(1).single();
    if (clientError || !client) throw new Error(`Cliente para E2E não encontrado: ${clientError?.message}`);
    clientId = client.id as string;
    const { data: parent, error: parentError } = await sb.from("tasks").insert({
      client_id: clientId,
      kind: "operacional",
      title: `[e2e ${Date.now()}] Rotina semanal`,
      status: "backlog",
      due_date: "2026-07-20",
      recurrence_cadence: "semanal",
      recurrence_weekdays: [1],
      start_date: "2026-07-20",
      end_date: "2026-07-20",
      payload: { recurrence_group: true, recurrence_cycle: 0, recurrence_revision: 1 },
    }).select("id").single();
    if (parentError || !parent) throw new Error(`Falha ao criar molde E2E: ${parentError?.message}`);
    parentId = parent.id as string;

    // A execução do ciclo 0, como o molde já nasce com ela (currentRecurringExecutionFields).
    const { data: child, error: childError } = await sb.from("tasks").insert({
      client_id: clientId,
      kind: "operacional",
      title: `[e2e ${Date.now()}] Rotina semanal`,
      status: "backlog",
      due_date: "2026-07-20",
      plan_id: parentId,
      payload: { recurrence_parent_id: parentId, recurrence_cycle: 0, occurrence_date: "2026-07-20" },
    }).select("id").single();
    if (childError || !child) throw new Error(`Falha ao criar execução E2E: ${childError?.message}`);
    childId = child.id as string;
  });

  test.afterEach(async () => {
    if (parentId) await sb.from("tasks").delete().eq("plan_id", parentId);
    if (parentId) await sb.from("tasks").delete().eq("id", parentId);
  });

  test("concluir a execução avança o ciclo sozinho", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    const response = await page.request.patch(`/api/admin/tasks/${childId}`, { data: { status: "aprovado" } });
    expect(response.ok()).toBeTruthy();

    const { data: parent, error } = await sb.from("tasks").select("due_date,payload").eq("id", parentId).single();
    if (error) throw error;
    expect((parent?.payload as Record<string, unknown>).recurrence_cycle).toBe(1);
    expect(parent?.due_date).toBe("2026-07-27");

    const { data: nextChild } = await sb.from("tasks").select("id,due_date")
      .eq("plan_id", parentId).contains("payload", { recurrence_cycle: 1 }).maybeSingle();
    expect(nextChild).toBeTruthy();
    expect(nextChild?.due_date).toBe("2026-07-27");

    // Concluir a execução ANTIGA de novo (já superada) não pode reavançar.
    const again = await page.request.patch(`/api/admin/tasks/${childId}`, { data: { status: "backlog" } });
    expect(again.ok()).toBeTruthy();
    const retried = await page.request.patch(`/api/admin/tasks/${childId}`, { data: { status: "aprovado" } });
    expect(retried.ok()).toBeTruthy();
    const { data: parentAfterRetry } = await sb.from("tasks").select("payload").eq("id", parentId).single();
    expect((parentAfterRetry?.payload as Record<string, unknown>).recurrence_cycle).toBe(1);
  });

  test("vincular um card existente substitui a execução pendente do ciclo", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    const { data: existing, error: existingError } = await sb.from("tasks").insert({
      client_id: clientId,
      kind: "criativo",
      title: `[e2e ${Date.now()}] Entrega avulsa que vira execução`,
      status: "backlog",
      due_date: "2026-07-21",
    }).select("id").single();
    if (existingError || !existing) throw new Error(`Falha ao criar card avulso E2E: ${existingError?.message}`);
    const existingId = existing.id as string;

    const response = await page.request.post(`/api/admin/tasks/${parentId}/recurrence-executions`, {
      data: { child_id: existingId },
    });
    expect(response.ok()).toBeTruthy();
    const linked = await response.json();
    expect(linked.plan_id).toBe(parentId);
    expect(linked.payload.recurrence_cycle).toBe(0);

    // A execução auto-gerada do mesmo ciclo foi solta, não apagada.
    const { data: original } = await sb.from("tasks").select("plan_id,payload").eq("id", childId).single();
    expect(original?.plan_id).toBeNull();

    // Só UM card ocupa o ciclo 0 deste molde agora.
    const { data: occupants } = await sb.from("tasks").select("id")
      .eq("plan_id", parentId).contains("payload", { recurrence_cycle: 0 });
    expect(occupants?.map((r) => r.id)).toEqual([existingId]);

    await sb.from("tasks").delete().eq("id", existingId);
  });
});
