import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

const PREFIX = `[e2e etapa escopo ${Date.now()}]`;
const firstTitle = `${PREFIX} Criativo A`;
const secondTitle = `${PREFIX} Criativo B`;
const CLIENT_SLUG = `e2e-stage-${Date.now()}`;
const CLIENT_EMAIL = `${CLIENT_SLUG}@example.com`;
const CLIENT_PASSWORD = `E2e!${randomUUID()}Z`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase E2E não configurado.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

async function loginClient(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(CLIENT_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(CLIENT_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(new RegExp(`/${CLIENT_SLUG}`), { timeout: 45_000 });
  return { page, close: () => context.close() };
}

test.describe("andamento por Entrega com etapa compartilhada", () => {
  test.setTimeout(180_000);
  let sb: SupabaseClient;
  const parentIds: string[] = [];
  let temporaryClientId = "";
  let temporaryUserId = "";

  test.beforeAll(() => { sb = serviceClient(); });
  test.afterAll(async () => {
    const cleanupErrors: Error[] = [];
    const parentDeletion = parentIds.length
      ? await sb.from("tasks").delete().in("id", parentIds)
      : { error: null };
    if (parentDeletion.error) cleanupErrors.push(parentDeletion.error);
    const { data: created } = await sb.from("tasks").select("id").like("title", `${PREFIX}%`);
    const childDeletion = created?.length
      ? await sb.from("tasks").delete().in("id", created.map((task) => task.id))
      : { error: null };
    if (childDeletion.error) cleanupErrors.push(childDeletion.error);
    if (temporaryUserId) {
      const { error: userError } = await sb.auth.admin.deleteUser(temporaryUserId);
      if (userError) cleanupErrors.push(userError);
    }
    if (temporaryClientId) {
      const { error: clientError } = await sb.from("clients").delete().eq("id", temporaryClientId);
      if (clientError) cleanupErrors.push(clientError);
    }
    const { count, error } = await sb.from("tasks").select("id", { count: "exact", head: true }).like("title", `${PREFIX}%`);
    if (error) cleanupErrors.push(error);
    if (count !== 0) cleanupErrors.push(new Error(`${count} card(s) temporário(s) não foram removidos.`));
    if (cleanupErrors.length) throw cleanupErrors[0];
  });

  test("Plano move só o Criativo escolhido; cabeçalho conclui a primeira etapa pendente", async ({ page }) => {
    await login(page);
    const plan = await page.request.post("/api/admin/tasks?scope=plan", {
      data: { slug: "north", kind: "plano_acao", title: `${PREFIX} Plano`, status: "backlog", priority: "media" },
    });
    expect(plan.ok(), await plan.text()).toBeTruthy();
    const planId = (await plan.json()).id as string;
    parentIds.push(planId);

    const createDelivery = async (title: string) => {
      const response = await page.request.post("/api/admin/tasks?scope=task", {
        data: { slug: "north", kind: "criativo", title, plan_id: planId, status: "backlog", priority: "media" },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      const step = await response.json();
      const link = (step.parents as { id: string; relation_kind: string; workflow_step_id: string }[])
        .find((parent) => parent.relation_kind === "workflow_step");
      expect(link).toBeTruthy();
      parentIds.push(link!.id);
      return { stepId: step.id as string, deliveryId: link!.id, workflowStepId: link!.workflow_step_id };
    };
    const first = await createDelivery(firstTitle);
    const second = await createDelivery(secondTitle);
    const replace = await page.request.patch(`/api/admin/tasks/${second.deliveryId}/relations`, {
      data: { current_child_id: second.stepId, child_id: first.stepId, workflow_step_id: second.workflowStepId },
    });
    expect(replace.ok(), await replace.text()).toBeTruthy();

    await page.goto(`/admin/operacao?area=planos-entregas&task=${planId}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });
    const firstRow = modal.locator(".tm-member", { hasText: firstTitle }).first();
    await expect(firstRow.locator("select.tm-step-status")).toBeVisible({ timeout: 20_000 });
    await firstRow.locator("select.tm-step-status").selectOption("em_producao");
    await expect(firstRow.locator("select.tm-step-status")).toHaveValue("em_producao");

    await expect.poll(async () => {
      const { data } = await sb.from("task_links").select("status_override")
        .eq("parent_id", first.deliveryId).eq("child_id", first.stepId).single();
      return data?.status_override;
    }, { timeout: 20_000 }).toBe("em_producao");
    const { data: siblingLink } = await sb.from("task_links").select("status_override")
      .eq("parent_id", second.deliveryId).eq("child_id", first.stepId).single();
    expect(siblingLink?.status_override).toBeNull();
    const { data: original } = await sb.from("tasks").select("status")
      .eq("id", first.stepId).single();
    expect(original?.status).toBe("backlog");

    const direct = await page.request.patch(`/api/admin/tasks/${first.stepId}`, { data: { status: "revisao" } });
    expect(direct.status()).toBe(409);

    await page.goto(`/admin/operacao?area=planos-entregas&task=${first.deliveryId}`);
    const deliveryModal = page.locator(".tm");
    await expect(deliveryModal).toBeVisible({ timeout: 20_000 });
    await deliveryModal.getByRole("button", { name: "Concluído", exact: true }).click();
    await expect.poll(async () => {
      const { data } = await sb.from("task_links").select("status_override")
        .eq("parent_id", first.deliveryId).eq("child_id", first.stepId).single();
      return data?.status_override;
    }, { timeout: 20_000 }).toBe("aprovado");

    const { data: firstLinks } = await sb.from("task_links").select("workflow_step_id")
      .eq("parent_id", first.deliveryId).eq("relation_kind", "workflow_step");
    const { data: secondLinks } = await sb.from("task_links").select("workflow_step_id")
      .eq("parent_id", second.deliveryId).eq("relation_kind", "workflow_step");
    expect(firstLinks?.length).toBe(2);
    expect(secondLinks?.length).toBe(1);
    const { data: statusRows } = await sb.from("tasks").select("id,status")
      .in("id", [first.deliveryId, second.deliveryId]);
    expect(statusRows?.find((task) => task.id === second.deliveryId)?.status).toBe("backlog");

    // Substituir o card de uma etapa descarta o andamento particular do elo
    // anterior. O novo card começa no próprio status e não herda a produção.
    const siblingStatus = await page.request.patch(`/api/admin/tasks/${second.deliveryId}/delivery-status`, {
      data: { status: "em_producao", stage_task_id: first.stepId, expected_status: "backlog" },
    });
    expect(siblingStatus.ok(), await siblingStatus.text()).toBeTruthy();
    const restore = await page.request.patch(`/api/admin/tasks/${second.deliveryId}/relations`, {
      data: { current_child_id: first.stepId, child_id: second.stepId, workflow_step_id: second.workflowStepId },
    });
    expect(restore.ok(), await restore.text()).toBeTruthy();
    const { data: replacedLink } = await sb.from("task_links")
      .select("child_id,status_override,completed_at_override")
      .eq("parent_id", second.deliveryId).eq("relation_kind", "workflow_step").single();
    expect(replacedLink).toMatchObject({ child_id: second.stepId, status_override: null, completed_at_override: null });
  });

  test("cliente aprova a Entrega correta quando o Roteiro é compartilhado", async ({ page, browser }) => {
    await login(page);
    const { data: client, error: clientError } = await sb.from("clients")
      .insert({ slug: CLIENT_SLUG, name: `${PREFIX} Cliente`, is_active: true }).select("id").single();
    if (clientError || !client) throw clientError ?? new Error("Cliente de teste não foi criado.");
    temporaryClientId = client.id;
    const { data: createdUser, error: userError } = await sb.auth.admin.createUser({
      email: CLIENT_EMAIL, password: CLIENT_PASSWORD, email_confirm: true,
      app_metadata: { role: "client", client_slug: CLIENT_SLUG, level: "gerente" },
    });
    if (userError || !createdUser.user) throw userError ?? new Error("Usuário de teste não foi criado.");
    temporaryUserId = createdUser.user.id;
    const { error: profileError } = await sb.from("profiles").upsert({
      id: temporaryUserId, role: "client", level: "gerente", client_id: temporaryClientId, full_name: `${PREFIX} Gerente`,
    }, { onConflict: "id" });
    if (profileError) throw profileError;
    const { error: flagsError } = await sb.from("client_flow_flags").insert({
      client_id: temporaryClientId, revisao_admin: true, revisao_cliente: true,
      aprovacao_admin: true, aprovacao_cliente: true,
    });
    if (flagsError) throw flagsError;

    const createDelivery = async (title: string) => {
      const response = await page.request.post("/api/admin/tasks?scope=task", {
        data: { slug: CLIENT_SLUG, kind: "criativo", title, status: "backlog", approver_id: temporaryUserId },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      const step = await response.json();
      const link = (step.parents as { id: string; relation_kind: string; workflow_step_id: string }[])
        .find((parent) => parent.relation_kind === "workflow_step");
      expect(link).toBeTruthy();
      parentIds.push(link!.id);
      return { stepId: step.id as string, deliveryId: link!.id, workflowStepId: link!.workflow_step_id };
    };
    const firstTitle = `${PREFIX} Aprovação A`;
    const secondTitle = `${PREFIX} Aprovação B`;
    const first = await createDelivery(firstTitle);
    const second = await createDelivery(secondTitle);
    const replace = await page.request.patch(`/api/admin/tasks/${second.deliveryId}/relations`, {
      data: { current_child_id: second.stepId, child_id: first.stepId, workflow_step_id: second.workflowStepId },
    });
    expect(replace.ok(), await replace.text()).toBeTruthy();
    const { error: statusError } = await sb.from("task_links")
      .update({ status_override: "aprovacao" })
      .eq("parent_id", first.deliveryId).eq("child_id", first.stepId);
    expect(statusError).toBeNull();

    const clientSession = await loginClient(browser);
    try {
      await clientSession.page.goto(`/${CLIENT_SLUG}#feedbacks`);
      const tile = clientSession.page.locator(".np-approval", { hasText: firstTitle });
      await expect(tile).toBeVisible({ timeout: 20_000 });
      await expect(clientSession.page.locator(".np-approval", { hasText: secondTitle })).toHaveCount(0);
      await tile.getByRole("button", { name: "Aprovar entrega" }).click();
      await expect(clientSession.page.getByText("Entrega aprovada.")).toBeVisible();
      await expect(tile).toHaveCount(0, { timeout: 20_000 });
    } finally {
      await clientSession.close();
    }
    const { data: firstLink } = await sb.from("task_links").select("status_override")
      .eq("parent_id", first.deliveryId).eq("child_id", first.stepId).single();
    const { data: secondLink } = await sb.from("task_links").select("status_override")
      .eq("parent_id", second.deliveryId).eq("child_id", first.stepId).single();
    expect(firstLink?.status_override).toBe("aprovado");
    expect(secondLink?.status_override).toBeNull();
    const { data: firstSteps } = await sb.from("task_links").select("child_id")
      .eq("parent_id", first.deliveryId).eq("relation_kind", "workflow_step");
    const { data: secondSteps } = await sb.from("task_links").select("child_id")
      .eq("parent_id", second.deliveryId).eq("relation_kind", "workflow_step");
    expect(firstSteps?.length).toBe(2);
    expect(secondSteps?.length).toBe(1);
  });
});
