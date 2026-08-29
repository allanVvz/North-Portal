import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Calendário do card aberto nos dois temas, e a escala global do app.
//
// Este spec nasceu de `kanban-published-calendar-scale.spec.ts`, que cobria
// duas coisas sem relação: a projeção visual da coluna "Publicado" dentro de
// Concluído, e o calendário/escala. A primeira metade morreu com o estágio
// "Publicado" — publicar deixou de ser nível de tarefa nenhuma. A segunda é
// cobertura de regressão de CSS que continua valendo inteira, então ela ficou.
//
// O que ela protege: o `.cal-pop` sai por portal e já ficou transparente uma
// vez por cair fora do escopo de tokens do `.admin-shell` (ver o comentário em
// app/admin/FloatingPopover.tsx), e o modal já passou da viewport em tela
// pequena por causa do `zoom` composto (html 0.8 × modal 1.1).

const RUN = Date.now();

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Credenciais Supabase ausentes para o E2E.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 20_000 });
}

test.describe("Calendário temático e escala global", () => {
  test.setTimeout(90_000);
  let sb: SupabaseClient;
  let cardId = "";
  const cardTitle = `[e2e ${RUN}] Concluído`;

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error: clientError } = await sb
      .from("clients").select("id").eq("disabled", false).limit(1).single();
    if (clientError || !client) throw new Error(`Cliente para E2E não encontrado: ${clientError?.message}`);
    const { data, error } = await sb.from("tasks").insert({
      client_id: client.id, kind: "criativo", title: cardTitle,
      status: "aprovado", due_date: "2026-08-05", position: 7000, payload: {},
    }).select("id").single();
    if (error || !data) throw new Error(`Falha ao criar card E2E: ${error?.message}`);
    cardId = data.id as string;
  });

  test.afterAll(async () => {
    if (cardId) await sb.from("tasks").delete().eq("id", cardId);
  });

  test("o calendário fica opaco nos dois temas e o modal cabe na viewport pequena", async ({ page }) => {
    await login(page);
    await page.goto("/admin/kanban");

    const completed = page.locator(".kb-col", { has: page.locator(".kb-col-head", { hasText: "Concluído" }) });
    await expect(completed.getByText(cardTitle)).toBeVisible({ timeout: 20_000 });
    await completed.locator(".kb-card", { hasText: cardTitle }).click();

    const modal = page.locator(".tm");
    await modal.getByRole("button", { name: "Abrir calendário" }).first().click();
    const calendar = page.locator(".admin-shell > .cal-pop.cal-pop-range");
    await expect(calendar).toBeVisible();

    const light = await calendar.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow };
    });
    expect(light.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(light.shadow).not.toBe("none");

    await page.locator(".admin-shell").evaluate((element) => element.setAttribute("data-theme", "dark"));
    const dark = await calendar.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow };
    });
    expect(dark.background).not.toBe(light.background);
    expect(dark.border).not.toBe("rgba(0, 0, 0, 0)");
    expect(dark.shadow).not.toBe("none");

    expect(await page.locator("html").evaluate((element) => getComputedStyle(element).zoom)).toBe("0.8");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(modal).toBeVisible();
    const modalBox = await modal.boundingBox();
    expect(modalBox).not.toBeNull();
    expect(modalBox!.x).toBeGreaterThanOrEqual(0);
    expect(modalBox!.width).toBeLessThanOrEqual(390 / 0.8 + 2);
  });
});
