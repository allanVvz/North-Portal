import { expect, test, type Locator, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// O botão de corrente, pela INTERFACE.
//
// Existe porque toda a verificação anterior desta feature foi por backend (SQL
// + endpoint da cron), e foi exatamente por isso que dois bugs de tela
// passaram: o seletor sem CSS nenhum, e o clique que ligava no banco mas não
// aparecia na tela — o que fazia a pessoa clicar de novo e criar um segundo elo
// no mesmo slot. Este teste dirige o navegador de verdade.

const RUN = Date.now();
const PREFIX = `[e2e ${RUN}]`;

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

async function insertTask(sb: SupabaseClient, fields: Record<string, unknown>): Promise<string> {
  const { data, error } = await sb.from("tasks").insert(fields).select("id").single();
  if (error || !data) throw new Error(`seed task failed: ${error?.message}`);
  return data.id as string;
}

// As duas queixas da rodada seguinte, viradas em asserção.
//
// "Transparente": o portal ia para o `document.body`, e os tokens do tema
// (`--a-surface`, `--a-border`, a fonte) são declarados no `.admin-shell`. Fora
// desse escopo `var(--a-surface)` não resolve, `background` cai para o valor
// inicial e o painel fica vazado, com o conteúdo do modal aparecendo por trás.
//
// "Alinhado à esquerda": o painel abria alinhado pela DIREITA a um botão de
// ~20px encostado na borda esquerda da linha, então seus 320px iam todos para
// fora do modal e paravam colados no canto da tela.
async function expectPanelIsThemedAndInsideModal(panel: Locator, modal: Locator) {
  const background = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  expect(background).not.toBe("transparent");

  const panelBox = await panel.boundingBox();
  const modalBox = await modal.boundingBox();
  if (!panelBox || !modalBox) throw new Error("painel ou modal sem caixa medível");
  // 1px de folga para arredondamento de subpixel do zoom.
  expect(panelBox.x).toBeGreaterThanOrEqual(modalBox.x - 1);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(modalBox.x + modalBox.width + 1);
}

test.describe("Corrente de etapas — ligar um card pela interface", () => {
  // Rede de produção: esta suíte já observou latências bem além do default.
  test.setTimeout(90_000);
  let sb: SupabaseClient;
  let clientId = "";
  let deliveryId = "";
  let sharedDeliveryId = "";
  let roteiroId = "";
  let captacaoA = "";
  let captacaoB = "";
  let captacaoWorkflowStepId = "";

  const deliveryTitle = `${PREFIX} Entrega corrente`;
  const sharedDeliveryTitle = `${PREFIX} Outra entrega compartilhada`;

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error } = await sb.from("clients").select("id").eq("slug", "karpinski").single();
    if (error || !client) throw new Error(`cliente karpinski não encontrado: ${error?.message}`);
    clientId = client.id as string;

    // O catálogo é a fonte de classificação desde a migration de workflows:
    // não semear `kind`/`subtype` legados, que o trigger agora recusa sem o FK.
    const { data: types, error: typesError } = await sb
      .from("task_types")
      .select("id,key")
      .in("key", ["criativo", "captacao"]);
    if (typesError || !types) throw new Error(`tipos do fixture não encontrados: ${typesError?.message}`);
    const creativeType = types.find((type) => type.key === "criativo");
    const captacaoType = types.find((type) => type.key === "captacao");
    if (!creativeType || !captacaoType) throw new Error("fixture exige os tipos Criativo e Captação.");

    const { data: workflow, error: workflowError } = await sb
      .from("workflow_versions")
      .select("id")
      .eq("delivery_type_id", creativeType.id)
      .eq("status", "published")
      .single();
    if (workflowError || !workflow) throw new Error(`workflow Criativo publicado não encontrado: ${workflowError?.message}`);

    const { data: workflowSteps, error: stepsError } = await sb
      .from("workflow_version_steps")
      .select("id,step_key")
      .eq("workflow_version_id", workflow.id);
    if (stepsError || !workflowSteps) throw new Error(`etapas do workflow não encontradas: ${stepsError?.message}`);
    captacaoWorkflowStepId = workflowSteps.find((step) => step.step_key === "captacao")?.id ?? "";
    if (!captacaoWorkflowStepId) throw new Error("workflow Criativo não possui a etapa Captação.");

    // Criar a Entrega materializa o primeiro passo pelo trigger de produção.
    // Assim o fixture respeita a constraint de que uma Entrega versionada não
    // pode existir sem o primeiro elo do workflow.
    deliveryId = await insertTask(sb, {
      client_id: clientId, task_type_id: creativeType.id, workflow_version_id: workflow.id,
      title: deliveryTitle, status: "backlog", payload: {},
    });
    sharedDeliveryId = await insertTask(sb, {
      client_id: clientId, task_type_id: creativeType.id, workflow_version_id: workflow.id,
      title: sharedDeliveryTitle, status: "backlog", payload: {},
    });

    const { data: firstLink, error: firstLinkError } = await sb
      .from("task_links")
      .select("child_id,workflow_step_id")
      .eq("parent_id", deliveryId)
      .eq("relation_kind", "workflow_step")
      .single();
    if (firstLinkError || !firstLink?.workflow_step_id) throw new Error(`primeira etapa não foi materializada: ${firstLinkError?.message}`);
    roteiroId = firstLink.child_id as string;

    // A segunda Entrega nasce com um Roteiro próprio. Substituímos apenas esse
    // elo pelo mesmo Roteiro da primeira, formando o caso N:N real que o modal
    // precisa apresentar como dois pais, sem uma lista de irmãos.
    const { error: shareLinkError } = await sb
      .from("task_links")
      .update({ child_id: roteiroId })
      .eq("parent_id", sharedDeliveryId)
      .eq("workflow_step_id", firstLink.workflow_step_id);
    if (shareLinkError) throw new Error(`não foi possível compartilhar Roteiro: ${shareLinkError.message}`);

    captacaoA = await insertTask(sb, {
      client_id: clientId, task_type_id: captacaoType.id,
      title: `${PREFIX} Captação A`, status: "backlog", position: 20, payload: {},
    });
    captacaoB = await insertTask(sb, {
      client_id: clientId, task_type_id: captacaoType.id,
      title: `${PREFIX} Captação B`, status: "backlog", position: 20, payload: {},
    });
  });

  test.afterAll(async () => {
    const ids = [deliveryId, sharedDeliveryId, roteiroId, captacaoA, captacaoB].filter(Boolean);
    if (ids.length) await sb.from("tasks").delete().in("id", ids);
    // Etapas criadas pela cascata durante o teste, se houver.
    await sb.from("tasks").delete().like("title", `${PREFIX}%`);
  });

  test("liga um card à etapa, reflete na hora e recusa um segundo no mesmo slot", async ({ page }) => {
    await login(page);

    // Abrir a entrega direto pelo card: é o caminho que o usuário faz quando
    // chega pelo quadro, e o que expôs o bug do popover clipado.
    await page.goto(`/admin/kanban?task=${deliveryId}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });

    const stepsBox = modal.locator(".tm-planmembers", { hasText: "Etapas" });
    await expect(stepsBox).toBeVisible({ timeout: 20_000 });
    // 1 de 4: só o Roteiro está ligado.
    await expect(stepsBox.locator(".tm-box-label")).toContainText("(1/4)", { timeout: 20_000 });

    // O 🔗 da Captação abre o seletor FLUTUANTE — ele sai do `.tm` por portal e
    // se pendura direto no `.admin-shell`. Se voltar a ser um painel dentro do
    // `.tm`, este locator falha, que é a regressão que queremos pegar. E tem
    // que ser o `.admin-shell`, não o body: é lá que moram os tokens do tema.
    await stepsBox.getByRole("button", { name: /Ligar um card existente à etapa Captação/ }).click();
    const panel = page.locator(".admin-shell > .tm-chain-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText(`${PREFIX} Captação A`);
    await expectPanelIsThemedAndInsideModal(panel, modal);

    // Um clique liga. Sem recarregar a página, a etapa tem que sair de vazia
    // para preenchida — era exatamente isto que não acontecia.
    await panel.getByRole("button", { name: /Captação A/ }).click();
    await expect(panel).toHaveCount(0, { timeout: 15_000 });
    await expect(stepsBox.locator(".tm-box-label")).toContainText("(2/4)", { timeout: 20_000 });
    await expect(
      stepsBox.getByRole("button", { name: /Ligar um card existente à etapa Captação/ }),
    ).toHaveCount(0);

    // E o elo existe de verdade no banco, com o slot certo.
    const { data: links } = await sb
      .from("task_links")
      .select("child_id,slot")
      .eq("parent_id", deliveryId)
      .eq("slot", "captacao");
    expect(links).toHaveLength(1);
    expect(links?.[0]?.child_id).toBe(captacaoA);

    // O servidor recusa um segundo card no mesmo slot, mesmo que alguém chame a
    // rota direto com a tela desatualizada. Foi assim que a entrega
    // "criativo fluxo" acabou com dois cards no slot de edição em produção.
    const second = await page.request.post(`/api/admin/tasks/${deliveryId}/relations`, {
      data: { child_id: captacaoB, workflow_step_id: captacaoWorkflowStepId, relation_kind: "workflow_step" },
    });
    expect(second.status()).toBe(409);
    const { data: afterLinks } = await sb
      .from("task_links")
      .select("child_id")
      .eq("parent_id", deliveryId)
      .eq("slot", "captacao");
    expect(afterLinks).toHaveLength(1);
  });

  test("uma ETAPA mostra apenas a Entrega-pai, sem a corrente ou controles dos irmãos", async ({ page }) => {
    await login(page);

    await page.goto(`/admin/kanban?task=${roteiroId}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });

    // Uma etapa compartilhada preserva TODAS as relações ascendentes, sem
    // inventar uma corrente principal nem revelar os irmãos de nenhuma delas.
    const parentBoxes = modal.locator(".tm-box.tm-parentbox", { hasText: "Faz parte de" });
    await expect(parentBoxes).toHaveCount(2, { timeout: 20_000 });
    await expect(parentBoxes.filter({ hasText: deliveryTitle })).toBeVisible();
    await expect(parentBoxes.filter({ hasText: sharedDeliveryTitle })).toBeVisible();

    // A etapa não enxerga nem controla irmãos pela caixa exclusiva da Entrega.
    const stepsBox = modal.locator(".tm-planmembers", { hasText: "Etapas" });
    await expect(stepsBox).toHaveCount(0);
    await expect(modal.getByRole("button", { name: /Ligar um card existente à etapa/ })).toHaveCount(0);
    await expect(modal.getByText("Próxima etapa criada", { exact: true })).toHaveCount(0);
  });
});
