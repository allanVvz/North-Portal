import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Cobre, contra o backend real, o que foi entregue nas telas Tarefas, Clientes
// e Plano de Ação:
//   - o menu de ordenação (3 traços) ao lado da engrenagem de atributos;
//   - a ordem realmente mudando, invertendo e sobrevivendo a um reload;
//   - o card de Tarefas mostrando prazo, tag "Atrasado", "Sem data", período e
//     o responsável por extenso (era um avatar de iniciais);
//   - Plano de Ação abrindo na Lista, com os cards da Estratégica recolhidos.
// Semeia tudo o que usa e limpa no final.

const RUN = Date.now();
const TAG = `[e2e ${RUN}]`;

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

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
}

/** Isola os cards desta execução — o quadro carrega o feed de todos os clientes. */
async function filterToRun(page: Page) {
  // O feed é buscado no cliente depois do primeiro render: filtrar antes de ele
  // chegar deixaria o quadro vazio e a contagem abaixo seria uma corrida.
  await expect(page.locator(".kb-card").first()).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder(/Filtrar por cliente, tipo/).fill(TAG);
  await expect(page.locator(".kb-card")).toHaveCount(3, { timeout: 10_000 });
}

const titlesOnBoard = (page: Page) => page.locator(".kb-card .kb-card-title").allInnerTexts();

// Ontem/amanhã relativos a hoje em São Paulo, para a tag de atraso não depender
// do dia em que a suíte roda.
function spDate(offsetDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

test.describe("Ordenação e cards minimizados (e2e contra o backend real)", () => {
  // Login real + feed cross-client não cabem confortavelmente nos 30s padrão.
  test.describe.configure({ timeout: 60_000 });

  let sb: SupabaseClient;
  let seededIds: string[] = [];

  const ZEBRA = `${TAG} Zebra atrasada`;
  const ABACAXI = `${TAG} Abacaxi sem data`;
  const MELANCIA = `${TAG} Melancia com periodo`;

  test.beforeAll(async () => {
    sb = serviceClient();
    const clientId = await clientIdBySlug(sb, "karpinski");
    const rows = [
      // Vencida ontem: tem que renderizar a tag vermelha "Atrasado".
      { client_id: clientId, kind: "operacional", title: ZEBRA, status: "backlog", due_date: spDate(-1), assignee: "Ana Paula Ribeiro" },
      // Sem prazo: tem que cair no fim da ordem por data, nas DUAS direções.
      { client_id: clientId, kind: "operacional", title: ABACAXI, status: "backlog", due_date: null },
      // Período completo: início → fim no card.
      { client_id: clientId, kind: "operacional", title: MELANCIA, status: "backlog", due_date: spDate(10), start_date: spDate(3), end_date: spDate(20) },
    ];
    const { data, error } = await sb.from("tasks").insert(rows).select("id");
    if (error || !data) throw new Error(`seed failed: ${error?.message}`);
    seededIds = data.map((r) => r.id as string);
  });

  test.afterAll(async () => {
    if (seededIds.length) await sb.from("tasks").delete().in("id", seededIds);
  });

  test("o menu de ordenação ordena, inverte e persiste em Tarefas", async ({ page }) => {
    await login(page);
    await page.goto("/admin/kanban");
    await filterToRun(page);

    // O botão fica ao lado da engrenagem de atributos.
    const sortBtn = page.locator(".kb-sort-btn");
    await expect(sortBtn).toBeVisible();
    await expect(page.locator(".kb-sortmenu + .kb-attrs-gear")).toBeVisible();

    // Padrão do Quadro/Kanban: última edição, descendente.
    await sortBtn.click();
    await expect(page.locator(".kb-sortmenu-row.on")).toContainText("Última edição");
    await expect(page.locator(".kb-sortmenu-dirs button.on")).toContainText("Descendente");

    // Alfabético ascendente: Abacaxi, Melancia, Zebra.
    await page.getByRole("menuitemradio", { name: /Alfabético/ }).click();
    await page.getByRole("button", { name: /Ascendente/ }).click();
    await page.keyboard.press("Escape");
    expect(await titlesOnBoard(page)).toEqual([ABACAXI, MELANCIA, ZEBRA]);

    // Descendente inverte.
    await sortBtn.click();
    await page.getByRole("button", { name: /Descendente/ }).click();
    await page.keyboard.press("Escape");
    expect(await titlesOnBoard(page)).toEqual([ZEBRA, MELANCIA, ABACAXI]);

    // A escolha sobrevive ao reload (localStorage por dispositivo).
    await page.reload();
    await filterToRun(page);
    expect(await titlesOnBoard(page)).toEqual([ZEBRA, MELANCIA, ABACAXI]);
    await sortBtn.click();
    await expect(page.locator(".kb-sortmenu-row.on")).toContainText("Alfabético");
    await page.keyboard.press("Escape");
  });

  test("card sem data fica por último na ordem por data nas duas direções", async ({ page }) => {
    await login(page);
    await page.goto("/admin/kanban");
    await filterToRun(page);

    await page.locator(".kb-sort-btn").click();
    await page.getByRole("menuitemradio", { name: /Data \(prazo\)/ }).click();
    await page.getByRole("button", { name: /Ascendente/ }).click();
    await page.keyboard.press("Escape");
    // Ontem antes de daqui a 10 dias, e o sem-data no fim.
    expect(await titlesOnBoard(page)).toEqual([ZEBRA, MELANCIA, ABACAXI]);

    await page.locator(".kb-sort-btn").click();
    await page.getByRole("button", { name: /Descendente/ }).click();
    await page.keyboard.press("Escape");
    // A ordem das datas inverte, mas o sem-data continua no fim.
    expect(await titlesOnBoard(page)).toEqual([MELANCIA, ZEBRA, ABACAXI]);
  });

  test("o card de Tarefas mostra prazo, atraso, sem data, período e o responsável por extenso", async ({ page }) => {
    await login(page);
    await page.goto("/admin/kanban");
    await filterToRun(page);

    const atrasada = page.locator(".kb-card", { hasText: "Zebra atrasada" });
    await expect(atrasada.locator(".kb-state.overdue")).toHaveText("Atrasado");
    await expect(atrasada.locator(".kb-card-due")).toContainText("ontem");
    // Nome por extenso, não as iniciais "AP".
    await expect(atrasada.locator(".kb-assignee")).toContainText("Ana Paula Ribeiro");

    const semData = page.locator(".kb-card", { hasText: "Abacaxi sem data" });
    await expect(semData.locator(".kb-card-due")).toContainText("Sem data");
    await expect(semData.locator(".kb-state.overdue")).toHaveCount(0);

    const periodo = page.locator(".kb-card", { hasText: "Melancia com periodo" });
    await expect(periodo.locator(".kb-card-period")).toContainText("→");
  });

  test("o menu de ordenação não aparece no Calendário", async ({ page }) => {
    await login(page);
    await page.goto("/admin/kanban");
    await expect(page.locator(".kb-sort-btn")).toBeVisible();
    await page.getByRole("button", { name: "Calendário", exact: true }).click();
    await expect(page.locator(".kb-sort-btn")).toHaveCount(0);
  });

  test("Rotinas tem o menu de ordenação e ordena as rotinas", async ({ page }) => {
    await login(page);
    // Rotinas saiu da tela de Clientes e agora é uma aba de /admin/operacao.
    await page.goto("/admin/operacao");
    await page.getByRole("button", { name: /^Rotinas/ }).click();
    await expect(page.locator(".rec-board, .rec-empty")).toBeVisible();

    const sortBtn = page.locator(".kb-sort-btn");
    await expect(sortBtn).toBeVisible();
    await sortBtn.click();
    // Agrupado por prazo, o padrão é o prazo mais próximo no topo.
    await expect(page.locator(".kb-sortmenu-row.on")).toContainText("Data (prazo)");
    await expect(page.locator(".kb-sortmenu-dirs button.on")).toContainText("Ascendente");
    // "Manual" só existe onde arrastar grava position — não aqui.
    await expect(page.getByRole("menuitemradio", { name: /Manual/ })).toHaveCount(0);

    await page.keyboard.press("Escape");

    // A ordem é assertada na Lista, que é uma lista plana: nas Colunas a
    // ordenação vale DENTRO de cada coluna, então concatenar todas as colunas
    // nunca resultaria numa lista globalmente ordenada.
    await page.getByRole("button", { name: "Lista", exact: true }).click();
    await sortBtn.click();
    await page.getByRole("menuitemradio", { name: /Alfabético/ }).click();
    await page.getByRole("button", { name: /Ascendente/ }).click();
    await page.keyboard.press("Escape");

    const titles = await page.locator(".rec-list-title strong").allInnerTexts();
    expect(titles.length).toBeGreaterThan(1);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });

  test("Plano de Ação abre na Lista e a Estratégica começa recolhida", async ({ page }) => {
    await login(page);
    await page.goto("/admin/plano");

    // Lista é a primeira aba e a visão padrão.
    const tabs = page.locator(".ap-filters .kb-viewtabs button");
    await expect(tabs.first()).toHaveText("Lista");
    await expect(tabs.first()).toHaveClass(/on/);
    await expect(page.locator(".plan-acc, .admin-empty")).toBeVisible();

    await page.getByRole("button", { name: "Estratégica", exact: true }).click();
    const cards = page.locator(".plan-strat-card");
    const count = await cards.count();
    test.skip(count === 0, "Nenhum plano de ação cadastrado para exercitar a visão estratégica.");

    // Todo card nasce recolhido: sem lanes e sem o bloco Quem/Quando/Por quê.
    await expect(page.locator(".plan-strat-card.open")).toHaveCount(0);
    await expect(page.locator(".plan-strat-questions")).toHaveCount(0);

    // Clicar no cabeçalho expande, e o botão "Abrir" continua levando ao modal.
    const first = cards.first();
    await first.locator(".plan-strat-headtoggle").click();
    await expect(first).toHaveClass(/open/);
    await expect(first.locator(".plan-strat-questions")).toBeVisible();
    await expect(first.getByRole("button", { name: "Abrir" })).toBeVisible();

    // Clicar de novo recolhe.
    await first.locator(".plan-strat-headtoggle").click();
    await expect(first).not.toHaveClass(/open/);
  });
});
