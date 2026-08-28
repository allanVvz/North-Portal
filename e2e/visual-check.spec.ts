import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Captura visual das telas em revisão. Não afirma pixels — grava PNGs em
// e2e/__screenshots__/ para inspeção humana. Semeia leads próprios (prefixo
// VIS-) porque com um único lead em produção não dá para enxergar
// desalinhamento de colunas, e os apaga no fim.

const RUN = Date.now();
const EXISTING_EMAIL = process.env.E2E_ADMIN_EMAIL?.trim();
const EXISTING_PASSWORD = process.env.E2E_ADMIN_PASSWORD?.trim();
const USE_EXISTING_USER = Boolean(EXISTING_EMAIL && EXISTING_PASSWORD);
const EMAIL = EXISTING_EMAIL ?? `e2e-visual-${RUN}@e2e-test.com`;
const PASSWORD = EXISTING_PASSWORD ?? `E2e-${RUN}-Strong!`;
const TAG = `VIS-${RUN}`;

function dayOffset(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Números com estrangulamento real de funil (9.000 alcance -> 240 cliques ->
// 24 resultados): é o que permite avaliar se as faixas do SVG são de fato
// proporcionais. Sem mock a conta local não devolve linhas e o funil renderiza
// inteiro no estado "sem dado", que não prova nada visualmente.
function paidRow(id: string, date: string, campaignId: string, name: string, metrics: Record<string, number>) {
  return {
    id, date, campaignId, campaignName: name, metrics, accountId: "acc", accountName: "Conta Meta",
    platform: "facebook", source: "paid", type: "outro", caption: name, permalink: null,
    objective: "OUTCOME_ENGAGEMENT", currency: "BRL",
  };
}

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase não configurado para E2E.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(EMAIL);
  await page.getByPlaceholder("Sua senha").fill(PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

const SEED = [
  { name: "Ana Ribeiro", company: "Aurora Estética", segment: "Estética automotiva", region: "Campinas SP", investment: "6k-12k", status: "novo" },
  { name: "Bruno Tavares", company: "Studio Norte Odontologia", segment: "Saúde", region: "Curitiba PR", investment: "12k+", status: "novo" },
  { name: "Carla Menezes", company: "Verde Vivo Paisagismo e Jardinagem", segment: "Serviços regionais", region: "Belo Horizonte MG", investment: "até-3k", status: "contatado" },
  { name: "Diego Alencar", company: "Pizzaria Forno de Pedra", segment: "Alimentação", region: "Sorocaba SP", investment: "3k-6k", status: "contatado" },
  { name: "Elisa Prado", company: "Clínica Bem Estar", segment: "Saúde", region: "Ribeirão Preto SP", investment: "6k-12k", status: "qualificado" },
  { name: "Felipe Souza", company: "AutoCenter Marechal", segment: "Automotivo", region: "Londrina PR", investment: "12k+", status: "qualificado" },
  { name: "Gabriela Lima", company: "Petit Boutique", segment: "Varejo", region: "Santos SP", investment: "até-3k", status: "descartado" },
];

test.describe("Captura visual — Leads e Performance", () => {
  let supabase: SupabaseClient;
  let userId = "";

  test.beforeAll(async () => {
    supabase = serviceClient();
    await supabase.from("leads").insert(SEED.map((lead) => ({
      ...lead,
      phone: "5519999990000",
      objective: `${TAG} gerar demanda qualificada`,
      source_page: "/lp",
      utm_source: "instagram",
      utm_campaign: "diagnostico-agosto",
    })));

    if (USE_EXISTING_USER) return;
    const { data, error } = await supabase.auth.admin.createUser({
      email: EMAIL, password: PASSWORD, email_confirm: true,
      app_metadata: { role: "admin", level: "gerente" },
    });
    if (error || !data.user) throw new Error(error?.message ?? "Falha ao criar usuário E2E.");
    userId = data.user.id;
    const { error: profileError } = await supabase.from("profiles").upsert({ id: userId, role: "admin", level: "gerente", client_id: null });
    if (profileError) throw new Error(profileError.message);
  });

  test.afterAll(async () => {
    await supabase.from("leads").delete().like("objective", `${TAG}%`);
    if (!USE_EXISTING_USER && userId) await supabase.auth.admin.deleteUser(userId);
  });

  test("captura Leads (kanban e tabela) e Aquisição", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page);

    // ---- Leads ----
    await page.goto("/admin/clientes");
    await page.getByRole("button", { name: /^Leads/ }).click();
    await expect(page.locator(".leads-pipeline")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.locator(".admin-page").screenshot({ path: "e2e/__screenshots__/leads-kanban.png" });

    await page.getByRole("button", { name: "Tabela", exact: true }).click();
    await expect(page.locator(".admin-table")).toBeVisible();
    await page.waitForTimeout(400);
    await page.locator(".admin-page").screenshot({ path: "e2e/__screenshots__/leads-tabela.png" });

    // ---- Performance · Aquisição (funil + métricas) ----
    const rows = [
      paidRow("a-now", dayOffset(-5), "cmp-a", "Campanha Alfa", { custo: 1240, impressoes: 42000, alcance: 9000, cliques: 240, cliquesLink: 150, leads: 12, mensagens: 24, resultado: 24, contatos: 24 }),
      paidRow("b-now", dayOffset(-9), "cmp-b", "Campanha Beta", { custo: 860, impressoes: 26000, alcance: 6100, cliques: 160, cliquesLink: 98, leads: 7, mensagens: 15, resultado: 15, contatos: 15 }),
      paidRow("a-prev", dayOffset(-40), "cmp-a", "Campanha Alfa", { custo: 900, impressoes: 30000, alcance: 7000, cliques: 150, cliquesLink: 90, leads: 6, mensagens: 11, resultado: 11, contatos: 11 }),
    ];
    await page.route("**/api/admin/performance/insights**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/insights")) return route.continue();
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ demo: false, stale: false, posts: rows, datasources: { facebook: true, meta_ads: true }, fetchedAt: null }),
      });
    });
    await page.goto("/admin/performance");
    await expect(page.locator(".acq-conversion-flow")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    await page.locator(".acq-conversion-flow").screenshot({ path: "e2e/__screenshots__/aquisicao.png" });
    await page.getByRole("region", { name: "KPIs principais" }).screenshot({ path: "e2e/__screenshots__/aquisicao-kpis.png" });
  });
});
