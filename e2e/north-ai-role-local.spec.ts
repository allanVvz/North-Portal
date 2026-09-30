import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { openAdminSession } from "./adminSession";

const TASK = "fb5335cd-7e33-42d2-b732-f8271994cd6e";
const EDIT = "a1dd4dac-9dbc-43bd-9896-e4b523f7e53c";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function openCard(page: Page, id: string, sidebar: boolean) {
  await page.evaluate((enabled) => localStorage.setItem("kb-sidebar-enabled", enabled ? "1" : "0"), sidebar);
  await page.goto(`/admin/kanban?task=${id}`);
  const root = page.locator(sidebar ? ".tdp" : ".tm");
  await expect(root).toBeVisible({ timeout: 30_000 });
  return root;
}

async function row(id: string) {
  const { data, error } = await db.from("tasks")
    .select("assignee,reviewer_id,north_ai_responsible,north_ai_reviewer,requires_review,payload")
    .eq("id", id).single();
  if (error) throw error;
  return data;
}

test("modal: North AI e humano coexistem e persistem em Responsável e Revisor", async ({ page }) => {
  test.setTimeout(180_000);
  await openAdminSession(page);
  let modal = await openCard(page, TASK, false);
  await expect(modal.getByText("North AI responsável", { exact: true })).toHaveCount(0);
  await expect(modal.getByText("North AI revisora", { exact: true })).toHaveCount(0);

  const assignee = modal.locator(".tm-cell", { hasText: "Responsável" });
  await assignee.getByRole("button", { name: "Adicionar responsável" }).click();
  await assignee.locator(".assignee-option-north-ai").click();
  await expect(assignee.getByTestId("north-ai-responsible-chip")).toBeVisible();
  await assignee.getByRole("button", { name: "Adicionar responsável" }).click();
  const human = assignee.locator(".assignee-option").filter({ hasNotText: "North AI" }).first();
  const humanName = (await human.textContent())!.trim();
  await human.click();
  await expect(assignee.locator(".assignee-chip-linked", { hasText: humanName })).toBeVisible();

  const reviewer = modal.locator(".tm-cell", { hasText: "Revisor" });
  const humanSelect = reviewer.getByRole("combobox", { name: "Revisor humano" });
  const reviewerId = await humanSelect.locator("option").nth(1).getAttribute("value");
  await humanSelect.selectOption({ index: 1 });
  await reviewer.getByRole("checkbox", { name: "North AI" }).check();
  await expect(reviewer.getByText("Revisor humano tem prioridade na decisão.")).toBeVisible();
  await expect.poll(async () => row(TASK)).toMatchObject({ north_ai_responsible: true, north_ai_reviewer: true, reviewer_id: reviewerId, requires_review: true });

  await page.reload();
  modal = page.locator(".tm");
  await expect(modal).toBeVisible({ timeout: 30_000 });
  await expect(modal.getByTestId("north-ai-responsible-chip")).toBeVisible();
  await expect(modal.getByRole("checkbox", { name: "North AI" })).toBeChecked();
  await modal.getByRole("button", { name: "Remover North AI responsável" }).click();
  await modal.getByRole("checkbox", { name: "North AI" }).uncheck();
  await expect.poll(async () => row(TASK)).toMatchObject({ north_ai_responsible: false, north_ai_reviewer: false, reviewer_id: reviewerId, requires_review: true });
  const freeTextAssignee = modal.locator(".tm-cell", { hasText: "Responsável" });
  await freeTextAssignee.getByRole("button", { name: "Adicionar responsável" }).dblclick();
  await freeTextAssignee.getByPlaceholder("Nome do responsável sem conta").fill("North AI");
  await freeTextAssignee.getByPlaceholder("Nome do responsável sem conta").press("Enter");
  await expect(freeTextAssignee.getByText("North AI (texto)")).toBeVisible();
  await expect.poll(async () => (await row(TASK)).north_ai_responsible).toBe(false);
});

test("painel lateral e Edição: múltiplos humanos e North AI persistem no mesmo campo", async ({ page }) => {
  test.setTimeout(180_000);
  await openAdminSession(page);
  let panel = await openCard(page, EDIT, true);
  const assignee = panel.locator(".tdp-attr", { hasText: "Responsável" });
  await assignee.getByRole("button", { name: "Adicionar responsável" }).click();
  await assignee.locator(".assignee-option-north-ai").click();
  await assignee.getByRole("button", { name: "Adicionar responsável" }).click();
  await assignee.locator(".assignee-option").filter({ hasNotText: "North AI" }).first().click();
  const reviewer = panel.locator(".tdp-attr", { hasText: "Revisores da Edição" });
  const humans = reviewer.locator(".tm-reviewer-list input[type=checkbox]");
  expect(await humans.count()).toBeGreaterThanOrEqual(2);
  await humans.nth(0).check();
  await humans.nth(1).check();
  await reviewer.getByRole("checkbox", { name: "North AI" }).check();
  await expect.poll(async () => row(EDIT)).toMatchObject({ north_ai_responsible: true, north_ai_reviewer: true, requires_review: true });
  expect(((await row(EDIT)).payload as { reviewer_ids: string[] }).reviewer_ids).toHaveLength(2);

  await page.reload();
  panel = page.locator(".tdp");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("north-ai-responsible-chip")).toBeVisible();
  await expect(panel.locator(".tm-reviewer-list input[type=checkbox]:checked")).toHaveCount(2);
  await expect(panel.getByRole("checkbox", { name: "North AI" })).toBeChecked();
  await panel.getByRole("button", { name: "Remover North AI responsável" }).click();
  await panel.getByRole("checkbox", { name: "North AI" }).uncheck();
  await expect.poll(async () => row(EDIT)).toMatchObject({ north_ai_responsible: false, north_ai_reviewer: false, requires_review: true });
});
