import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";
import { materialCoverCandidates, type CreativeMaterialWorkspace } from "../lib/cardMaterials";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

test("Feed mostra capas do Drive, compõe cliente com busca e abre a Entrega", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await login(page);
  const materialsResponse = await page.request.get("/api/admin/drive/baita/materials");
  expect(materialsResponse.ok()).toBe(true);
  const materials = await materialsResponse.json() as { workspaces: CreativeMaterialWorkspace[] };
  // Reuse the real read-only index while preventing a Drive reconciliation
  // from writing production data during this visual regression test.
  await page.route("**/api/admin/drive/baita/materials", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ json: materials });
    else await route.continue();
  });

  await page.goto("/admin/operacao?area=planos-entregas");
  await page.getByRole("button", { name: "Feed", exact: true }).click();
  const feed = page.getByRole("region", { name: "Feed de Criativos" });
  await expect(feed).toBeVisible();
  const cards = feed.locator(".creative-feed-card");
  expect(await cards.count()).toBeGreaterThan(0);

  const withMaterial = materials.workspaces.find((workspace) => materialCoverCandidates([workspace]).length > 0 && workspace.creative_title);
  if (withMaterial) {
    const cover = materialCoverCandidates([withMaterial])[0];
    const card = cards.filter({ has: page.locator(".creative-feed-caption strong", { hasText: withMaterial.creative_title! }) }).first();
    if (await card.count()) {
      const thumbnail = await page.request.get(`/api/admin/drive/thumbnail/${cover.fileId}`);
      if (thumbnail.ok()) await expect(card.locator(".creative-feed-media img")).toHaveAttribute("src", `/api/admin/drive/thumbnail/${cover.fileId}`);
    }
  }

  // Screenshots should include thumbnails beyond the first viewport, while
  // the application itself keeps lazy loading for normal browsing.
  await page.evaluate(() => document.querySelectorAll<HTMLImageElement>(".creative-feed-media img").forEach((image) => { image.loading = "eager"; }));
  await expect.poll(() => page.locator(".creative-feed-media img").evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).naturalWidth > 0).length), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".creative-feed-media img")].every((image) => image.complete), undefined, { timeout: 20_000 }).catch(() => {});
  const ratioDifference = await feed.locator(".creative-feed-media img").evaluateAll((images) => {
    const image = images.find((item) => (item as HTMLImageElement).naturalWidth > 0) as HTMLImageElement;
    const frame = image.closest("button")!.getBoundingClientRect();
    return Math.abs(frame.width / frame.height - image.naturalWidth / image.naturalHeight);
  });
  expect(ratioDifference).toBeLessThan(0.03);
  await page.mouse.move(1200, 110);
  await page.waitForTimeout(350);
  await page.screenshot({ path: testInfo.outputPath("creative-feed-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const closeMenu = page.getByRole("button", { name: "Fechar menu" }).first();
  if (await closeMenu.isVisible()) await closeMenu.click();
  await page.screenshot({ path: testInfo.outputPath("creative-feed-narrow.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  const first = cards.first();
  const client = (await first.locator(".creative-feed-caption small").textContent())?.trim() ?? "";
  const title = (await first.locator(".creative-feed-caption strong").textContent())?.trim() ?? "";
  const search = page.locator(".plans-deliveries-board .kb-searchbar-input");
  await search.click();
  await page.locator(".plans-deliveries-board .kb-searchbar-panel .kb-chip", { hasText: client }).first().click();
  await expect(page.getByRole("button", { name: "Remover filtro de cliente" })).toBeVisible();
  await search.fill(title);
  await expect(feed.locator(".creative-feed-card").first()).toContainText(title);
  for (const caption of await feed.locator(".creative-feed-caption small").allTextContents()) expect(caption.trim()).toBe(client);

  await feed.getByRole("button", { name: `Abrir entrega ${title}` }).first().click();
  await expect(page.locator(".tm:not(.creative-drive-modal)")).toBeVisible();
  await page.locator(".tm:not(.creative-drive-modal) .kb-modal-close").first().click();
  const media = feed.locator(".creative-feed-media").first();
  expect(await media.evaluate((element) => getComputedStyle(element).aspectRatio)).not.toBe("auto");
  const image = media.locator("img");
  if (await image.count()) expect(await image.evaluate((element) => getComputedStyle(element).objectFit)).toBe("contain");
});
