import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Caixa de arquivos do card (25/09): vitrine de Finais, Previews e Documentos
// + um link que abre direto o modal de arquivos. Este spec cobre o caso que os
// de Drive não cobrem: o card de RELATÓRIO, cujo arquivo é um documento (PDF)
// e não vive no Drive. Só leitura.

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

test("card de relatório mostra o PDF em Documentos e não oferece o modal do Drive", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await login(page);
  const response = await page.request.get("/api/admin/documents");
  expect(response.ok()).toBe(true);
  const { documents } = await response.json() as { documents: Array<{ id: string; name: string; task_id: string | null }> };
  const relatorio = documents.find((doc) => doc.task_id && /^relatorio-(conversao|trafego)-/.test(doc.name));
  test.skip(!relatorio, "Nenhum relatório anexado a card no momento");

  await page.goto(`/admin/operacao?task=${relatorio!.task_id}`);
  const box = page.locator(".tm-materials");
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(box.locator(".tm-material-tabs")).toContainText("Documentos");
  await expect(box.locator(".tm-material-tabs")).not.toContainText(/Brutos|Pastas e links/);
  await expect(box.locator(".tm-material-item").filter({ hasText: relatorio!.name })).toHaveCount(1);
  // Sem criativo no Drive, não há modal de arquivos para abrir.
  await expect(box.locator(".tm-materials-open")).toHaveCount(0);
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("report-files-box.png") });

  // O PDF abre no preview de documentos, como antes.
  await box.locator(".tm-material-item").filter({ hasText: relatorio!.name }).click();
  await expect(page.locator(".docprev-tm")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".docprev-tm")).toContainText(relatorio!.name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});
