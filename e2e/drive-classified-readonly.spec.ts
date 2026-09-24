import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

test("brutos classificados existentes aparecem no card e na pasta do Criativo", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  const indexResponse = await page.request.get("/api/admin/drive/baita/materials");
  expect(indexResponse.ok()).toBe(true);
  const index = await indexResponse.json() as { workspaces: Array<{ creative_task_id: string; assets: Array<{ id: string; role: string }>; raw_links: Array<{ asset_id: string }> }> };
  const target = index.workspaces.find((workspace) => workspace.raw_links.some((link) => workspace.assets.some((asset) => asset.id === link.asset_id && asset.role === "raw")));
  test.skip(!target, "Nenhum bruto classificado no momento");
  const assetId = target!.raw_links[0].asset_id;

  await page.goto(`/admin/operacao?area=planos-entregas&task=${target!.creative_task_id}`);
  const cardRaw = page.locator(".tm-classified-raw").first();
  await expect(cardRaw).toBeVisible({ timeout: 30_000 });
  await expect(cardRaw.getByRole("link", { name: "Abrir" })).toHaveAttribute("target", "_blank");
  await expect(cardRaw.getByRole("link", { name: "Baixar" })).toHaveAttribute("href", new RegExp(`/drive-assets/${assetId}/download$`));
  const driveStatus = await page.request.get("/api/admin/drive/files");
  const { configured } = await driveStatus.json() as { configured: boolean };
  if (configured) {
    page.on("download", (download) => { void download.cancel(); });
    const downloadResponse = page.waitForResponse((response) => response.url().includes(`/drive-assets/${assetId}/download`), { timeout: 45_000 });
    await cardRaw.getByRole("link", { name: "Baixar" }).click();
    const response = await downloadResponse;
    expect(response.ok(), response.ok() ? undefined : (await response.text()).slice(0, 200)).toBe(true);
    expect(response.headers()["content-disposition"]).toContain("attachment");
  }
  await page.screenshot({ path: testInfo.outputPath("classified-card-desktop.png") });
  await cardRaw.getByRole("button", { name: /Visualizar bruto/ }).click();
  await expect(page.locator(".creative-drive-tabs button.on")).toContainText("Classificados", { timeout: 30_000 });
  await expect(page.locator(`[data-classified-asset-id="${assetId}"]`)).toBeVisible();
  await page.locator(".creative-drive-modal .tm-back").click();
  await page.locator(".tm-material-list > .tm-material-item").filter({ has: page.locator(".tm-material-icon.folder") }).first().click();
  await expect(page.locator(".creative-drive-tabs button.on")).toContainText("Classificados");
  await expect(page.locator(`[data-classified-asset-id="${assetId}"]`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("classified-folder-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("classified-folder-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});
