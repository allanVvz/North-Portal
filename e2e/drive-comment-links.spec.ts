import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

test("link do Drive no comentário usa miniatura compacta e abre preview amplo", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  await page.goto("/admin/operacao?task=08adb443-4d3a-4c38-8b32-be1b27cc111b");
  const attachment = page.locator(".tm-comment-text .gdrive-comment-attachment").first();
  await expect(attachment).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".tm-comment-text iframe")).toHaveCount(0);
  await attachment.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("comment-attachment-desktop.png") });
  await attachment.click();
  const modal = page.locator(".gdrive-link-modal");
  await expect(modal).toBeVisible();
  await expect(modal.locator("iframe")).toBeVisible();
  await modal.getByRole("button", { name: "Voltar para o card" }).click();
  await expect(modal).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await attachment.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("comment-attachment-narrow.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});

test("PDF anexado por outra URL do mesmo Drive usa o modal de documentos", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  const response = await page.request.get("/api/admin/documents");
  expect(response.ok()).toBe(true);
  const data = await response.json() as { documents: Array<Record<string, unknown>> };
  const template = data.documents.find((doc) => doc.mime_type !== "text/html");
  expect(template).toBeTruthy();
  const alias = { ...template, id: "35c558e6-4b7f-4c93-a9cb-b6a5792a79b8", task_id: "08adb443-4d3a-4c38-8b32-be1b27cc111b", name: "PDF do comentário", original_file_name: "roteiro.pdf", mime_type: "application/pdf", file_url: "https://drive.google.com/open?id=1aAaJI53PNaCyW6QcFCdx6j5n7I71ke3l_N0BehjNAHk" };
  await page.route("**/api/admin/documents", (route) => route.fulfill({ json: { ...data, documents: [...data.documents, alias] } }));
  await page.goto("/admin/operacao?task=08adb443-4d3a-4c38-8b32-be1b27cc111b");
  const docTab = page.locator(".tm-material-tabs").getByRole("button", { name: /Documentos/ });
  await expect(docTab).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".tm-comment-text .gdrive-comment-attachment")).toHaveCount(0);
  await page.locator('.tm-comment-text a[href*="docs.google.com/document/d/1aAaJI53PNaCyW6QcFCdx6j5n7I71ke3l_N0BehjNAHk"]').click();
  await expect(page.locator(".docprev-tm:not(.gdrive-link-modal)")).toBeVisible();
});
