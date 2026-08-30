import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Captura visual de Clientes e Operação, para avaliação de design.
//
// Não afirma pixel nenhum — grava PNGs em e2e/__screenshots__/ para leitura
// humana (mesma convenção de visual-check.spec.ts). Existe porque avaliar
// layout lendo TSX é adivinhação: espaçamento, hierarquia e densidade só
// aparecem renderizados.
//
// Os dois temas e os dois tamanhos de propósito. O tema escuro tem tokens
// próprios e já escondeu problema de contraste antes; e o app roda com
// `zoom: 0.80` no html, então o que parece confortável em 1440 pode estar
// apertado de verdade.
//
// NADA de `fullPage: true`: a barra lateral é `position: sticky` e o Chromium
// a rasteja para o meio da imagem quando estica a página inteira. O print é do
// viewport (layout real, com a lateral no lugar) mais um print do elemento
// `.admin-page` (conteúdo inteiro, sem a lateral) — mesma convenção de
// visual-check.spec.ts.

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.locator(".admin-shell").evaluate((el, t) => el.setAttribute("data-theme", t), theme);
  // Dar um quadro para a transição de cor assentar antes do print.
  await page.waitForTimeout(400);
}

test.describe("Captura visual — Clientes e Operação", () => {
  test.setTimeout(180_000);

  test("Clientes e Operação nos dois temas e em tela pequena", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 1440, height: 1000 });

    // ---- Clientes ----------------------------------------------------------
    await page.goto("/admin/clientes");
    await expect(page.locator(".admin-page")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200); // dados reais chegam por fetch
    await setTheme(page, "light");
    await page.screenshot({ path: "e2e/__screenshots__/clientes-claro.png" });
    await page.locator(".admin-page").screenshot({ path: "e2e/__screenshots__/clientes-conteudo-claro.png" });
    await setTheme(page, "dark");
    await page.screenshot({ path: "e2e/__screenshots__/clientes-escuro.png" });

    // ---- Operação, as três abas -------------------------------------------
    await setTheme(page, "light");
    await page.goto("/admin/operacao");
    await expect(page.locator(".admin-page")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await setTheme(page, "light");
    await page.screenshot({ path: "e2e/__screenshots__/operacao-tarefas-claro.png" });
    await page.locator(".admin-page").screenshot({ path: "e2e/__screenshots__/operacao-tarefas-conteudo.png" });

    for (const [aba, arquivo] of [["Entregas", "entregas"], ["Rotinas", "rotinas"]] as const) {
      const botao = page.getByRole("button", { name: new RegExp(`^${aba}`) }).first();
      if (await botao.count()) {
        await botao.click();
        await page.waitForTimeout(1200);
        await page.locator(".admin-page").screenshot({ path: `e2e/__screenshots__/operacao-${arquivo}-claro.png` });
      }
    }

    await setTheme(page, "dark");
    await page.screenshot({ path: "e2e/__screenshots__/operacao-escuro.png" });

    // ---- Tela pequena ------------------------------------------------------
    await setTheme(page, "light");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/clientes");
    await expect(page.locator(".admin-page")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "e2e/__screenshots__/clientes-mobile.png" });

    await page.goto("/admin/operacao");
    await expect(page.locator(".admin-page")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "e2e/__screenshots__/operacao-mobile.png" });
  });
});
