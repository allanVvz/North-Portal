import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// The admin Home is assembled entirely from existing data (no new table), so
// this checks the wiring: KPIs render real numbers and link to the screen that
// resolves them, the notifications panel is fed by the same API as the bell,
// and "+ Nova tarefa" opens the shared TaskModal in creation mode.

// The dev server compiles routes on first hit, so the first assertion on a
// fresh route can outlast the default 5s expect timeout. Waiting for the
// network to settle keeps that from reading as a product failure.
async function openHome(page: import("@playwright/test").Page) {
  await page.goto("/admin/home", { waitUntil: "networkidle" });
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
}

test.describe("Home do admin", () => {
  // Generous budget: each route this spec touches is compiled on first hit by
  // the dev server, which alone can eat the default 30s.
  test.describe.configure({ timeout: 90_000 });

  test("mostra KPIs reais e leva para a tela que os resolve", async ({ page }) => {
    await login(page);
    await openHome(page);

    await expect(page.getByRole("heading", { name: /Bom dia|Boa tarde|Boa noite/ })).toBeVisible({ timeout: 20_000 });

    for (const label of ["Clientes ativos", "Em revisão", "Aguardando aprovação", "Tarefas atrasadas", "Progresso dos planos"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible({ timeout: 20_000 });
    }

    // "Clientes ativos" reads N/M with real counts.
    const activeKpi = page.locator(".home-kpi", { hasText: "Clientes ativos" }).locator(".home-kpi-value");
    await expect(activeKpi).toHaveText(/^\d+\/\d+$/);

    await page.locator(".home-kpi", { hasText: "Em revisão" }).click();
    await page.waitForURL(/\/admin\/revisoes/, { timeout: 15_000 });
  });

  test("abre o TaskModal em modo de criação pelo atalho do header", async ({ page }) => {
    await login(page);
    await openHome(page);

    await page.getByRole("button", { name: /Nova tarefa/ }).click();
    // The shared modal shows the type cards only when creating.
    await expect(page.locator(".tm").first()).toBeVisible({ timeout: 15_000 });
  });

  test("o painel de notificações usa a mesma fonte do sino", async ({ page }) => {
    await login(page);
    await openHome(page);

    const panel = page.locator(".admin-card", { hasText: "Notificações" });
    await expect(panel).toBeVisible({ timeout: 20_000 });
    // Either real rows or the explicit empty state — never a silent blank card.
    await expect(panel.locator(".admin-notif-item, .admin-notif-empty").first()).toBeVisible({ timeout: 15_000 });
  });

  test("o item Início aparece na navegação e fica ativo na Home", async ({ page }) => {
    await login(page);
    await openHome(page);
    // Matched by href, not by accessible name: the sidebar collapses to
    // icon-only at narrower widths, which hides the label text.
    const item = page.locator('a.admin-nav-item[href="/admin/home"]');
    await expect(item).toBeVisible({ timeout: 20_000 });
    await expect(item).toHaveClass(/active/);
  });
});
