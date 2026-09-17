import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// This is deliberately read-only: it proves that the public login screen can
// establish an admin session and reach the protected shell.  Task-family E2E
// fixtures are separate because they create and reconcile operational data.
const hasDedicatedCredentials = Boolean(
  process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD,
);

test("login público autentica e encaminha um administrador", async ({ page }) => {
  test.skip(!hasDedicatedCredentials, "Configure E2E_ADMIN_EMAIL e E2E_ADMIN_PASSWORD para validar autenticação.");

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar no portal" })).toBeVisible();
  await page.getByLabel("E-mail").fill(ADMIN_EMAIL);
  await page.getByLabel("Senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /entrar/i }).click();

  await page.waitForURL(/\/admin\/home(?:\?|$)/, { timeout: 45_000 });
  await expect(page.getByRole("main")).toBeVisible();
});
