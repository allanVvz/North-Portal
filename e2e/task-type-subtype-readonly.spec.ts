import { expect, test } from "@playwright/test";
import { openAdminSession } from "./adminSession";

test.describe("Tipo e Subtipo (somente leitura)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => { await openAdminSession(page); });

  test("modal de criação oferece três raízes e distingue Reels simples de Entrega", async ({ page }) => {
    await page.goto("/admin/home");
    const catalogResponse = await page.request.get("/api/admin/task-types");
    expect(catalogResponse.ok()).toBe(true);
    const catalog = await catalogResponse.json() as { types: Array<{ key: string }> };
    expect(catalog.types.some((type) => type.key === "entrega_reels")).toBe(true);
    await page.getByRole("button", { name: "+ Nova tarefa" }).click();
    const modal = page.locator(".tm").first();
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await expect(modal.getByRole("button", { name: /Tipo: Tarefa/ })).toBeVisible();
    await modal.getByRole("button", { name: /Tipo: Tarefa/ }).click();
    await expect(modal.locator(".tm-headpick-panel .tm-headpick-option")).toHaveText(["Tarefa", "Entrega", "Plano"]);
    await modal.locator(".tm-headpick-panel .tm-headpick-option", { hasText: "Entrega" }).click();
    await expect(modal.getByRole("button", { name: /Subtipo: Criativo/ })).toBeVisible({ timeout: 30_000 });
    await modal.getByRole("button", { name: /Subtipo: Criativo/ }).click();
    await expect(modal.locator(".tm-headpick-panel .tm-headpick-option", { hasText: "Automação" })).toBeVisible();
    await modal.locator(".tm-headpick-panel .tm-headpick-option", { hasText: "Reels" }).click();
    await expect(modal.getByRole("button", { name: /Tipo: Entrega/ })).toBeVisible();
    await expect(modal.getByRole("button", { name: /Subtipo: Reels/ })).toBeVisible();
    await expect(modal.getByText("Formato", { exact: true })).toHaveCount(0);
    await modal.getByRole("button", { name: /Tipo: Entrega/ }).click();
    await modal.locator(".tm-headpick-panel .tm-headpick-option", { hasText: "Tarefa" }).click();
    await modal.getByRole("button", { name: /Subtipo:/ }).click();
    await expect(modal.locator(".tm-headpick-panel .tm-headpick-option", { hasText: "Reels" })).toBeVisible();
  });

  test("Configurações aninha os formatos em Entrega", async ({ page }) => {
    await page.goto("/admin/configuracoes?tab=fluxos");
    const groups = page.locator(".voc-group > .set-h");
    await expect(groups).toHaveText(["Tarefa", "Entrega", "Plano", "Checkpoint"], { timeout: 30_000 });
    const deliveryGroup = page.locator(".voc-group", { has: page.getByRole("heading", { name: "Entrega", exact: true }) });
    await expect(deliveryGroup.locator(".voc-type")).toHaveCount(7);
    await expect(deliveryGroup.getByText("Automação", { exact: true })).toBeVisible();
    await expect(page.getByText("Formatos canônicos")).toHaveCount(0);
    await page.getByRole("button", { name: "+ Novo subtipo de Entrega" }).click();
    await expect(page.getByRole("heading", { name: "Novo subtipo de Entrega" })).toBeVisible();
    await page.getByRole("button", { name: "Fechar" }).click();
    await page.getByRole("button", { name: "+ Novo subtipo de Tarefa" }).first().click();
    await expect(page.getByText("Nome da etapa")).toBeVisible();
  });

  test("painel lateral mostra campos separados para card existente", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("kb-sidebar-enabled", "1"));
    await page.goto("/admin/kanban");
    const ordinary = page.locator("article.kb-card", { has: page.locator('[aria-label^="Tipo: Tarefa"]') }).first();
    await expect(ordinary).toBeVisible({ timeout: 30_000 });
    await ordinary.click();
    const panel = page.locator(".tdp");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator(".tdp-attr", { has: page.getByText("Tipo", { exact: true }) }).locator("select")).toHaveValue("tarefa");
    await expect(panel.locator(".tdp-attr", { has: page.getByText("Subtipo", { exact: true }) }).locator("select")).toBeVisible();
  });

  test("criação dentro do Plano escolhe Tipo e Subtipo", async ({ page }) => {
    await page.goto("/admin/home");
    await page.getByRole("button", { name: "+ Nova tarefa" }).click();
    const modal = page.locator(".tm").first();
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await modal.getByRole("button", { name: /Tipo: Tarefa/ }).click();
    await modal.locator(".tm-headpick-panel .tm-headpick-option", { hasText: "Plano" }).click();
    const composer = modal.locator(".pac");
    await composer.locator(".pac-box").click();
    await expect(composer.getByRole("group", { name: "Tipo do novo card" }).getByRole("button", { name: "Tarefa" })).toBeVisible();
    await expect(composer.getByRole("group", { name: "Tipo do novo card" }).getByRole("button", { name: "Entrega" })).toBeVisible();
    await expect(composer.getByText("Subtipo", { exact: true })).toBeVisible();
  });

  test("filtros separam Tipo de Subtipo", async ({ page }) => {
    await page.goto("/admin/operacao?area=tarefas-rotinas");
    await page.getByRole("textbox", { name: "Buscar ou filtrar" }).click();
    await page.locator(".op-searchbar-panel .kb-searchbar-attr", { hasText: "Tipo" }).click();
    await expect(page.locator(".op-searchbar-panel .op-option", { hasText: "Entrega" })).toBeVisible();
    await page.locator(".op-searchbar-panel .op-option", { hasText: "Entrega" }).click();
    await page.getByRole("button", { name: "‹ Atributos" }).click();
    await page.locator(".op-searchbar-panel .kb-searchbar-attr", { hasText: "Subtipo" }).click();
    await expect(page.locator(".op-searchbar-panel .op-option", { hasText: "Reels" })).toBeVisible();
  });
});
