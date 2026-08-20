import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RUN = Date.now();
const EXISTING_EMAIL = process.env.E2E_ADMIN_EMAIL?.trim();
const EXISTING_PASSWORD = process.env.E2E_ADMIN_PASSWORD?.trim();
const USE_EXISTING_USER = Boolean(EXISTING_EMAIL && EXISTING_PASSWORD);
const EMAIL = EXISTING_EMAIL ?? `e2e-performance-template-${RUN}@e2e-test.com`;
const PASSWORD = EXISTING_PASSWORD ?? `E2e-${RUN}-Strong!`;
const TEMPLATE_NAME = `Template E2E ${RUN}`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase não configurado para E2E.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(EMAIL);
  await page.getByPlaceholder("Sua senha").fill(PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

async function expectTwoOverlayLines(page: Page, labels: string[]) {
  const lines = page.locator(".perf-trend .recharts-line-curve");
  await expect(lines).toHaveCount(2);
  const strokes = await lines.evaluateAll((elements) => elements.map((element) => element.getAttribute("stroke")));
  expect(new Set(strokes).size).toBe(2);
  const legend = page.locator(".perf-trend .recharts-legend-wrapper");
  for (const label of labels) await expect(legend).toContainText(label);
}

test.describe("Performance · templates e seleção hierárquica", () => {
  let supabase: SupabaseClient;
  let userId = "";

  test.beforeAll(async () => {
    supabase = serviceClient();
    if (USE_EXISTING_USER) return;

    const { data, error } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role: "admin", level: "gerente" },
    });
    if (error || !data.user) throw new Error(error?.message ?? "Falha ao criar usuário E2E.");
    userId = data.user.id;
    const { error: profileError } = await supabase.from("profiles").upsert({ id: userId, role: "admin", level: "gerente", client_id: null });
    if (profileError) throw new Error(profileError.message);
  });

  test.afterAll(async () => {
    await supabase.from("performance_templates").delete().eq("name", TEMPLATE_NAME);
    if (!USE_EXISTING_USER && userId) await supabase.auth.admin.deleteUser(userId);
  });

  test("troca template, salva uma cópia e aplica checkbox aos gráficos", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page);
    await page.goto("/admin/performance");
    // Aquisição é a primeira tela por padrão — este teste exercita o
    // gráfico de Tendência e a comparação hierárquica, que são do Analytics.
    await page.getByRole("button", { name: "Analytics", exact: true }).click();

    const filterBox = page.locator(".perf-analysis-filterbar .kb-searchbar-box");
    await expect(filterBox).toContainText("Template: Funil completo", { timeout: 45_000 });
    await filterBox.click();
    await page.getByRole("button", { name: "Template", exact: true }).click();
    await page.getByRole("option", { name: /Fundo de funil/ }).click();
    await expect(page.getByText("Custo por conversa", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Salvar template", exact: true }).click();
    await page.getByLabel("Nome do template").fill(TEMPLATE_NAME);
    const saveResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/performance/templates") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Salvar para equipe" }).click();
    const savedTemplateResponse = await saveResponse;
    expect(savedTemplateResponse.status()).toBe(201);
    expect((await savedTemplateResponse.json()).scope).toBe("agency");
    await expect(filterBox).toContainText(`Template: ${TEMPLATE_NAME}`, { timeout: 20_000 });

    const objectiveRemove = page.getByRole("button", { name: "Remover filtro Objetivo" });
    if (await objectiveRemove.isVisible()) await objectiveRemove.click();
    const networkRemove = page.getByRole("button", { name: "Remover filtro Rede" });
    if (await networkRemove.isVisible()) await networkRemove.click();
    await expect(page.locator(".perf-kpi").filter({ hasText: "Custo por conversa" })).toContainText("R$", { timeout: 45_000 });

    const campaignChecks = page.getByRole("checkbox", { name: /^Selecionar campanha / });
    const firstCampaign = campaignChecks.first();
    await expect(firstCampaign).toBeVisible({ timeout: 90_000 });
    const campaignLabels = await Promise.all([0, 1].map(async (index) => (await campaignChecks.nth(index).getAttribute("aria-label"))?.replace("Selecionar campanha ", "") ?? ""));
    await firstCampaign.check();
    await campaignChecks.nth(1).check();
    await expect(page.locator(".perf-selection-compact")).toContainText("2");
    await expect(page.locator(".perf-trend .perf-card-sub")).toContainText("Comparando 2 campanhas");
    await expectTwoOverlayLines(page, campaignLabels);

    const detailResponse = page.waitForResponse((response) => response.url().includes("/api/admin/performance/insights/ads") && response.url().includes("level=adset"), { timeout: 90_000 });
    await page.getByRole("button", { name: "Conjuntos" }).click();
    expect((await detailResponse).status()).toBeLessThan(500);
    await expect(page.getByText("Carregando conjuntos de anúncios…")).toBeHidden({ timeout: 90_000 });
    const adsetTable = page.locator("table.perf-ads-table").filter({ has: page.getByRole("columnheader", { name: "Conjunto de anúncios" }) });
    const adsetChecks = adsetTable.locator("tbody input[type=checkbox]");
    await expect(adsetChecks.nth(1)).toBeVisible({ timeout: 30_000 });
    const adsetLabels = await Promise.all([0, 1].map(async (index) => (await adsetChecks.nth(index).getAttribute("aria-label"))?.replace("Selecionar ", "") ?? ""));
    await adsetChecks.nth(0).check();
    await adsetChecks.nth(1).check();
    await expect(page.locator(".perf-trend .perf-card-sub")).toContainText("Comparando 2 conjuntos");
    await expectTwoOverlayLines(page, adsetLabels);

    const adResponse = page.waitForResponse((response) => response.url().includes("/api/admin/performance/insights/ads") && response.url().includes("level=ad"), { timeout: 90_000 });
    await page.getByRole("button", { name: "Criativos" }).click();
    expect((await adResponse).status()).toBeLessThan(500);
    await expect(page.getByText("Carregando criativos…")).toBeHidden({ timeout: 90_000 });
    const adTable = page.locator("table.perf-ads-table").filter({ has: page.getByRole("columnheader", { name: "Criativo" }) });
    const adChecks = adTable.locator("tbody input[type=checkbox]");
    await expect(adChecks.nth(1)).toBeVisible({ timeout: 30_000 });
    const adLabels = await Promise.all([0, 1].map(async (index) => (await adChecks.nth(index).getAttribute("aria-label"))?.replace("Selecionar ", "") ?? ""));
    await adChecks.nth(0).check();
    await adChecks.nth(1).check();
    await expect(page.locator(".perf-trend .perf-card-sub")).toContainText("Comparando 2 criativos");
    await expectTwoOverlayLines(page, adLabels);
    if (process.env.E2E_SCREENSHOT_PATH) {
      await page.screenshot({ path: process.env.E2E_SCREENSHOT_PATH, fullPage: true });
    }
    await page.getByRole("button", { name: "Limpar seleção" }).click();
    await expect(page.locator(".perf-selection-compact")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Criativos", exact: true })).toBeVisible();
  });
});
