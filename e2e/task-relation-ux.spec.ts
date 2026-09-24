import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";
import type { TaskRecord } from "../lib/validation";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

test("Criativo do Plano troca o Roteiro e escolhe uma Captação compartilhada", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await login(page);
  const taskResponse = await page.request.get("/api/admin/tasks");
  expect(taskResponse.ok()).toBe(true);
  const { tasks } = await taskResponse.json() as { tasks: TaskRecord[] };
  const creative = tasks.find((task) => task.title === "Reels - Equilibrando a bebida");
  expect(creative).toBeTruthy();
  const original = tasks.find((task) => task.parents.some((parent) => parent.id === creative!.id && parent.slot === "roteiro"));
  const script = tasks.find((task) => task.title === "Roteiro do bloco — 6 Reels" && task.client_id === creative!.client_id);
  const capture = tasks.find((task) => task.title === "Gravação do bloco — 6 Reels" && task.client_id === creative!.client_id);
  expect(original && script && capture).toBeTruthy();
  expect(script!.completed_at, "Roteiro reutilizado precisa estar concluído para liberar a Captação").toBeTruthy();
  const scriptStepId = original!.parents.find((parent) => parent.id === creative!.id)!.workflow_step_id!;
  const captureStepId = capture!.parents.find((parent) => parent.slot === "captacao")!.workflow_step_id!;

  const materialsResponse = await page.request.get("/api/admin/drive/baita/materials");
  const materials = await materialsResponse.json() as { workspaces: Array<Record<string, unknown>> };
  await page.route("**/api/admin/drive/baita/materials", (route) => route.fulfill({ json: { workspaces: materials.workspaces.map((workspace) => workspace.capture_task_id === capture!.id ? { ...workspace, available_raw_count: 1, available_raw_limited: true } : workspace) } }));

  let replacements = 0;
  let links = 0;
  await page.route(`**/api/admin/tasks/${creative!.id}/relations`, async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as Record<string, string>;
    if (request.method() === "PATCH") {
      expect(body).toMatchObject({ current_child_id: original!.id, child_id: script!.id, workflow_step_id: scriptStepId });
      replacements++;
      await route.fulfill({ json: {
        previous: { ...original, parents: original!.parents.filter((parent) => parent.id !== creative!.id) },
        current: { ...script, parents: [...script!.parents, { id: creative!.id, relation_kind: "workflow_step", workflow_step_id: scriptStepId, slot: "roteiro", position: 10 }] },
      } });
      return;
    }
    expect(body).toMatchObject({ child_id: capture!.id, workflow_step_id: captureStepId, relation_kind: "workflow_step" });
    links++;
    await route.fulfill({ json: { ...capture, parents: [...capture!.parents, { id: creative!.id, relation_kind: "workflow_step", workflow_step_id: captureStepId, slot: "captacao", position: 20 }] } });
  });

  await page.goto(`/admin/operacao?area=planos-entregas&task=${creative!.id}`);
  const box = page.locator(".tm-planmembers", { hasText: "Etapas" });
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(box).toContainText("Conclua Roteiro antes de vincular Captação");
  await box.getByRole("button", { name: "Ligar um card existente à etapa Captação" }).click();
  await expect(page.locator(".tm-chain-panel")).toContainText("Conclua Roteiro antes de vincular Captação");
  await page.keyboard.press("Escape");
  await expect(page.locator(".tm-chain-panel")).toHaveCount(0);
  await expect(box).toBeVisible();
  await box.getByRole("button", { name: "Trocar card de Roteiro" }).click();
  const picker = page.locator(".tm-chain-panel");
  await picker.getByPlaceholder("Buscar card…").fill("Roteiro do bloco — 6 Reels");
  await picker.getByRole("button", { name: /Roteiro do bloco — 6 Reels/ }).click();
  await expect.poll(() => replacements).toBe(1);
  await expect(box.locator(".tm-box-label")).toContainText("(1/4)");
  await expect(box).toContainText(script!.title);
  await expect(box).not.toContainText("Conclua Roteiro antes de vincular Captação");
  await box.getByRole("button", { name: "Ligar um card existente à etapa Captação" }).click();
  await expect(picker).toContainText("Gravação do bloco — 6 Reels");
  await expect(picker).toContainText("Brutos no Drive");
  await picker.getByRole("button", { name: /Gravação do bloco — 6 Reels/ }).click();
  await expect.poll(() => links).toBe(1);
  await expect(box.locator(".tm-box-label")).toContainText("(2/4)");
  await page.screenshot({ path: testInfo.outputPath("creative-links-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(box.locator(".tm-box-label")).toContainText("(2/4)");
  await expect(box).toContainText(script!.title);
  await expect(box).toContainText(capture!.title);
  await page.screenshot({ path: testInfo.outputPath("creative-links-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});

test("Plano oferece criação e vínculo no mesmo controle", async ({ page }, testInfo) => {
  await login(page);
  const response = await page.request.get("/api/admin/tasks");
  expect(response.ok()).toBe(true);
  const { tasks } = await response.json() as { tasks: TaskRecord[] };
  const plan = tasks.find((task) => task.id === "7e1a162d-ff0f-414e-ad50-bea8b472fbcd");
  const creative = tasks.find((task) => task.title === "Reels - Equilibrando a bebida");
  const firstStep = tasks.find((task) => task.parents.some((parent) => parent.id === creative?.id && parent.slot === "roteiro"));
  expect(plan).toBeTruthy();
  expect(creative && firstStep).toBeTruthy();
  await page.goto(`/admin/operacao?area=planos-entregas&task=${plan!.id}`);
  const input = page.getByRole("combobox", { name: "Adicionar ao plano" });
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill("Equilibrando copos");
  const panel = page.locator(".pac-panel");
  await expect(panel.getByRole("group", { name: "Tipo do novo card" })).toBeVisible();
  await panel.getByRole("button", { name: "Criativo" }).first().click();
  await expect(panel).toContainText("O Criativo nasce com Roteiro");
  await expect(page.getByRole("button", { name: "Criar Criativo" })).toBeVisible();
  await expect(panel.locator(".pac-batch")).not.toHaveAttribute("open", "");
  await page.screenshot({ path: testInfo.outputPath("plan-create-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await input.scrollIntoViewIfNeeded();
  await expect(panel.getByRole("group", { name: "Tipo do novo card" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("plan-create-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);

  let createCalls = 0;
  await page.route("**/api/admin/tasks?scope=task", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ title: "Equilibrando copos", kind: "criativo", plan_id: plan!.id });
    createCalls++;
    return route.fulfill({ status: 201, json: firstStep });
  });
  await page.route(`**/api/admin/tasks?parentId=${plan!.id}`, (route) => route.fulfill({ json: { tasks: [creative] } }));
  await page.getByRole("button", { name: "Criar Criativo" }).click();
  await expect.poll(() => createCalls).toBe(1);
  const next = page.locator(".tm-relation-next");
  await expect(next).toContainText(creative!.title);
  await next.getByRole("button", { name: /Abrir card e organizar etapas/ }).click();
  await expect(page.getByRole("textbox", { name: "Título da tarefa" })).toHaveValue(creative!.title);
  await page.getByRole("button", { name: "Voltar para o card anterior" }).click();
  await expect(page.getByRole("textbox", { name: "Título da tarefa" })).toHaveValue(plan!.title);
});
