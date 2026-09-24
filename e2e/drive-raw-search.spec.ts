import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

test("busca encontra um bruto da última página da Captação real", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const filename = "0144413a1ccc6b8030904bd39c1f3e3e32a62a1cfa.mp4";
  const fileId = "1xHzcbfxsAOpKmGQ-E8N6F6y1RolxSTVu";
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  const indexResponse = await page.request.get("/api/admin/drive/baita/materials");
  expect(indexResponse.ok()).toBe(true);
  const index = await indexResponse.json() as { workspaces: Array<{ creative_task_id: string; capture_task_id: string }> };
  const creativeTaskId = index.workspaces.find((workspace) => workspace.capture_task_id === "0f18c00f-69b6-4c94-9223-4284fe67dea4")?.creative_task_id;
  expect(creativeTaskId).toBeTruthy();

  const results = await page.request.get(`/api/admin/tasks/${creativeTaskId}/drive-sources?kind=capture&query=${filename.slice(0, 18)}`);
  expect(results.ok(), await results.text()).toBe(true);
  const body = await results.json() as { files: Array<{ id: string; name: string }> };
  expect(body.files).toContainEqual(expect.objectContaining({ id: fileId, name: filename }));

  const workspaceResponse = await page.request.get(`/api/admin/tasks/${creativeTaskId}/drive-workspace`);
  expect(workspaceResponse.ok()).toBe(true);
  const workspace = await workspaceResponse.json() as { workspace: { source_files: { capture: Array<{ id: string }> }; source_next_page_token: { capture: string | null } } };
  const allIds = new Set(workspace.workspace.source_files.capture.map((file) => file.id));
  let token = workspace.workspace.source_next_page_token.capture;
  let pages = 1;
  while (token && pages < 30) {
    const next = await page.request.get(`/api/admin/tasks/${creativeTaskId}/drive-sources?${new URLSearchParams({ kind: "capture", pageToken: token })}`);
    expect(next.ok()).toBe(true);
    const chunk = await next.json() as { files: Array<{ id: string }>; nextPageToken: string | null };
    for (const file of chunk.files) allIds.add(file.id);
    token = chunk.nextPageToken;
    pages++;
  }
  expect(token).toBeNull();
  expect(allIds.size).toBeGreaterThanOrEqual(520);
  expect(allIds.has(fileId)).toBe(true);

  await page.goto(`/admin/operacao?task=${creativeTaskId}`);
  await page.locator(".tm-material-tabs").getByRole("button", { name: /Pastas e links/ }).click();
  await page.locator(".tm-material-list > .tm-material-item").filter({ has: page.locator(".tm-material-icon.folder") }).first().click();
  await page.getByRole("button", { name: "Brutos da captação" }).click();
  await page.getByLabel("Encontrar bruto pelo nome").fill(filename.slice(0, 18));
  await page.getByRole("button", { name: "Buscar" }).click();
  const raw = page.locator(`[data-drive-file-id="${fileId}"]`);
  await expect(raw).toBeVisible({ timeout: 30_000 });
  await expect(raw.getByRole("checkbox", { name: `Selecionar bruto ${filename}` })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("raw-search-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("raw-search-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});
