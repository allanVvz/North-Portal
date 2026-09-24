import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";
import type { CreativeMaterialWorkspace } from "../lib/cardMaterials";

const BAITA_PLAN_ID = "7e1a162d-ff0f-414e-ad50-bea8b472fbcd";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

test("Plano BAITA mostra materiais compactos e retorna do Drive ao card", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await login(page);
  const response = await page.request.get("/api/admin/drive/baita/materials");
  expect(response.ok()).toBe(true);
  const { workspaces } = await response.json() as { workspaces: CreativeMaterialWorkspace[] };
  const target = workspaces.find((workspace) => !workspace.final_versions.some((version) => version.state === "current")) ?? workspaces[0];
  expect(target).toBeTruthy();
  // A read-only fixture makes the parent material icon visible even when the
  // live BAITA cycle has no promoted final yet.
  await page.route("**/api/admin/drive/baita/materials", async (route) => route.fulfill({ json: { workspaces: workspaces.map((workspace) => workspace.id === target.id ? {
    ...workspace,
    assets: [...workspace.assets, { id: "33333333-3333-4333-8333-333333333333", drive_file_id: "e2e-final-preview", name: "Final aprovado.mp4", mime_type: "video/mp4", size_bytes: 100, role: "final", state: "active", web_view_link: null, created_at: new Date().toISOString() }],
    final_versions: [...workspace.final_versions, { id: "44444444-4444-4444-8444-444444444444", asset_id: "33333333-3333-4333-8333-333333333333", version_number: 99, state: "current", promoted_at: new Date().toISOString() }],
  } : workspace) } }));
  await page.goto(`/admin/operacao?task=${BAITA_PLAN_ID}`);
  await expect(page.locator(".tm:not(.creative-drive-modal)")).toBeVisible({ timeout: 30_000 });
  await page.locator(".tm-material-tabs").getByRole("button", { name: /Pastas e links/ }).click();
  const folder = page.locator(".tm-material-list > .tm-material-item").first();
  await expect(folder).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".tm-material-list > .tm-material-item")).toHaveCount(1);
  await expect(folder.locator(".tm-material-name")).not.toBeEmpty();
  await folder.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("materials-desktop.png") });
  await folder.click();
  await expect(page.locator(".creative-drive-modal")).toBeVisible();
  await expect(page.locator(".creative-drive-modal")).not.toContainText("Carregando materiais…", { timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("drive-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("drive-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  await page.locator(".creative-drive-modal .tm-back").click();
  await expect(page.locator(".creative-drive-modal")).toHaveCount(0);
  await expect(page.locator(".tm-materials")).toBeVisible();
  await page.locator(".tm-materials").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("materials-narrow.png") });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(horizontalOverflow).toBe(false);
});

test("Criativo BAITA mostra brutos reais da Captação compartilhada", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await login(page);
  const response = await page.request.get("/api/admin/drive/baita/materials");
  expect(response.ok()).toBe(true);
  const { workspaces } = await response.json() as { workspaces: CreativeMaterialWorkspace[] };
  const driveStatus = await page.request.get("/api/admin/drive/files");
  expect(driveStatus.ok()).toBe(true);
  const { configured } = await driveStatus.json() as { configured: boolean };
  test.skip(!configured && process.env.E2E_REQUIRE_DRIVE !== "1", "Credenciais do Google Drive indisponíveis neste servidor");
  expect(configured, "O servidor local está sem configuração do Google Drive").toBe(true);
  const source = workspaces.find((workspace) => (workspace.available_raw_count ?? 0) > 0);
  expect(source, "Nenhuma Captação BAITA com brutos acessíveis no Drive").toBeTruthy();
  await page.goto(`/admin/operacao?task=${source!.creative_task_id}`);
  await page.locator(".tm-material-tabs").getByRole("button", { name: /Pastas e links/ }).click();
  const folder = page.locator(".tm-material-list > .tm-material-item").first();
  await expect(folder).toContainText(/classificado/, { timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("real-raw-card.png") });
  await folder.click();
  await page.getByRole("button", { name: "Brutos da captação" }).click();
  const rawFiles = page.locator(".creative-drive-modal .creative-drive-gallery .creative-drive-tile");
  const raw = rawFiles.first();
  await expect(raw).toBeVisible({ timeout: 30_000 });
  const rawId = await raw.getAttribute("data-drive-file-id");
  expect(rawId).toBeTruthy();
  const preflightResponse = await page.request.get(`/api/admin/tasks/${source!.creative_task_id}/drive-assets?fileId=${encodeURIComponent(rawId!)}`);
  expect(preflightResponse.ok()).toBe(true);
  const preflight = await preflightResponse.json() as { payloadValid: boolean; metadataAccessible: boolean; parentMatches: boolean; metadataIsShortcut: boolean };
  expect(preflight.payloadValid).toBe(true);
  expect(preflight.metadataAccessible).toBe(true);
  expect(preflight.parentMatches).toBe(true);
  const thumbnails = page.locator(".creative-drive-gallery .creative-drive-tile-art img");
  await expect.poll(() => thumbnails.evaluateAll((images) => images.slice(0, 12).filter((image) => (image as HTMLImageElement).naturalWidth > 0).length), { timeout: 30_000 }).toBeGreaterThan(0);
  const firstPageCount = await rawFiles.count();
  expect(firstPageCount).toBeGreaterThan(0);
  await page.locator(".creative-drive-pagination").getByRole("button", { name: "Próxima" }).click();
  await expect(page.locator(".creative-drive-pagination")).toContainText("Página 2");
  expect(await rawFiles.count()).toBeLessThanOrEqual(24);
  await page.locator(".creative-drive-pagination").getByRole("button", { name: "Anterior" }).click();
  await page.locator(".creative-drive-main").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("real-raw-gallery.png") });
  await raw.getByRole("button", { name: /Ampliar/ }).click();
  const iframe = page.locator(".creative-drive-modal iframe[title^='Preview de']");
  await expect(iframe).toBeVisible();
  await expect(iframe.contentFrame().locator("body[role='application']")).toHaveCount(1, { timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath("real-raw-preview.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("real-raw-gallery-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  await raw.getByRole("button", { name: /Selecionar/ }).click();
  await page.getByRole("button", { name: "Escolher pasta" }).click();
  await expect(page.locator(".creative-drive-targets")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("real-raw-targets-narrow.png") });
});

test("box do card pagina brutos, previews e finais sem misturar os tipos", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const response = await page.request.get("/api/admin/drive/baita/materials");
  expect(response.ok()).toBe(true);
  const { workspaces } = await response.json() as { workspaces: CreativeMaterialWorkspace[] };
  const target = workspaces.find((workspace) => workspace.raw_links.some((link) => workspace.assets.some((asset) => asset.id === link.asset_id && asset.role === "raw" && asset.state === "active")));
  expect(target).toBeTruthy();
  const sourceFile = target!.assets.find((asset) => asset.role === "raw" && asset.state === "active")!;
  const now = new Date().toISOString();
  const fakeAssets = (["raw", "preview", "final"] as const).flatMap((role, typeIndex) => Array.from({ length: 4 }, (_, index) => ({
    ...sourceFile, id: `aaa${typeIndex}${index}0000-0000-4000-8000-000000000000`, role, name: `${role} ${index + 1}.mp4`, created_at: now,
  })));
  const fakeVersions = fakeAssets.filter((asset) => asset.role === "final").map((asset, index) => ({ id: `bbb${index}00000-0000-4000-8000-000000000000`, asset_id: asset.id, version_number: index + 100, state: "superseded" as const, promoted_at: now }));
  await page.route("**/api/admin/drive/baita/materials", (route) => route.fulfill({ json: { workspaces: workspaces.map((workspace) => workspace.id === target!.id ? {
    ...workspace, assets: [...workspace.assets, ...fakeAssets], raw_links: [...workspace.raw_links, ...fakeAssets.filter((asset) => asset.role === "raw").map((asset) => ({ asset_id: asset.id }))], final_versions: [...workspace.final_versions, ...fakeVersions],
  } : workspace) } }));
  await page.goto(`/admin/operacao?task=${target!.creative_task_id}`);
  const box = page.locator(".tm-materials");
  await expect(box.locator(".tm-material-tabs")).toContainText("Previews", { timeout: 30_000 });
  await expect(box.locator(".tm-classified-raw")).toHaveCount(3);
  await box.getByRole("button", { name: "Próxima página" }).click();
  await expect(box.locator(".tm-material-pagination")).toContainText("2 /");
  await box.locator(".tm-material-tabs").getByRole("button", { name: /Previews/ }).click();
  await expect(box.locator(".tm-material-media")).toHaveCount(3);
  await expect(box.locator(".tm-classified-raw")).toHaveCount(0);
  await box.getByRole("button", { name: "Próxima página" }).click();
  await expect(box.locator(".tm-material-pagination")).toContainText("2 /");
  await box.locator(".tm-material-tabs").getByRole("button", { name: /Finais/ }).click();
  await expect(box.locator(".tm-material-media")).toHaveCount(3);
  await expect(box.locator(".tm-material-pagination")).toContainText("1 /");
});

test("Previews e finais usam páginas separadas na pasta do Criativo", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const indexResponse = await page.request.get("/api/admin/drive/baita/materials");
  expect(indexResponse.ok()).toBe(true);
  const index = await indexResponse.json() as { workspaces: Array<{ creative_task_id: string }> };
  const creativeId = index.workspaces[0].creative_task_id;
  const workspaceResponse = await page.request.get(`/api/admin/tasks/${creativeId}/drive-workspace`);
  expect(workspaceResponse.ok()).toBe(true);
  const payload = await workspaceResponse.json() as { context: unknown; workspace: Record<string, unknown> & { assets: unknown[]; final_versions: unknown[] } };
  const now = new Date().toISOString();
  const previews = Array.from({ length: 13 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    drive_file_id: `e2e-preview-page-${index + 1}`, name: `Preview ${index + 1}.mp4`, mime_type: "video/mp4", size_bytes: 100,
    role: "preview", state: "active", web_view_link: null, created_at: now,
  }));
  const finalAssets = Array.from({ length: 13 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    drive_file_id: `e2e-final-page-${index + 1}`, name: `Final ${index + 1}.mp4`, mime_type: "video/mp4", size_bytes: 100,
    role: "final", state: "active", web_view_link: null, created_at: now,
  }));
  const versions = finalAssets.map((asset, index) => ({ id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, asset_id: asset.id, version_number: index + 1, state: index === 12 ? "current" : "superseded", promoted_at: now }));
  await page.route(`**/api/admin/tasks/${creativeId}/drive-workspace`, async (route) => {
    if (route.request().method() !== "GET") { await route.continue(); return; }
    await route.fulfill({ json: { ...payload, workspace: { ...payload.workspace, assets: [...payload.workspace.assets, ...previews, ...finalAssets], final_versions: [...payload.workspace.final_versions, ...versions] } } });
  });
  await page.goto(`/admin/operacao?area=planos-entregas&task=${creativeId}`);
  await page.locator(".tm-material-list > .tm-material-item").filter({ has: page.locator(".tm-material-icon.folder") }).first().click();
  await page.locator(".creative-drive-tabs button").filter({ hasText: "Previews" }).click();
  await expect(page.locator(".creative-drive-gallery.curated .creative-drive-tile")).toHaveCount(12, { timeout: 30_000 });
  await page.locator(".creative-drive-pagination").getByRole("button", { name: "Próxima" }).click();
  await expect(page.locator(".creative-drive-gallery.curated .creative-drive-tile")).toHaveCount(1);
  await page.locator(".creative-drive-tabs button").filter({ hasText: "Finais" }).click();
  await expect(page.locator(".creative-drive-gallery.curated .creative-drive-tile")).toHaveCount(12);
  await page.locator(".creative-drive-pagination").getByRole("button", { name: "Próxima" }).click();
  await expect(page.locator(".creative-drive-gallery.curated .creative-drive-tile")).toHaveCount(1);
});

test("Captação compartilhada classifica o mesmo bruto em dois Criativos e o vínculo aparece no Criativo", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await login(page);
  const indexResponse = await page.request.get("/api/admin/drive/baita/materials");
  expect(indexResponse.ok()).toBe(true);
  const index = await indexResponse.json() as { workspaces: Array<Record<string, unknown> & { creative_task_id: string; capture_task_id: string; id: string; assets: unknown[]; raw_links: unknown[] }> };
  const first = index.workspaces.find((item) => index.workspaces.some((other) => other.id !== item.id && other.capture_task_id === item.capture_task_id));
  expect(first).toBeTruthy();
  const second = index.workspaces.find((item) => item.id !== first!.id && item.capture_task_id === first!.capture_task_id)!;
  const ids = [first!.creative_task_id, second.creative_task_id];
  const taskRows = await Promise.all(ids.map(async (id) => {
    const response = await page.request.get(`/api/admin/tasks/${id}`);
    expect(response.ok()).toBe(true);
    return response.json() as Promise<{ id: string; title: string }>;
  }));
  const payloads = new Map(await Promise.all(ids.map(async (id) => {
    const response = await page.request.get(`/api/admin/tasks/${id}/drive-workspace`);
    expect(response.ok()).toBe(true);
    return [id, await response.json()] as const;
  })));
  expect([...payloads.values()].every((item) => item.workspace?.status === "ready")).toBe(true);

  const raw = { id: "e2e-material-readonly", name: "72bf991001aa993145cd552411bb33ff22cd00aa.mp4", originalFilename: "IMG_0420.MOV", mimeType: "video/mp4", webViewLink: "https://drive.google.com/file/d/e2e-material-readonly/view", createdTime: "2026-09-20T12:00:00Z" };
  const raw2 = { id: "e2e-material-readonly-2", name: "Segundo bruto.jpg", mimeType: "image/jpeg", webViewLink: "https://drive.google.com/file/d/e2e-material-readonly-2/view", captureTime: "2026:09:19 10:30:00", createdTime: "2026-09-24T12:00:00Z" };
  const linked = new Set<string>();
  let rejectSecondRaw = false;
  const linkedFiles = (id: string) => [raw, raw2].filter((file) => linked.has(`${id}:${file.id}`));
  const assetIdFor = (id: string, fileId: string) => `${id === ids[0] ? "11111111" : "22222222"}-2222-4222-8222-${fileId === raw.id ? "111111111111" : "222222222222"}`;
  const mockedAssets = (id: string) => linkedFiles(id).map((file) => ({ id: assetIdFor(id, file.id), drive_file_id: file.id, name: file.name, mime_type: file.mimeType, size_bytes: null, role: "raw", state: "active", web_view_link: file.webViewLink, created_at: new Date().toISOString() }));
  const posts: Array<{ creativeId: string; driveFileId: string }> = [];
  await page.route("**/api/admin/drive/baita/materials", async (route) => {
    const workspaces = index.workspaces.map((item) => {
      const assets = mockedAssets(item.creative_task_id);
      return { ...item, assets: [...item.assets, ...assets], raw_links: [...item.raw_links, ...assets.map((asset) => ({ asset_id: asset.id }))] };
    });
    await route.fulfill({ json: { workspaces } });
  });
  await page.route(/\/api\/admin\/tasks\/[^/]+\/drive-workspace(?:\?.*)?$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[4];
    const payload = payloads.get(id);
    if (!payload || route.request().method() !== "GET") { await route.continue(); return; }
    const assets = mockedAssets(id);
    const workspace = { ...payload.workspace, source_error: null, source_files: { ...payload.workspace.source_files, capture: [raw, raw2] }, assets: [...payload.workspace.assets, ...assets], raw_links: [...payload.workspace.raw_links, ...assets.map((asset) => ({ asset_id: asset.id, shortcut_drive_file_id: "mock-shortcut" }))] };
    await route.fulfill({ json: { ...payload, workspace } });
  });
  await page.route("**/api/admin/tasks/*/drive-assets", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[4];
    const body = route.request().postDataJSON() as { action: string; driveFileId?: string; assetId?: string };
    if (!ids.includes(id)) { await route.abort(); return; }
    if (body.action === "unlink_raw") { for (const file of [raw, raw2]) if (assetIdFor(id, file.id) === body.assetId) linked.delete(`${id}:${file.id}`); await route.fulfill({ json: { ok: true } }); return; }
    if (body.action !== "link_raw") { await route.abort(); return; }
    if (rejectSecondRaw && body.driveFileId === raw2.id) { await route.fulfill({ status: 400, json: { error: "Bruto inválido para esta pasta." } }); return; }
    posts.push({ creativeId: id, driveFileId: body.driveFileId! });
    linked.add(`${id}:${body.driveFileId}`);
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto(`/admin/operacao?area=planos-entregas&task=${ids[0]}`);
  await page.locator(".tm-material-tabs").getByRole("button", { name: /Pastas e links/ }).click();
  const firstFolder = page.locator(".tm-material-list > .tm-material-item").filter({ hasText: taskRows[0].title }).first();
  await expect(firstFolder).toBeVisible({ timeout: 30_000 });
  await firstFolder.click();
  await page.getByRole("button", { name: "Brutos da captação" }).click();
  const tile = page.locator(`.creative-drive-gallery .creative-drive-tile[data-drive-file-id="${raw.id}"]`);
  const secondTile = page.locator(`.creative-drive-gallery .creative-drive-tile[data-drive-file-id="${raw2.id}"]`);
  await expect(tile).toBeVisible({ timeout: 30_000 });
  const firstTarget = page.locator(".creative-drive-target").filter({ hasText: taskRows[0].title });
  const secondTarget = page.locator(".creative-drive-target").filter({ hasText: taskRows[1].title });
  const drop = async (source: typeof tile, target: typeof firstTarget) => {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await source.dispatchEvent("dragstart", { dataTransfer });
    await target.dispatchEvent("dragover", { dataTransfer });
    await target.dispatchEvent("drop", { dataTransfer });
  };
  await expect(tile).toContainText("IMG_0420.MOV");
  await expect(secondTile).toContainText("Gravado 19/09");
  await secondTile.getByRole("button", { name: `Selecionar ${raw2.name}` }).click();
  await tile.getByRole("button", { name: "Selecionar IMG_0420.MOV" }).click({ modifiers: ["Control"] });
  await expect(page.locator(".creative-drive-gallery.raw .creative-drive-tile.selected")).toHaveCount(2);
  await tile.getByRole("button", { name: "Selecionar IMG_0420.MOV" }).click();
  await expect(page.locator(".creative-drive-gallery.raw .creative-drive-tile.selected")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("raw-improved-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("raw-improved-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  await page.setViewportSize({ width: 1280, height: 720 });
  await drop(tile, firstTarget);
  await expect(page.locator(".creative-drive-tabs button.on")).toContainText("Brutos da captação");
  await expect(page.locator(".creative-drive-toast")).toContainText("vinculado");
  await expect(tile).toHaveCount(0);
  const noticeBox = await page.locator(".creative-drive-toast").boundingBox();
  const paginationBox = await page.locator(".creative-drive-pagination").boundingBox();
  expect(noticeBox && paginationBox && noticeBox.y + noticeBox.height < paginationBox.y).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("classified-notice-desktop.png") });
  await firstTarget.getByRole("button", { name: "Abrir" }).click();
  await expect(page.locator(`[data-classified-asset-id="${assetIdFor(ids[0], raw.id)}"]`)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`[data-classified-asset-id="${assetIdFor(ids[0], raw.id)}"]`).getByRole("link", { name: /Baixar/ })).toBeVisible();
  await expect(page.locator(`[data-classified-asset-id="${assetIdFor(ids[0], raw.id)}"]`).locator("summary")).toContainText("Drive");
  await secondTarget.getByRole("button", { name: `Ver brutos pendentes para ${taskRows[1].title}` }).click();
  await expect(page.locator(".creative-drive-tabs button.on")).toContainText("Brutos da captação");
  await expect(tile).toBeVisible();
  await drop(tile, secondTarget);
  await expect.poll(() => posts.length).toBe(2);
  expect(posts).toEqual(ids.map((creativeId) => ({ creativeId, driveFileId: raw.id })));
  await page.getByRole("button", { name: "Já classificados" }).click();
  await expect(tile).toBeVisible();
  await page.getByRole("button", { name: "Pendentes", exact: true }).click();
  await expect(tile).toHaveCount(0);
  await firstTarget.getByRole("button", { name: `Ver brutos pendentes para ${taskRows[0].title}` }).click();
  await expect(tile).toHaveCount(0);
  await secondTile.getByRole("button", { name: `Selecionar ${raw2.name}` }).click();
  await firstTarget.getByRole("button", { name: `Classificar brutos em ${taskRows[0].title}` }).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts.at(-1)).toEqual({ creativeId: ids[0], driveFileId: raw2.id });
  await secondTarget.getByRole("button", { name: `Ver brutos pendentes para ${taskRows[1].title}` }).click();
  await secondTile.getByRole("button", { name: `Selecionar ${raw2.name}` }).click();
  rejectSecondRaw = true;
  await secondTarget.getByRole("button", { name: `Classificar brutos em ${taskRows[1].title}` }).click();
  await expect(page.locator(".creative-drive-toast")).toContainText("Bruto inválido para esta pasta.");
  rejectSecondRaw = false;

  await page.locator(".creative-drive-modal .tm-back").click();
  await page.goto(`/admin/operacao?area=planos-entregas&task=${ids[0]}`);
  await expect(page.locator(".tm-classified-raw").first()).toBeVisible({ timeout: 30_000 });
  const cardDownload = page.locator(`.tm-classified-raw-actions a[href$="/drive-assets/${assetIdFor(ids[0], raw.id)}/download"]`);
  for (let pageNumber = 1; pageNumber < 20 && await cardDownload.count() === 0; pageNumber++) {
    const next = page.locator(".tm-materials").getByRole("button", { name: "Próxima página" });
    if (await next.isDisabled()) break;
    await next.click();
  }
  await expect(cardDownload).toBeVisible();
  await page.locator(".tm-material-tabs").getByRole("button", { name: /Pastas e links/ }).click();
  await page.locator(".tm-material-list > .tm-material-item").filter({ hasText: taskRows[0].title }).first().click();
  const classifiedTile = page.locator(`[data-classified-asset-id="${assetIdFor(ids[0], raw.id)}"]`);
  await expect(classifiedTile).toBeVisible({ timeout: 30_000 });
  await classifiedTile.locator("summary").click();
  await classifiedTile.getByRole("button", { name: "Desassociar" }).click();
  await expect(classifiedTile).toHaveCount(0);
  await page.getByRole("button", { name: "Brutos da captação" }).click();
  const ownTile = page.locator(`.creative-drive-gallery .creative-drive-tile[data-drive-file-id="${raw.id}"]`);
  await ownTile.getByRole("button", { name: "Selecionar IMG_0420.MOV" }).click();
  await page.locator(".creative-drive-target").filter({ hasText: taskRows[0].title }).getByRole("button", { name: `Classificar brutos em ${taskRows[0].title}` }).click();
  await page.locator(".creative-drive-target").filter({ hasText: taskRows[0].title }).getByRole("button", { name: "Abrir" }).click();
  await expect(page.locator(`[data-classified-asset-id="${assetIdFor(ids[0], raw.id)}"]`)).toBeVisible({ timeout: 30_000 });
  expect(posts.at(-1)).toEqual({ creativeId: ids[0], driveFileId: raw.id });

  await page.goto(`/admin/operacao?area=planos-entregas&task=${first!.capture_task_id}`);
  await page.locator(".tm-material-tabs").getByRole("button", { name: /Pastas e links/ }).click();
  const captureFolder = page.locator(".tm-material-list > .tm-material-item").filter({ hasText: taskRows[0].title }).first();
  await expect(captureFolder).toBeVisible({ timeout: 30_000 });
  await captureFolder.click();
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await expect(page.locator(`.creative-drive-gallery .creative-drive-tile[data-drive-file-id="${raw.id}"]`)).toBeVisible({ timeout: 30_000 });
});

test("Kanban volta ao Plano anterior depois de abrir um Criativo", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto(`/admin/kanban?task=${BAITA_PLAN_ID}`);
  await expect(page.locator(".tm-planmembers .tm-member-open").first()).toBeVisible({ timeout: 90_000 });
  const planTitle = await page.locator(".tm-title-input").inputValue();
  await page.locator(".tm-planmembers .tm-member-open").first().click();
  await expect(page.locator(".tm-title-input")).not.toHaveValue(planTitle);
  await page.getByRole("button", { name: "Voltar para o card anterior" }).click();
  await expect(page.locator(".tm-title-input")).toHaveValue(planTitle);
});

test("PDF do Criativo aparece no Plano por referência e abre o modal de documentos", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  const indexResponse = await page.request.get("/api/admin/drive/baita/materials");
  const index = await indexResponse.json() as { workspaces: Array<{ creative_task_id: string }> };
  const creativeId = index.workspaces[0].creative_task_id;
  const creative = await (await page.request.get(`/api/admin/tasks/${creativeId}`)).json() as { client_id: string; title: string };
  const documentResponse = await page.request.get("/api/admin/documents");
  expect(documentResponse.ok()).toBe(true);
  const existing = await documentResponse.json() as { documents: Record<string, unknown>[] };
  const inheritedPdf = {
    id: "33333333-3333-4333-8333-333333333333", client_id: creative.client_id, task_id: creativeId,
    name: "PDF herdado do Criativo", doc_type: "material", status: "enviada", file_url: null,
    storage_path: null, original_file_name: "material.pdf", mime_type: "application/pdf", size_bytes: 1024,
    doc_date: "2026-09-24", read_at: null, clientName: "ADM NORTH", clientSlug: "north",
  };
  await page.route("**/api/admin/documents", async (route) => {
    if (route.request().method() !== "GET") { await route.abort(); return; }
    await route.fulfill({ json: { documents: [...existing.documents, inheritedPdf] } });
  });
  await page.goto(`/admin/operacao?task=${BAITA_PLAN_ID}`);
  const pdf = page.locator(".tm-material-item").filter({ hasText: inheritedPdf.name });
  await expect(pdf).toBeVisible({ timeout: 45_000 });
  await expect(pdf).toContainText(creative.title);
  await pdf.click();
  await expect(page.locator(".docprev-tm")).toContainText(inheritedPdf.name);
  await page.locator(".docprev-tm .tm-back").click();
  await expect(page.locator(".tm-materials")).toBeVisible();
});

test("anexo no comentário vira miniatura que abre o preview amplo", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  const index = await (await page.request.get("/api/admin/drive/baita/materials")).json() as { workspaces: Array<Record<string, unknown> & { creative_task_id: string; assets: unknown[] }> };
  const owner = index.workspaces[0];
  const creative = await (await page.request.get(`/api/admin/tasks/${owner.creative_task_id}`)).json() as Record<string, unknown> & { payload: Record<string, unknown>; id: string };
  const assetId = "44444444-4444-4444-8444-444444444444";
  const asset = { id: assetId, drive_file_id: "e2e-comment-image", name: "Imagem do comentário.png", mime_type: "image/png", size_bytes: 128, role: "preview", state: "active", web_view_link: "https://drive.google.com/file/d/e2e-comment-image/view", created_at: new Date().toISOString() };
  const comment = { author: "Teste visual", text: "Veja o anexo", at: new Date().toISOString(), asset_ids: [assetId] };
  const updated = { ...creative, payload: { ...creative.payload, comments: [...((creative.payload.comments as unknown[]) ?? []), comment] } };
  const workspacePayload = await (await page.request.get(`/api/admin/tasks/${creative.id}/drive-workspace`)).json() as { context: unknown; workspace: Record<string, unknown> & { assets: unknown[] } };
  await page.route(`**/api/admin/tasks/${creative.id}/comments`, async (route) => {
    if (route.request().method() !== "POST") { await route.abort(); return; }
    await route.fulfill({ json: updated });
  });
  await page.route("**/api/admin/drive/baita/materials", async (route) => {
    await route.fulfill({ json: { workspaces: index.workspaces.map((workspace) => workspace.creative_task_id === creative.id ? { ...workspace, assets: [...workspace.assets, asset] } : workspace) } });
  });
  await page.route(`**/api/admin/tasks/${creative.id}/drive-workspace`, async (route) => {
    if (route.request().method() !== "GET") { await route.abort(); return; }
    await route.fulfill({ json: { ...workspacePayload, workspace: { ...workspacePayload.workspace, assets: [...workspacePayload.workspace.assets, asset] } } });
  });
  await page.route("**/api/admin/drive/thumbnail/e2e-comment-image", async (route) => {
    await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64") });
  });
  await page.goto(`/admin/operacao?task=${creative.id}`);
  await expect(page.locator(".tm-comment-input textarea")).toBeVisible({ timeout: 45_000 });
  await page.locator(".tm-comment-input textarea").fill("Teste de preview");
  await page.locator(".tm-comment-input button").last().click();
  const thumbnail = page.locator(".tm-comment-asset").filter({ hasText: asset.name });
  await expect(thumbnail).toBeVisible({ timeout: 45_000 });
  await thumbnail.click();
  await expect(page.locator(".creative-drive-modal")).toContainText(asset.name, { timeout: 30_000 });
  await page.locator(".creative-drive-modal .tm-back").click();
  await expect(thumbnail).toBeVisible();
});
