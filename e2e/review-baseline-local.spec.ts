import { expect, test } from "@playwright/test";
import { openAdminSession } from "./adminSession";

const MOLD = "71e87469-990b-416e-9d0e-a6f57e781343";
const PLAN = "7e1a162d-ff0f-414e-ad50-bea8b472fbcd";

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`captura autenticada atual ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await openAdminSession(page);
    for (const [name, id] of [["reuniao-1609", MOLD], ["plano-baita", PLAN]]) {
      await page.goto(`/admin/kanban?task=${id}`);
      await expect(page.locator(".tm")).toBeVisible({ timeout: 30_000 });
      if (id === MOLD) await expect(page.locator(".tm").getByText(/Reunião 16 de set/i)).toBeVisible({ timeout: 30_000 });
      else await expect(page.locator(".tm").getByText(/Atividades do plano \([1-9]/i)).toBeVisible({ timeout: 30_000 });
      await page.locator(".tm").screenshot({ path: `artifacts/review-before-${name}-${viewport.width}.png` });
    }
  });
}
