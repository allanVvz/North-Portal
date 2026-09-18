import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Molde recorrente real de produção, informado no incidente. Este spec é só
// leitura: protege a separação entre o MOLDE (execuções) e cada ENTREGA de um
// ciclo (etapas próprias), sem criar nem alterar cards operacionais.
const RECURRING_TEMPLATE_ID = "36cfd1f1-aa59-5581-9186-bb7460853e7d";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

test.describe("Molde de Entrega recorrente", () => {
  test.setTimeout(90_000);

  test("mostra somente execuções de recorrência, nunca etapas do roteiro", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/operacao?task=${RECURRING_TEMPLATE_ID}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });

    await expect(modal.locator(".tm-box.tm-cycles")).toBeVisible();
    await expect(modal.getByText("Execuções da recorrência", { exact: false })).toBeVisible();
    await expect(modal.locator(".tm-box.tm-planmembers", { hasText: "Etapas" })).toHaveCount(0);
  });
});
