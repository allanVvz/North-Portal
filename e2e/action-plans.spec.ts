import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// End-to-end coverage of the Plano de Ação model against the live backend:
// seeds one plan per client (Karpinski + Baita), each with real member
// activities, then logs in as an admin, opens /admin/plano and asserts both
// plans render with the correct rolled-up progress and their activities. Cleans
// up everything it creates.

const RUN = Date.now();

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key);
}

async function clientIdBySlug(sb: SupabaseClient, slug: string): Promise<string> {
  const { data, error } = await sb.from("clients").select("id").eq("slug", slug).single();
  if (error || !data) throw new Error(`client '${slug}' not found: ${error?.message}`);
  return data.id as string;
}

type MemberSeed = { kind: string; status: string };

async function seedPlan(
  sb: SupabaseClient,
  clientId: string,
  title: string,
  members: MemberSeed[],
  // Responsável e justificativa entram só para dar ao filtro da view
  // Estratégica um valor único por execução — sem isso o teste dependeria de
  // quantos planos reais existem em produção no dia.
  extra: { assignee?: string; description?: string } = {},
): Promise<string[]> {
  const { data: plan, error: planErr } = await sb
    .from("tasks")
    .insert({ client_id: clientId, kind: "plano_acao", title, status: "em_producao", client_visible: true, start_date: "2026-07-06", end_date: "2026-07-11", ...extra })
    .select("id")
    .single();
  if (planErr || !plan) throw new Error(`seed plan failed: ${planErr?.message}`);
  const ids = [plan.id as string];
  for (const [i, m] of members.entries()) {
    const { data: mem, error: memErr } = await sb
      .from("tasks")
      .insert({ client_id: clientId, kind: m.kind, title: `${title} · ativ ${i + 1}`, status: m.status, client_visible: true })
      .select("id")
      .single();
    if (memErr || !mem) throw new Error(`seed member failed: ${memErr?.message}`);
    // Membership virou elo em `task_links`; `plan_id` hoje significa apenas
    // "ocorrência de recorrência". Semear pelo campo antigo faria as atividades
    // simplesmente não aparecerem no plano.
    const { error: linkErr } = await sb.from("task_links").insert({ parent_id: plan.id, child_id: mem.id, position: i });
    if (linkErr) throw new Error(`seed link failed: ${linkErr.message}`);
    ids.push(mem.id as string);
  }
  return ids;
}

test.describe("Planos de Ação — dois clientes (e2e contra o backend real)", () => {
  let sb: SupabaseClient;
  let seededIds: string[] = [];
  // Karpinski: criativo em_producao (35%) + criativo aprovado (100%) => 68%
  const planKarp = `[e2e ${RUN}] Plano Karpinski`;
  // Baita: operacional aprovacao (80%) + operacional aprovado (100%) => 90%
  const planBaita = `[e2e ${RUN}] Plano Baita`;
  const OWNER = `E2E Estrategica ${RUN}`;

  test.beforeAll(async () => {
    sb = serviceClient();
    const karpId = await clientIdBySlug(sb, "karpinski");
    const baitaId = await clientIdBySlug(sb, "baita-conveniencia");
    const a = await seedPlan(sb, karpId, planKarp, [
      { kind: "criativo", status: "em_producao" },
      { kind: "criativo", status: "aprovado" },
    ], { assignee: OWNER, description: "Justificativa e2e do plano karpinski" });
    const b = await seedPlan(sb, baitaId, planBaita, [
      { kind: "operacional", status: "aprovacao" },
      { kind: "operacional", status: "aprovado" },
    ], { assignee: OWNER, description: "Justificativa e2e do plano baita" });
    seededIds = [...a, ...b];
  });

  test.afterAll(async () => {
    if (seededIds.length) await sb.from("tasks").delete().in("id", seededIds);
  });

  test("ambos os planos aparecem em /admin/plano com o progresso rollado correto", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
    await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /Entrar/ }).click();
    // 45s (o teto que 8 outros specs deste diretorio ja usam) porque o que
    // estoura aqui nao e o login: e a PRIMEIRA compilacao de /login pelo next
    // dev depois de um `.next` limpo — o CLAUDE.md registra 16.8s medidos, e
    // com o cache frio passa disso. Em 15s este teste falhava so quando era o
    // primeiro da fila.
    await page.waitForURL(/\/admin/, { timeout: 45_000 });

    await page.goto("/admin/plano");
    // Lista is the default view, but click it explicitly so this regression
    // test keeps asserting the accordion structure even if the default moves.
    await page.getByRole("button", { name: "Lista", exact: true }).click();

    // Karpinski plan: header shows 68%, expanding lists its 2 activities.
    const karpItem = page.locator(".plan-acc-item", { hasText: planKarp });
    await expect(karpItem).toBeVisible();
    await expect(karpItem.locator(".plan-acc-progress b")).toHaveText("68%");
    await karpItem.getByRole("button", { name: "Expandir" }).click();
    await expect(karpItem.locator(".plan-acc-list li")).toHaveCount(2);

    // Baita plan: 90%.
    const baitaItem = page.locator(".plan-acc-item", { hasText: planBaita });
    await expect(baitaItem).toBeVisible();
    await expect(baitaItem.locator(".plan-acc-progress b")).toHaveText("90%");
    await baitaItem.getByRole("button", { name: "Expandir" }).click();
    await expect(baitaItem.locator(".plan-acc-list li")).toHaveCount(2);
  });
  // View Estratégica (R6.3): as três perguntas do cabeçalho — quem, quando,
  // por quê — deixaram de ser texto fixo e viraram o filtro da tela.
  test("Estratégica: quem/quando/porquê filtram, e abaixo de 5 planos o acordeão abre sozinho", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/login");
    await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
    await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /Entrar/ }).click();
    await page.waitForURL(/\/admin/, { timeout: 20_000 });

    await page.goto("/admin/plano");
    await page.getByRole("button", { name: "Estratégica", exact: true }).click();

    const bar = page.locator(".plan-qbar");
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar.locator(".plan-qlabel")).toHaveText(["Quem", "Quando", "Por quê"]);

    // Quando reusa o calendário composto de 2 meses (R6.5) em vez de recriar
    // um seletor de data — é literalmente o mesmo componente da Performance.
    await bar.locator(".daterange-trigger").click();
    await expect(page.locator(".admin-shell > .cal-pop.cal-pop-dual")).toBeVisible();
    await page.keyboard.press("Escape");

    // Quem: o responsável semeado só existe nesta execução, então o filtro
    // deixa exatamente os 2 planos do teste — independente de quantos planos
    // reais existam em produção hoje.
    const quem = bar.locator(".plan-qfield").first();
    await quem.locator(".plan-qvalue").click();
    await page.locator(".plan-qpop .plan-qinput").fill(OWNER);
    await page.locator(".plan-qpop .plan-qoption", { hasText: OWNER }).click();

    const cards = page.locator(".plan-strat-card");
    await expect(cards).toHaveCount(2);
    await expect(page.locator(".plan-qresult")).toContainText("2 de");
    // Abaixo de 5 na tela, cada plano nasce aberto — quem filtrou até aqui
    // filtrou para ver o conteúdo, não para clicar mais duas vezes.
    await expect(page.locator(".plan-strat-card.open")).toHaveCount(2);
    await expect(page.locator(".plan-qresult")).toContainText("abertos automaticamente");
    await expect(cards.first().locator(".plan-strat-lane")).not.toHaveCount(0);

    // Um clique manual vence o automático — e só naquele card.
    await cards.first().locator(".plan-strat-headtoggle").click();
    await expect(page.locator(".plan-strat-card.open")).toHaveCount(1);

    // Por quê casa contra a justificativa, e soma com o Quem (E, não OU).
    const porque = bar.locator(".plan-qfield").last();
    await porque.locator(".plan-qvalue").click();
    await page.locator(".plan-qpop .plan-qinput").fill("karpinski");
    await page.keyboard.press("Enter");
    await expect(page.locator(".plan-strat-card")).toHaveCount(1);

    // Um período que não encosta nos planos semeados (jul/2026) esvazia a tela.
    await page.locator(".plan-qresult button", { hasText: "Limpar filtros" }).click();
    await expect(page.locator(".plan-qresult")).toHaveCount(0);
  });
});
