import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Read-only production regression for the real Baita plan. PATCH requests are
// intercepted in the browser so this spec never changes operational records.
const CREATIVE_ID = "b5a0f9ec-a1a0-480e-ac23-4e2b8978a4a1";
const OTHER_CREATIVE_ID = "0ab2f61f-ed5b-4e2a-85ec-7dc7353fa12e";
const SHARED_STAGE_ID = "8393b20d-81e3-4b9d-8731-750bc3fb0ae3";

function brazilianDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

test("plano Setembro/Outubro: prazo e responsável editam o Criativo, sem alterar a etapa compartilhada", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await login(page);
  const taskResponse = await page.request.get(`/api/admin/tasks/${CREATIVE_ID}`);
  expect(taskResponse.ok()).toBeTruthy();
  const original = await taskResponse.json();
  const otherResponse = await page.request.get(`/api/admin/tasks/${OTHER_CREATIVE_ID}`);
  expect(otherResponse.ok()).toBeTruthy();
  const otherOriginal = await otherResponse.json();
  const stageResponse = await page.request.get(`/api/admin/tasks/${SHARED_STAGE_ID}`);
  expect(stageResponse.ok()).toBeTruthy();
  const stageOriginal = await stageResponse.json();
  const nextDate = new Date(`${original.due_date}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const changedDate = nextDate.toISOString().slice(0, 10);
  await page.goto(`/admin/kanban?task=${CREATIVE_ID}`);
  const deliveryModal = page.locator(".tm");
  await expect(deliveryModal).toBeVisible({ timeout: 25_000 });
  await expect(deliveryModal.locator(".tm-head-client")).toContainText("Baita Conveniencia");
  await expect(deliveryModal.locator(".tm-cell", { hasText: "Prazo da Entrega" }).locator(".cal-pick-input"))
    .toHaveValue(brazilianDate(original.start_date ?? original.due_date));
  await expect(deliveryModal.locator(".tm-cell", { hasText: "Responsável pela Entrega" }))
    .toContainText(original.assignee);
  await expect(deliveryModal.locator(".tm-cell", { hasText: "Responsável pela Entrega" }).getByRole("button", { name: "Adicionar responsável" }))
    .toBeEnabled();
  const patches: Array<Record<string, unknown>> = [];
  await page.route(`**/api/admin/tasks/${CREATIVE_ID}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const patch = route.request().postDataJSON() as Record<string, unknown>;
    patches.push(patch);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...original, ...patch }) });
  });

  await page.goto("/admin/operacao?area=planos-entregas");
  const planItem = page.locator(".plan-acc-item", { hasText: "PLANO DE CONTEÚDO - SETEMBRO /OUTUBRO" });
  await expect(planItem).toBeVisible({ timeout: 25_000 });
  await planItem.locator(".plan-acc-title").click();
  const modal = page.locator(".tm");
  await expect(modal).toBeVisible({ timeout: 25_000 });
  await expect(modal.locator(".tm-title-input")).toHaveValue("PLANO DE CONTEÚDO - SETEMBRO /OUTUBRO");
  await expect(modal.locator(".tm-head-client")).toContainText("Baita Conveniencia");
  const creative = modal.locator(".tm-step-row", { hasText: "Cliente Passando Cartão" });
  await expect(creative).toBeVisible({ timeout: 25_000 });
  const date = creative.getByLabel("Prazo da Entrega de Cliente Passando Cartão");
  const assignee = creative.getByLabel("Responsável pela Entrega Cliente Passando Cartão");
  await expect(date).toHaveValue(original.due_date);
  await expect(assignee.locator("option:checked")).toHaveText(original.assignee);
  const reviewersResponse = await page.request.get("/api/admin/reviewers?slug=baita-conveniencia");
  expect(reviewersResponse.ok()).toBeTruthy();
  const reviewers = await reviewersResponse.json() as { adminReviewers?: Array<{ id: string; label: string }> };
  expect(reviewers.adminReviewers?.length).toBeGreaterThan(1);
  await expect.poll(() => assignee.locator("option").count(), { timeout: 30_000 }).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath("plano-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(creative).toBeVisible();
  expect(await modal.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath("plano-estreito.png") });
  await page.setViewportSize({ width: 1280, height: 720 });

  await date.fill(changedDate);
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toMatchObject({ due_date: changedDate, start_date: changedDate, end_date: changedDate });
  await expect(date).toHaveValue(changedDate);
  const otherCreative = modal.locator(".tm-step-row", { hasText: "Não é Todo Mundo" });
  await expect(otherCreative.getByLabel("Prazo da Entrega de Não é Todo Mundo")).toHaveValue(otherOriginal.due_date);

  const alternate = await assignee.locator("option").evaluateAll((options, currentAssignee) => options
    .map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent ?? "" }))
    .find((option) => option.value && option.text !== currentAssignee), original.assignee);
  expect(alternate).toBeTruthy();
  await assignee.selectOption(alternate!.value);
  await expect.poll(() => patches.length).toBe(2);
  expect(patches[1]).toMatchObject({ assignee: alternate!.text, assignee_profile_ids: [alternate!.value] });
  await expect(otherCreative.getByLabel("Prazo da Entrega de Não é Todo Mundo")).toHaveValue(otherOriginal.due_date);

  // A data e o responsável da etapa compartilhada vêm de outro card.
  const stageAfterResponse = await page.request.get(`/api/admin/tasks/${SHARED_STAGE_ID}`);
  expect(stageAfterResponse.ok()).toBeTruthy();
  const sharedStage = await stageAfterResponse.json();
  expect(sharedStage.due_date).toBe(stageOriginal.due_date);
  expect(sharedStage.assignee).toBe(stageOriginal.assignee);
});
