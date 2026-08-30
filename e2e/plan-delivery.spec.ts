import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Entrega dentro de Plano de Ação.
//
// Os dois tipos de pai sempre usaram a MESMA tabela de elos, distinguidos só
// pelo `slot` — preenchido para etapa de entrega, nulo para membro de plano. E
// os dois helpers que liam isso (`flowStepsOf` e `actionPlanMembersOf`) eram
// literalmente a mesma função, sem filtro nenhum. Enquanto os dois mundos não
// se encontravam ninguém percebia; no dia em que uma Entrega entra num Plano,
// tudo que lia "o primeiro pai" passa a ler o pai errado.
//
// Este spec existe porque cada asserção abaixo corresponde a um bug real que
// nenhum teste pegava.

const RUN = Date.now();
const PREFIX = `[e2e ${RUN}]`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

test.describe("Entrega dentro de Plano de Ação", () => {
  test.setTimeout(120_000);
  let sb: SupabaseClient;
  let clientId = "";
  let planoId = "";
  let entregaId = "";
  const stepIds: Record<string, string> = {};
  let membroSimplesId = "";

  const planoTitle = `${PREFIX} Plano com entrega`;
  const entregaTitle = `${PREFIX} Entrega no plano`;

  async function insert(fields: Record<string, unknown>): Promise<string> {
    const { data, error } = await sb.from("tasks").insert(fields).select("id").single();
    if (error || !data) throw new Error(`seed falhou: ${error?.message}`);
    return data.id as string;
  }

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error } = await sb.from("clients").select("id").eq("slug", "karpinski").single();
    if (error || !client) throw new Error(`cliente karpinski não encontrado: ${error?.message}`);
    clientId = client.id as string;

    planoId = await insert({
      client_id: clientId, kind: "plano_acao", title: planoTitle, status: "em_producao", payload: {},
    });

    // Entrega de 4 etapas, membro do plano (elo SEM slot).
    entregaId = await insert({
      client_id: clientId, kind: "criativo", subtype: null, title: entregaTitle, status: "em_producao",
      payload: { flow_parent: true, flow_total_weight: 4, flow_step_count: 4 },
    });
    await sb.from("task_links").insert({ parent_id: planoId, child_id: entregaId, slot: null, position: 10 });

    // Duas etapas concluídas de quatro -> a entrega vale 50%.
    for (const [key, status] of [["roteiro", "aprovado"], ["captacao", "aprovado"]] as const) {
      stepIds[key] = await insert({
        client_id: clientId, kind: "criativo", subtype: key,
        title: `${entregaTitle} — ${key}`, status, payload: {},
      });
      await sb.from("task_links").insert({ parent_id: entregaId, child_id: stepIds[key], slot: key, position: 10 });
    }

    // A etapa "roteiro" é TAMBÉM membro do plano: o card difícil, com um pai de
    // cada tipo. É ele que perdia a associação com o plano no primeiro autosave.
    await sb.from("task_links").insert({ parent_id: planoId, child_id: stepIds.roteiro, slot: null, position: 20 });

    // Card comum cujo ÚNICO pai é o plano — a forma dos 12 cards de produção
    // que abriam com "Carregando entrega…" para sempre.
    membroSimplesId = await insert({
      client_id: clientId, kind: "operacional", title: `${PREFIX} Membro simples`, status: "aprovado", payload: {},
    });
    await sb.from("task_links").insert({ parent_id: planoId, child_id: membroSimplesId, slot: null, position: 30 });
  });

  test.afterAll(async () => {
    await sb.from("tasks").delete().like("title", `${PREFIX}%`);
  });

  test("card cujo único pai é um Plano não mostra caixa de Entrega", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/kanban?task=${membroSimplesId}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });

    // A caixa "Entrega" era condicionada ao ID do pai, e o código caía no
    // primeiro pai quando nenhum era entrega — então um Plano assumia o papel e
    // a caixa ficava eternamente carregando.
    await expect(modal).not.toContainText("Carregando entrega");
    await expect(modal.locator(".tm-planmembers", { hasText: "Entrega" })).toHaveCount(0);
  });

  test("etapa que também é membro de plano mantém os DOIS vínculos após o autosave", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/kanban?task=${stepIds.roteiro}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });

    // O seletor tem que mostrar o PLANO, não a entrega. Quando ele mostrava o
    // id da entrega, o autosave mandava esse id como `plan_id` e o servidor
    // apagava o elo sem slot — a associação com o plano.
    const planoSelect = modal.locator(".tm-cell", { hasText: "Plano de Ação" }).locator("select");
    if (await planoSelect.count()) {
      await expect(planoSelect).toHaveValue(planoId);
    }

    // Mexe em algo qualquer para disparar o autosave.
    const titulo = modal.locator(".tm-title-input");
    await titulo.fill(`${entregaTitle} — roteiro editado`);
    await expect(modal.getByRole("status")).toHaveText("Salvo", { timeout: 25_000 });

    const { data: links } = await sb
      .from("task_links").select("parent_id,slot").eq("child_id", stepIds.roteiro);
    const porPai = Object.fromEntries((links ?? []).map((l) => [l.parent_id, l.slot]));
    // Os dois continuam lá. Antes do conserto, o do plano sumia.
    expect(porPai[entregaId]).toBe("roteiro");
    expect(porPai).toHaveProperty(planoId);
    expect(porPai[planoId]).toBeNull();
  });

  test("o Plano conta a Entrega como um item, pelo progresso real dela", async ({ page }) => {
    await login(page);
    await page.goto("/admin/plano");
    await page.getByRole("button", { name: "Lista", exact: true }).click();

    const item = page.locator(".plan-acc-item", { hasText: planoTitle });
    await expect(item).toBeVisible({ timeout: 25_000 });

    // Entrega 50% (2 de 4 etapas) + membro simples 100% = 75%.
    //
    // Antes: a Entrega contribuía 0%, porque `listParentCards` buscava só um
    // nível de filhos — as etapas dela nunca eram carregadas, então o rollup
    // dividia zero pelo peso congelado do molde. E a etapa "roteiro", que
    // também é membro do plano, NÃO pode entrar na conta: a peça pesaria duas
    // vezes.
    await expect(item.locator(".plan-acc-progress b")).toHaveText("75%", { timeout: 25_000 });
  });

  test("criar Entrega com plano escolhido liga a ENTREGA, não o primeiro passo", async ({ page }) => {
    await login(page);
    const titulo = `${PREFIX} Entrega criada com plano`;
    const res = await page.request.post("/api/admin/tasks?scope=task", {
      data: { slug: "karpinski", title: titulo, kind: "criativo", plan_id: planoId },
    });
    expect(res.ok()).toBeTruthy();
    const passo = await res.json();

    // A resposta é o PASSO (é o card que a pessoa abre), mas quem entra no
    // plano é a entrega. Antes, o elo ia para o passo e a peça inteira ficava
    // de fora do plano.
    const { data: entregaLinks } = await sb
      .from("task_links").select("parent_id,child_id,slot").eq("child_id", passo.id);
    const paisDoPasso = (entregaLinks ?? []).map((l) => l.parent_id);
    expect(paisDoPasso).not.toContain(planoId);

    const { data: doPlano } = await sb
      .from("task_links").select("child_id,slot").eq("parent_id", planoId).is("slot", null);
    const novosMembros = (doPlano ?? []).map((l) => l.child_id);
    const entregaNova = paisDoPasso[0];
    expect(entregaNova).toBeTruthy();
    expect(novosMembros).toContain(entregaNova);
  });

  test("um Plano não pode virar entrega", async ({ page }) => {
    await login(page);
    const res = await page.request.patch(`/api/admin/tasks/${planoId}`, {
      data: { payload: { flow_parent: true } },
    });
    expect(res.ok()).toBeFalsy();

    const { data: plano } = await sb.from("tasks").select("payload").eq("id", planoId).single();
    expect((plano?.payload as Record<string, unknown> | null)?.flow_parent).toBeUndefined();
  });
});
