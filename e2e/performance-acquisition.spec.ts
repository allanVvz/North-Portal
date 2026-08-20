import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_ADMIN_EMAIL?.trim();
const PASSWORD = process.env.E2E_ADMIN_PASSWORD?.trim();

async function login(page: Page) {
  if (!EMAIL || !PASSWORD) test.skip(true, "Defina E2E_ADMIN_EMAIL e E2E_ADMIN_PASSWORD para validar a tela autenticada.");
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(EMAIL!);
  await page.getByPlaceholder("Sua senha").fill(PASSWORD!);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

function dayOffset(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function paidRow(id: string, date: string, campaignId: string, campaignName: string, metrics: Record<string, number>, extra: Record<string, unknown> = {}) {
  return {
    id, date, campaignId, campaignName, metrics, accountId: "acc", accountName: "Conta Meta",
    platform: "facebook", source: "paid", type: "outro", caption: campaignName, permalink: null,
    ...extra,
  };
}

test("dashboard de aquisição preserva hierarquia, comparativo e estados vazios", async ({ page }) => {
  test.setTimeout(150_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await login(page);
  await page.goto("/admin/performance");
  await page.getByRole("button", { name: "Aquisição", exact: true }).click();

  const dashboard = page.getByTestId("acquisition-dashboard");
  await expect(dashboard).toBeVisible();
  // "Evolução" title agora é composto a partir das métricas selecionadas
  // (default custo+mensagens = "Investimento x Conversas iniciadas") em vez
  // de um texto fixo.
  await expect(dashboard.getByText("Investimento x Conversas iniciadas")).toBeVisible();
  await expect(dashboard.getByText("Funil de aquisição")).toBeVisible();
  await expect(dashboard.locator(".acq-object-wrap img")).toBeVisible();

  // Topo (data + filtro composto) agora é compartilhado com Analytics —
  // renderizado uma vez fora da div de teste do dashboard de Aquisição.
  const dateField = page.locator(".perf-daterange-trigger");
  await expect(dateField).toHaveCount(1);
  await expect(page.locator("input[type=date]")).toHaveCount(0);

  const composite = page.locator(".perf-analysis-filterbar");
  await composite.locator(".kb-searchbar-box").click();
  await composite.getByRole("button", { name: "Campanha", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Buscar campanha" })).toBeVisible();
  const campaignChecks = composite.locator(".acq-filter-option input[type=checkbox]");
  await expect(campaignChecks.first()).toBeVisible({ timeout: 60_000 });
  await expect(campaignChecks.first()).toBeChecked();
  await page.keyboard.press("Escape");

  // A tabela Campanhas/Conjuntos/Criativos agora é compartilhada com
  // Analytics e vive fora da div de teste do dashboard de Aquisição; no
  // nível padrão "Campanhas" ela nunca mostra a coluna "Criativo".
  await expect(page.getByRole("columnheader", { name: "Criativo" })).toHaveCount(0);
  await expect(dashboard.locator(".acq-gauge-card")).toHaveCount(3);
  await expect(dashboard.locator(".acq-flow-stage")).toHaveCount(3);
  await expect(dashboard.locator(".acq-flow-arrow")).toHaveCount(2);
  await expect(dashboard.locator(".acq-message-branch")).toBeVisible();
  await expect(dashboard.locator(".acq-loading")).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(() => dashboard.locator(".acq-object-wrap img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(1200, 1100);
  await dashboard.screenshot({ path: ".codex-run/performance-acquisition-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dashboard).toBeVisible();
  await expect(dashboard.locator(".acq-conversion-flow")).toBeVisible();
  expect(await dashboard.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await dashboard.screenshot({ path: ".codex-run/performance-acquisition-mobile.png" });

  expect(pageErrors, "erros JavaScript na página").toEqual([]);
  expect(consoleErrors, "console.error no fluxo de aquisição").toEqual([]);
});

test("filtros multi de campanha e conjunto atualizam KPIs, gráfico e criativos", async ({ page }) => {
  test.setTimeout(150_000);
  const currentDate = dayOffset(-5);
  const previousDate = dayOffset(-35);
  const baseRows = [
    paidRow("a-now", currentDate, "cmp-a", "Campanha Alfa", { custo: 120, impressoes: 12000, cliques: 240, cliquesLink: 120, leads: 12, mensagens: 24, alcance: 9000 }),
    paidRow("a-prev", previousDate, "cmp-a", "Campanha Alfa", { custo: 60, impressoes: 8000, cliques: 120, leads: 6, mensagens: 12, alcance: 6000 }),
    paidRow("b-now", currentDate, "cmp-b", "Campanha Beta", { custo: 180, impressoes: 18000, cliques: 360, leads: 18, mensagens: 36, alcance: 14000 }),
    paidRow("b-prev", previousDate, "cmp-b", "Campanha Beta", { custo: 90, impressoes: 10000, cliques: 180, leads: 9, mensagens: 18, alcance: 8000 }),
  ];

  await login(page);
  await page.route("**/api/admin/performance/insights**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/insights")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ demo: false, stale: false, posts: baseRows, datasources: { facebook: true, meta_ads: true }, fetchedAt: null }) });
      return;
    }
    const campaignId = url.searchParams.get("campaign") ?? "";
    const level = url.searchParams.get("level");
    const suffix = campaignId === "cmp-a" ? "Alfa" : "Beta";
    const adsetId = campaignId === "cmp-a" ? "set-a" : "set-b";
    const spend = campaignId === "cmp-a" ? 120 : 180;
    const rows = [
      paidRow(`${level}-${campaignId}-now`, currentDate, campaignId, `Campanha ${suffix}`, { custo: spend, impressoes: spend * 100, cliques: spend * 2, cliquesLink: spend, leads: spend / 10, mensagens: spend / 5, alcance: spend * 75 }, {
        adsetId, adsetName: `Conjunto ${suffix}`,
        ...(level === "ad" ? { adId: `ad-${campaignId}`, adName: `Criativo ${suffix}`, thumbnailUrl: null } : {}),
      }),
      paidRow(`${level}-${campaignId}-prev`, previousDate, campaignId, `Campanha ${suffix}`, { custo: spend / 2, impressoes: spend * 60, cliques: spend, leads: spend / 20, mensagens: spend / 10, alcance: spend * 45 }, {
        adsetId, adsetName: `Conjunto ${suffix}`,
        ...(level === "ad" ? { adId: `ad-${campaignId}`, adName: `Criativo ${suffix}`, thumbnailUrl: null } : {}),
      }),
    ];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ demo: false, stale: false, rows, level }) });
  });

  await page.goto("/admin/performance");
  await page.getByRole("button", { name: "Aquisição", exact: true }).click();
  const dashboard = page.getByTestId("acquisition-dashboard");
  // Filtro composto (Campanha/Conjunto) agora é compartilhado com Analytics
  // e vive fora da div de teste do dashboard de Aquisição.
  const composite = page.locator(".perf-analysis-filterbar");
  const compositeBox = composite.locator(".kb-searchbar-box");
  await compositeBox.click();
  await composite.getByRole("button", { name: "Campanha", exact: true }).click();
  // Escopado ao painel do filtro composto — o texto também pode aparecer na
  // tabela compartilhada de campanhas, agora sempre renderizada.
  await composite.getByText("Campanha Alfa", { exact: true }).click();
  await composite.getByText("Campanha Beta", { exact: true }).click();
  await expect(compositeBox).toContainText("2 selecionadas");
  await page.keyboard.press("Escape");

  await compositeBox.click();
  const adset = composite.getByRole("button", { name: "Conjunto de anúncios", exact: true });
  await expect(adset).toBeEnabled({ timeout: 30_000 });
  await adset.click();
  await composite.getByText("Conjunto Alfa", { exact: true }).click();
  await composite.getByText("Conjunto Beta", { exact: true }).click();
  await expect(compositeBox).toContainText("2 selecionados");
  await page.keyboard.press("Escape");

  await expect(dashboard.locator(".acq-kpi-grid").getByText(/300,00/)).toBeVisible();
  await expect(dashboard.locator("path.recharts-line-curve")).toHaveCount(2);
  await expect(dashboard.getByText("Criativo Alfa", { exact: true })).toBeVisible();
  await expect(dashboard.getByText("Criativo Beta", { exact: true })).toBeVisible();
  await expect(dashboard.locator(".acq-flow-stage")).toHaveCount(3);
  await expect(dashboard.locator(".acq-flow-arrow")).toHaveCount(2);
  await expect(dashboard.locator(".acq-message-branch")).toContainText("Mensagens iniciadas");
  await expect(dashboard.getByText(/dos cliques no link/)).toBeVisible();
  expect(await dashboard.locator(".acq-object-wrap img").evaluate((image) => getComputedStyle(image).transform)).toContain("-1");
});
