import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

const CARD_ID = "b5a0f9ec-a1a0-480e-ac23-4e2b8978a4a1";
const MP3_ID = "1TjrFN8te9r80MPbnWLRdqFHlvCYWAP1p";
const MP4_ID = "1xYkxjah0gXVWAzxXTGHU2rfW3dpF0Lst";

test("Raw, Preview e Home do Criativo mantem os materiais nas categorias certas", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });

  const response = await page.request.get(`/api/admin/tasks/${CARD_ID}/drive-workspace?sources=0`);
  expect(response.ok()).toBe(true);
  const { workspace } = await response.json() as { workspace: {
    creative_folder_id: string | null; raw_folder_id: string | null; preview_folder_id: string | null;
    assets: Array<{ id: string; drive_file_id: string; role: string }>;
    raw_links: Array<{ asset_id: string; shortcut_drive_file_id: string | null }>;
    final_versions: Array<{ asset_id: string; version_number: number; state: string }>;
  } };
  expect(new Set([workspace.creative_folder_id, workspace.raw_folder_id, workspace.preview_folder_id]).size).toBe(3);
  const audio = workspace.assets.find((asset) => asset.drive_file_id === MP3_ID);
  const video = workspace.assets.find((asset) => asset.drive_file_id === MP4_ID);
  expect(audio?.role).toBe("raw");
  expect(workspace.raw_links.some((link) => link.asset_id === audio?.id && link.shortcut_drive_file_id === null)).toBe(true);
  expect(video?.role).toBe("final");
  expect(workspace.final_versions).toEqual([expect.objectContaining({ asset_id: video?.id, version_number: 1, state: "current" })]);

  await page.goto(`/admin/operacao?task=${CARD_ID}`);
  await page.locator(".tm-material-tabs").getByRole("button", { name: /Pastas e links/ }).click();
  await page.locator(".tm-material-list > .tm-material-item").filter({ has: page.locator(".tm-material-icon.folder") }).first().click();
  await expect(page.locator(".creative-drive-folder-links a")).toHaveCount(3);
  await expect(page.locator(".creative-drive-folder-links")).toContainText("Home · finais");
  await expect(page.locator(".creative-drive-folder-links")).toContainText("Raw");
  await expect(page.locator(".creative-drive-folder-links")).toContainText("Preview");
  await page.locator(".creative-drive-tabs").getByRole("button", { name: /Classificados/ }).click();
  const audioTile = page.locator(`[data-classified-asset-id="${audio?.id}"]`);
  await expect(audioTile).toBeVisible();
  await expect(audioTile).toContainText("Arquivo na pasta Raw");
  await expect(audioTile.getByRole("link", { name: /Baixar/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("raw-folders-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("raw-folders-mobile.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});
