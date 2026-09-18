import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";
import { factualRoutineEvents } from "../app/admin/operacao/operationItems";
import type { RecurringTask } from "../lib/supabase";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

test.describe("Operação simplificada em duas áreas (somente leitura)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("abre em Tarefas e Rotinas, agrupada por Responsável", async ({ page }) => {
    await page.goto("/admin/operacao");

    await expect(page.getByRole("button", { name: "Tarefas e Rotinas", exact: true })).toHaveClass(/on/);
    await expect(page.getByRole("button", { name: "Responsável", exact: true })).toHaveClass(/on/);
    await expect(page.getByRole("button", { name: "Clientes", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prazo", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Kanban", exact: true })).toBeVisible();
  });

  test("rotinas e tarefas compartilham o quadro, mas só rotinas concluem ciclo", async ({ page }) => {
    await page.goto("/admin/operacao?area=tarefas-rotinas");
    await expect(page.locator(".op-card").first()).toBeVisible({ timeout: 30_000 });

    const routineCards = page.locator(".op-card.is-routine");
    const ordinaryCards = page.locator(".op-card:not(.is-routine)");
    const completeButtons = page.getByRole("button", { name: /Concluir ciclo/ });
    for (const button of await completeButtons.all()) {
      await expect(button.locator("xpath=ancestor::article[contains(@class, 'is-routine')]")).toHaveCount(1);
    }
    if (await ordinaryCards.count()) {
      await expect(ordinaryCards.first().getByRole("button", { name: /Concluir ciclo/ })).toHaveCount(0);
    }
  });

  test("Calendário mostra somente execuções factuais das rotinas", async ({ page }) => {
    await page.goto("/admin/operacao?area=tarefas-rotinas");
    const response = await page.request.get("/api/admin/routines");
    expect(response.ok()).toBe(true);
    const body = await response.json() as { tasks: RecurringTask[] };
    const month = new Date().toISOString().slice(0, 7);
    const expected = factualRoutineEvents(body.tasks).filter((event) => event.date.startsWith(month));

    await page.getByRole("button", { name: "Calendário", exact: true }).click();
    await expect(page.locator(".rec-calendar")).toBeVisible();
    await expect(page.locator(".rec-calendar .rec-card.is-routine")).toHaveCount(expected.length);
  });

  test("deep link de execução abre o filho com retorno para a Rotina", async ({ page }) => {
    await page.goto("/admin/operacao?area=tarefas-rotinas");
    const response = await page.request.get("/api/admin/routines");
    const body = await response.json() as { tasks: RecurringTask[] };
    const routine = body.tasks.find((item) => item.executions.length > 0);
    test.skip(!routine, "Produção ainda não possui uma execução recorrente materializada.");
    const execution = routine!.executions[0];

    await page.goto(`/admin/operacao?area=tarefas-rotinas&task=${execution.id}`);
    await expect(page.locator(".tm")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Voltar para o card anterior" })).toBeVisible();
    await expect(page.locator(".op-card", { hasText: execution.title })).toHaveCount(0);
  });

  test("Back e Forward restauram a área pela URL", async ({ page }) => {
    await page.goto("/admin/operacao?area=tarefas-rotinas&situacao=atrasada");
    await page.getByRole("button", { name: /Planos e Entregas/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("area")).toBe("planos-entregas");
    expect(new URL(page.url()).searchParams.get("situacao")).toBe("atrasada");

    await page.goBack();
    await expect(page.getByRole("button", { name: "Tarefas e Rotinas", exact: true })).toHaveClass(/on/);
    await page.goForward();
    await expect(page.getByRole("button", { name: /Planos e Entregas/ })).toHaveClass(/on/);
  });

  test("Lista separa Planos e Entregas e o layout mobile empilha as colunas", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/operacao?area=planos-entregas");

    const plans = page.getByRole("heading", { name: "Planos", exact: true });
    const deliveries = page.getByRole("heading", { name: "Entregas", exact: true });
    await expect(plans).toBeVisible();
    await expect(deliveries).toBeVisible();
    const plansBox = await plans.boundingBox();
    const deliveriesBox = await deliveries.boundingBox();
    expect(plansBox).not.toBeNull();
    expect(deliveriesBox).not.toBeNull();
    expect(deliveriesBox!.y).toBeGreaterThan(plansBox!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });

  test("Estratégica mantém Entregas ligadas dentro de Planos", async ({ page }) => {
    await page.goto("/admin/operacao?area=planos-entregas");
    await page.getByRole("button", { name: "Estratégica", exact: true }).click();
    const nested = page.locator(".plan-root-branch .plan-delivery-branch.nested");
    test.skip(await nested.count() === 0, "Produção ainda não possui uma Entrega ligada a Plano.");
    await expect(nested.first()).toBeVisible();
    const nestedTitle = (await nested.first().locator(".plan-card-titleline strong").textContent())?.trim();
    expect(nestedTitle).toBeTruthy();
    await expect(page.locator(".plan-strat-groupitems > .plan-delivery-branch", { hasText: nestedTitle! })).toHaveCount(0);
  });

  test("redirect legado preserva a query e abre Planos e Entregas", async ({ page }) => {
    await page.goto("/admin/plano?situacao=atrasada");
    await page.waitForURL(/\/admin\/operacao/);

    const url = new URL(page.url());
    expect(url.searchParams.get("area")).toBe("planos-entregas");
    expect(url.searchParams.get("situacao")).toBe("atrasada");
    await expect(page.getByRole("heading", { name: "Planos", exact: true })).toBeVisible();
  });
});
