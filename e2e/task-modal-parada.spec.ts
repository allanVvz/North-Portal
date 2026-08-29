import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// O alarme de "Parada" no stepper do card aberto.
//
// Existe porque a primeira versão pintava a etapa de vermelho SEM o
// qualificador `.current`: o alarme ficava aceso em todo card, inclusive nos
// saudáveis, e um alarme sempre aceso vira ruído que se aprende a ignorar.
// A regressão é invisível para qualquer teste que só olhe o card parado — daí
// este spec afirmar as DUAS metades: vermelho quando parado, e nada de
// vermelho quando não.

const RUN = Date.now();
const PREFIX = `[e2e ${RUN}]`;
// --a-danger no tema claro (#c2604e).
const DANGER = "rgb(194, 96, 78)";

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

/** Cor computada do rótulo e do ponto da etapa "Parada" no card aberto. */
async function haltStepColors(page: Page) {
  return page.evaluate(() => {
    const step = document.querySelector(".tm-step-halt");
    if (!step) return null;
    const label = step.querySelector(".tm-step-label");
    const dot = step.querySelector(".tm-step-dot");
    return {
      isCurrent: step.classList.contains("current"),
      label: label ? getComputedStyle(label).color : null,
      dotBackground: dot ? getComputedStyle(dot).backgroundColor : null,
    };
  });
}

test.describe("Etapa Parada — alarme só quando o card está parado", () => {
  test.setTimeout(90_000);
  let sb: SupabaseClient;
  let paradaId = "";
  let normalId = "";

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error } = await sb.from("clients").select("id").eq("slug", "karpinski").single();
    if (error || !client) throw new Error(`cliente karpinski não encontrado: ${error?.message}`);
    const { data, error: insErr } = await sb
      .from("tasks")
      .insert([
        {
          client_id: client.id, kind: "operacional", title: `${PREFIX} card parado`,
          status: "parada", payload: { pre_parada_status: "em_producao" },
        },
        // `payload` é NOT NULL na tabela — o objeto vazio é obrigatório.
        { client_id: client.id, kind: "operacional", title: `${PREFIX} card saudavel`, status: "em_producao", payload: {} },
      ])
      .select("id,status");
    if (insErr || !data) throw new Error(`seed falhou: ${insErr?.message}`);
    paradaId = data.find((t) => t.status === "parada")?.id as string;
    normalId = data.find((t) => t.status === "em_producao")?.id as string;
  });

  test.afterAll(async () => {
    await sb.from("tasks").delete().like("title", `${PREFIX}%`);
  });

  test("card parado: ponto e rótulo em vermelho", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/kanban?task=${paradaId}`);
    await expect(page.locator(".tm")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tm-step-halt")).toBeVisible({ timeout: 20_000 });

    const colors = await haltStepColors(page);
    expect(colors?.isCurrent).toBe(true);
    expect(colors?.label).toBe(DANGER);
    expect(colors?.dotBackground).toBe(DANGER);
  });

  test("card saudável: a etapa Parada não fica vermelha", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/kanban?task=${normalId}`);
    await expect(page.locator(".tm")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tm-step-halt")).toBeVisible({ timeout: 20_000 });

    // A etapa existe no stepper — ela só não pode estar acesa.
    const colors = await haltStepColors(page);
    expect(colors?.isCurrent).toBe(false);
    expect(colors?.label).not.toBe(DANGER);
    expect(colors?.dotBackground).not.toBe(DANGER);
  });
});
