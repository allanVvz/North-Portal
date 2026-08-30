import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// A gaveta do menu no mobile.
//
// Antes o menu inteiro ficava sempre aberto no topo — seis itens em duas
// linhas mais o cartão da conta, ~190px antes de qualquer conteúdo, em toda
// página. Este spec fixa as três coisas que separam uma gaveta de um menu que
// atrapalha: ela começa fechada, ela fecha ao NAVEGAR (senão a pessoa chega na
// página nova com a gaveta por cima), e ela fecha por fora e pelo Escape.

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

test.describe("Menu do mobile", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto("/admin/clientes");
    await expect(page.locator(".admin-page")).toBeVisible({ timeout: 30_000 });
  });

  test("começa fechado e devolve a tela ao conteúdo", async ({ page }) => {
    const drawer = page.locator("#admin-drawer");
    await expect(drawer).not.toHaveClass(/open/);

    // Fora da tela, não apenas escondido: `translateX(-100%)`.
    const caixa = await drawer.boundingBox();
    expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(1);

    // E o conteúdo começa perto do topo. Com o menu sempre aberto, o título da
    // página caía por volta de 210px; o cabeçalho é agora só a barra.
    const titulo = await page.locator(".admin-page h1").first().boundingBox();
    expect(titulo!.y).toBeLessThan(140);
  });

  test("abre no clique, fecha por fora e pelo Escape", async ({ page }) => {
    const drawer = page.locator("#admin-drawer");
    const botao = page.getByRole("button", { name: "Abrir menu" });

    await botao.click();
    await expect(drawer).toHaveClass(/open/);
    await expect(page.getByRole("link", { name: "Operação" })).toBeVisible();
    await expect(botao).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Fechar menu" }).first()).toBeVisible();

    // Toque perto da borda direita, que é onde o "fora" fica de verdade: o
    // centro da cortina cai por cima da própria gaveta.
    await page.locator(".admin-drawer-scrim").click({ position: { x: 350, y: 500 } });
    await expect(drawer).not.toHaveClass(/open/);

    await page.getByRole("button", { name: "Abrir menu" }).click();
    await expect(drawer).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(drawer).not.toHaveClass(/open/);
  });

  test("fecha sozinho ao navegar", async ({ page }) => {
    const drawer = page.locator("#admin-drawer");
    await page.getByRole("button", { name: "Abrir menu" }).click();
    await expect(drawer).toHaveClass(/open/);

    await page.getByRole("link", { name: "Operação" }).click();
    await page.waitForURL(/\/admin\/operacao/, { timeout: 30_000 });
    // A asserção que importa: chegar na página pedida SEM a gaveta por cima.
    await expect(drawer).not.toHaveClass(/open/);
  });
});
