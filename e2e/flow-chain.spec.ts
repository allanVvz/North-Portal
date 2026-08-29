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
  let roteiroId = "";
  let captacaoA = "";
  let captacaoB = "";

  const deliveryTitle = `${PREFIX} Entrega corrente`;

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error } = await sb.from("clients").select("id").eq("slug", "karpinski").single();
    if (error || !client) throw new Error(`cliente karpinski não encontrado: ${error?.message}`);
    clientId = client.id as string;

    // Uma entrega com o Roteiro ocupado e a Captação vaga, mais DOIS cards de
    // captação soltos — o segundo serve para provar que o slot não aceita dois.
    deliveryId = await insertTask(sb, {
      client_id: clientId, kind: "criativo", subtype: null, title: deliveryTitle,
      status: "em_producao", payload: { flow_parent: true, flow_total_weight: 4, flow_step_count: 4 },
    });
    roteiroId = await insertTask(sb, {
      client_id: clientId, kind: "criativo", subtype: "roteiro",
      title: `${deliveryTitle} — Roteiro`, status: "backlog", position: 10,
    });
    captacaoA = await insertTask(sb, {
      client_id: clientId, kind: "criativo", subtype: "captacao",
      title: `${PREFIX} Captação A`, status: "backlog", position: 20,
    });
    captacaoB = await insertTask(sb, {
      client_id: clientId, kind: "criativo", subtype: "captacao",
      title: `${PREFIX} Captação B`, status: "backlog", position: 20,
    });
    const { error: linkErr } = await sb
      .from("task_links")
      .insert({ parent_id: deliveryId, child_id: roteiroId, slot: "roteiro", position: 10 });
    if (linkErr) throw new Error(`seed link failed: ${linkErr.message}`);
  });

  test.afterAll(async () => {
    const ids = [deliveryId, roteiroId, captacaoA, captacaoB].filter(Boolean);
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
      data: { child_id: captacaoB, slot: "captacao" },
    });
    expect(second.status()).toBe(409);
    const { data: afterLinks } = await sb
      .from("task_links")
      .select("child_id")
      .eq("parent_id", deliveryId)
      .eq("slot", "captacao");
    expect(afterLinks).toHaveLength(1);
  });

  test("o mesmo seletor funciona a partir do card de uma ETAPA", async ({ page }) => {
    await login(page);

    // O usuário foi procurar o 🔗 aqui — no card que aparece no quadro — e não
    // achava, porque a caixa só existia na entrega.
    await page.goto(`/admin/kanban?task=${roteiroId}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });

    // A caixa "Entrega" continua, como link para o pai...
    await expect(modal.locator(".tm-planmembers", { hasText: "Entrega" })).toBeVisible({ timeout: 20_000 });
    // ...e a corrente inteira também aparece, com a etapa atual marcada.
    const stepsBox = modal.locator(".tm-planmembers", { hasText: "Etapas" });
    await expect(stepsBox).toBeVisible({ timeout: 20_000 });
    await expect(stepsBox).toContainText("você está aqui");

    await stepsBox.getByRole("button", { name: /Ligar um card existente à etapa Edição/ }).click();
    const panel = page.locator(".admin-shell > .tm-chain-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expectPanelIsThemedAndInsideModal(panel, modal);
    // Não há card de Edição neste cliente: o seletor explica em vez de parecer
    // quebrado, e lembra que a etapa nasce pela cascata.
    await expect(panel).toContainText(/nasce sozinha quando a anterior é concluída/i);
  });
});
