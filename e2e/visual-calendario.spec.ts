import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Captura visual do Calendário, para avaliação de design. Não afirma pixel
// nenhum — grava PNGs em e2e/__screenshots__/ e mede as alturas das linhas da
// grade, que é o número que decide se o mês está "orgânico" ou irregular.

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

async function abrirCalendario(page: Page) {
  await page.goto("/admin/operacao");
  await expect(page.locator(".admin-page")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Calendário", exact: true }).click();
  await page.waitForTimeout(1200);
}

test("calendário — grade regular, mês e semana", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await abrirCalendario(page);

  // As três coisas que quebraram aqui, viradas em asserção.
  const grade = await page.evaluate(() => {
    const semanas = [...document.querySelectorAll(".kb-cal-week-days")];
    const larguras = semanas.map((w) =>
      [...w.querySelectorAll(".kb-cal-cell")].map((c) => Math.round(c.getBoundingClientRect().width)),
    );
    const alturas = semanas.map((w) => Math.round(w.getBoundingClientRect().height));
    const celulas = [...document.querySelectorAll(".kb-cal-cell")];
    const vazando = celulas.filter((c) => {
      const largura = c.getBoundingClientRect().width;
      return [...c.querySelectorAll(".kb-cal-pill")].some((p) => p.getBoundingClientRect().width > largura + 1);
    }).length;
    const maxPorDia = Math.max(0, ...celulas.map((c) => c.querySelectorAll(".kb-cal-pill").length));
    return { larguras, alturas, vazando, maxPorDia };
  });
  console.log("GRADE " + JSON.stringify(grade));

  // 1. Sete colunas IGUAIS, em toda semana. `repeat(7, 1fr)` é
  //    `minmax(auto, 1fr)`, e com uma pílula `nowrap` dentro o mínimo virava o
  //    título inteiro: uma semana real chegou a medir 121, 275, 20, 211, 203,
  //    254, 219 — um dia com vinte pixels. `minmax(0, 1fr)` é o conserto, e
  //    esta asserção é o que impede o zero de sumir de novo.
  for (const semana of grade.larguras) {
    expect(semana).toHaveLength(7);
    expect(Math.max(...semana) - Math.min(...semana)).toBeLessThanOrEqual(2);
  }

  // 2. Nenhuma pílula mais larga que o próprio dia.
  expect(grade.vazando).toBe(0);

  // 3. Nenhum dia mostra mais que o limite sem ser aberto — é isso que mantém
  //    as semanas com altura parecida. Antes, um dia com nove cards deixava a
  //    linha 3,3× mais alta que a primeira do mês.
  expect(grade.maxPorDia).toBeLessThanOrEqual(3);
  expect(Math.max(...grade.alturas) / Math.min(...grade.alturas)).toBeLessThan(2);

  await page.screenshot({ path: "e2e/__screenshots__/calendario-mes.png" });
  await page.locator(".kb-cal").screenshot({ path: "e2e/__screenshots__/calendario-mes-grade.png" });

  await page.getByRole("button", { name: "Semana", exact: true }).click();
  await page.waitForTimeout(900);
  await page.locator(".kb-cal").screenshot({ path: "e2e/__screenshots__/calendario-semana.png" });

  await page.getByRole("button", { name: "Mês", exact: true }).click();
  await page.waitForTimeout(600);
  await page.locator(".admin-shell").evaluate((el) => el.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(400);
  await page.locator(".kb-cal").screenshot({ path: "e2e/__screenshots__/calendario-mes-escuro.png" });

  await page.locator(".admin-shell").evaluate((el) => el.setAttribute("data-theme", "light"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "e2e/__screenshots__/calendario-mobile.png" });
});
