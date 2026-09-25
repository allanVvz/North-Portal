import { expect, test, type Page } from "@playwright/test";
import { openAdminSession } from "./adminSession";

const COMMENT_CARD = "f6c9580e-aa2f-486d-8937-88dbe52a6bcd";
const FLOW_CARD = "65ec6261-3b67-4be4-9254-fe342ea2e43f";

async function login(page: Page) {
  await openAdminSession(page);
}

async function keepTaskTestsReadOnly(page: Page) {
  let patchAttempts = 0;
  await page.route(/\/api\/admin\/tasks\/[^/?]+(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "PATCH") { await route.continue(); return; }
    patchAttempts += 1;
    const response = await page.request.get(route.request().url());
    await route.fulfill({ status: response.status(), contentType: "application/json", body: await response.body() });
  });
  return () => patchAttempts;
}

async function openCard(page: Page, id: string) {
  await page.goto(`/admin/operacao?area=planos-entregas&task=${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tm:not(.creative-drive-modal)")).toBeVisible({ timeout: 30_000 });
}

test("card largo mantém menu de comentários acessível", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const patchAttempts = await keepTaskTestsReadOnly(page);
  await login(page);
  await openCard(page, COMMENT_CARD);
  const menu = page.getByRole("button", { name: "Ações do comentário" }).first();
  await expect(menu).toBeVisible({ timeout: 30_000 });
  await menu.scrollIntoViewIfNeeded();
  await menu.click();
  const edit = page.getByRole("menuitem", { name: "Editar" });
  const remove = page.getByRole("menuitem", { name: "Excluir" });
  await expect(edit).toBeVisible();
  await expect(remove).toBeVisible();
  const panel = page.locator(".tm-comment-actions-panel");
  expect(await panel.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("comments-desktop.png") });
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await openCard(page, COMMENT_CARD);
  const narrowMenu = page.getByRole("button", { name: "Ações do comentário" }).first();
  await narrowMenu.scrollIntoViewIfNeeded();
  await narrowMenu.click();
  await expect(edit).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("comments-narrow.png") });
  expect(patchAttempts()).toBe(0);
});

test("etapas mostram ícones distintos, nomes sem tipo repetido e corrente compacta", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const patchAttempts = await keepTaskTestsReadOnly(page);
  await login(page);
  await page.goto(`/admin/operacao?area=planos-entregas&task=${FLOW_CARD}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tm:not(.creative-drive-modal)")).toBeVisible({ timeout: 30_000 });
  const steps = page.locator(".tm-planmembers .tm-step-row");
  await expect(steps.first()).toBeVisible({ timeout: 60_000 });
  await expect(steps.first().locator(".tm-workflow-icon")).toBeVisible();
  await expect(steps.first().locator(".tm-step-card-name strong")).toHaveCount(0);
  const chain = steps.first().locator(".tm-chain-replace");
  await expect(chain).toBeVisible();
  await expect(chain).toHaveText("");
  await expect(chain.locator("svg")).toBeVisible();
  await steps.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("steps-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/operacao?area=planos-entregas&task=${FLOW_CARD}`, { waitUntil: "domcontentloaded" });
  await expect(steps.first()).toBeVisible({ timeout: 30_000 });
  await steps.first().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("steps-narrow.png") });
  expect(patchAttempts()).toBe(0);
});

test("documento prioriza preview e mantém detalhes e ações compactos", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto("/admin/documentos");
  const row = page.locator(".doc-table tbody tr").filter({ hasText: /PDF/ }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator(".doc-name").click();
  const modal = page.locator(".docprev-tm");
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await expect(modal.locator(".file-preview")).toBeVisible();
  await expect(modal.locator(".file-preview-loading")).toBeHidden({ timeout: 45_000 });
  await expect(modal.locator(".docprev-overview-row")).toHaveCount(2);
  await expect(modal.locator(".docprev-file-facts > div").first()).toBeVisible();
  await expect(modal.getByRole("button", { name: /Compartilhar/ })).toBeVisible();
  const fileUrl = await modal.getByRole("link", { name: /Baixar/ }).getAttribute("href");
  expect(fileUrl).toBeTruthy();
  const fileResponse = await page.request.get(fileUrl!);
  expect(fileResponse.ok()).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("document-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(modal.locator(".file-preview-loading")).toBeHidden({ timeout: 45_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("document-narrow.png") });
});
