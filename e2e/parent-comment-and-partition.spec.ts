import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// ESTRATEGIA-FLUXOS.md — P1-D e P1-D3.
//
// P1-D: comentar no card PAI (a entrega) tem que gravar o comentário na
// ETAPA em que o fluxo está agora — não no payload da própria entrega. A
// leitura já mostra tudo junto (mergeFamilyComments, lib/comments.ts), então
// esta prova é sobre ONDE o comentário é gravado, e só dá para ver isso
// olhando o banco. "Etapa corrente" = a de menor `position` no elo que ainda
// não está `completed_at`; se todas concluídas, a última.
//
// P1-D3: uma Entrega que É TAMBÉM membro de um Plano de Ação (elo sem slot
// direto na entrega, não na etapa) só mostra UMA das duas caixas — nunca as
// duas juntas. Causa: `planParentId`/`planParent` em TaskModal.tsx são
// computados com uma guarda `!isDelivery`, então uma entrega nunca chega a
// pedir o próprio Plano. `parentBoxes` (a lista que alimenta `CardParentBox`)
// tem a mesma guarda. O pedido é: as duas caixas aparecem, particionadas —
// o Plano em cima, as Etapas abaixo.
//
// Os dois specs abaixo esperam FALHAR até essas correções existirem.

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
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

test.describe("Comentário no pai grava na etapa corrente (P1-D)", () => {
  test.setTimeout(120_000);
  let sb: SupabaseClient;
  let clientId = "";
  let deliveryId = "";
  let roteiroId = ""; // concluído — não é a etapa corrente
  let captacaoId = ""; // em produção — É a etapa corrente

  const deliveryTitle = `${PREFIX} Entrega com comentário no pai`;
  const commentText = `Comentário feito no pai — ${RUN}`;

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

    deliveryId = await insert({
      client_id: clientId, kind: "criativo", subtype: null, title: deliveryTitle,
      status: "em_producao", payload: { flow_parent: true, flow_total_weight: 4, flow_step_count: 4 },
    });
    // Roteiro já aprovado (completed_at carimbado pelo trigger) — não é mais
    // a etapa corrente, e um comentário no pai não pode cair nele.
    roteiroId = await insert({
      client_id: clientId, kind: "criativo", subtype: "roteiro",
      title: `${deliveryTitle} — Roteiro`, status: "aprovado", position: 10, payload: {},
    });
    // Captação em produção — a de menor posição AINDA não concluída: é ela a
    // etapa corrente.
    captacaoId = await insert({
      client_id: clientId, kind: "criativo", subtype: "captacao",
      title: `${deliveryTitle} — Captação`, status: "em_producao", position: 20, payload: {},
    });
    const { error: linkErr } = await sb.from("task_links").insert([
      { parent_id: deliveryId, child_id: roteiroId, slot: "roteiro", position: 10 },
      { parent_id: deliveryId, child_id: captacaoId, slot: "captacao", position: 20 },
    ]);
    if (linkErr) throw new Error(`seed link falhou: ${linkErr.message}`);
  });

  test.afterAll(async () => {
    const ids = [deliveryId, roteiroId, captacaoId].filter(Boolean);
    if (ids.length) await sb.from("tasks").delete().in("id", ids);
  });

  test("comentar na ENTREGA grava o texto no payload da CAPTAÇÃO (etapa corrente), não no da entrega nem no do roteiro", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/kanban?task=${deliveryId}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });

    await modal.getByPlaceholder("Escrever comentário…").fill(commentText);
    await modal.getByRole("button", { name: "Enviar" }).click();

    // A LEITURA já mescla tudo (mergeFamilyComments) — isto continua
    // aparecendo no pai independente de onde foi gravado, então não prova
    // nada sobre a correção. A prova real é a query abaixo.
    await expect(modal.locator(".tm-comment", { hasText: commentText })).toBeVisible({ timeout: 15_000 });

    const [{ data: delivery }, { data: roteiro }, { data: captacao }] = await Promise.all([
      sb.from("tasks").select("payload").eq("id", deliveryId).single(),
      sb.from("tasks").select("payload").eq("id", roteiroId).single(),
      sb.from("tasks").select("payload").eq("id", captacaoId).single(),
    ]);
    const commentsOf = (row: { payload: unknown } | null | undefined) =>
      ((row?.payload as { comments?: { text: string }[] } | null)?.comments ?? []).map((c) => c.text);

    expect(commentsOf(captacao)).toContain(commentText);
    expect(commentsOf(delivery)).not.toContain(commentText);
    expect(commentsOf(roteiro)).not.toContain(commentText);
  });
});

test.describe("A caixa de família particiona Plano + Etapas quando a entrega é membro de um plano (P1-D3)", () => {
  test.setTimeout(120_000);
  let sb: SupabaseClient;
  let clientId = "";
  let planoId = "";
  let deliveryId = "";
  let roteiroId = "";

  const planoTitle = `${PREFIX} Plano com entrega-membro`;
  const deliveryTitle = `${PREFIX} Entrega membro do plano`;

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

    planoId = await insert({ client_id: clientId, kind: "plano_acao", title: planoTitle, status: "em_producao", payload: {} });
    deliveryId = await insert({
      client_id: clientId, kind: "criativo", subtype: null, title: deliveryTitle,
      status: "em_producao", payload: { flow_parent: true, flow_total_weight: 4, flow_step_count: 4 },
    });
    roteiroId = await insert({
      client_id: clientId, kind: "criativo", subtype: "roteiro",
      title: `${deliveryTitle} — Roteiro`, status: "backlog", position: 10, payload: {},
    });
    const { error: linkErr } = await sb.from("task_links").insert([
      // A entrega É membro do plano (elo sem slot na própria entrega — igual
      // ao que `route.ts:153` grava quando a Entrega nasce com `plan_id`).
      { parent_id: planoId, child_id: deliveryId, slot: null, position: 10 },
      { parent_id: deliveryId, child_id: roteiroId, slot: "roteiro", position: 10 },
    ]);
    if (linkErr) throw new Error(`seed link falhou: ${linkErr.message}`);
  });

  test.afterAll(async () => {
    const ids = [planoId, deliveryId, roteiroId].filter(Boolean);
    if (ids.length) await sb.from("tasks").delete().in("id", ids);
  });

  test("abrir a entrega mostra 'Faz parte de: Plano' EM CIMA e 'Etapas' ABAIXO, as duas ao mesmo tempo", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/kanban?task=${deliveryId}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });

    const planBox = modal.locator(".tm-box.tm-parentbox", { hasText: "Faz parte de" });
    const stepsBox = modal.locator(".tm-box.tm-planmembers", { hasText: "Etapas" });

    // Hoje só a segunda aparece: `planParentId` é computado com `!isDelivery`,
    // então uma entrega nunca pede o próprio Plano — a caixa "Faz parte de"
    // simplesmente não existe para ela.
    await expect(planBox).toBeVisible({ timeout: 20_000 });
    await expect(planBox).toContainText(planoTitle);
    await expect(stepsBox).toBeVisible({ timeout: 20_000 });

    // "Particionados": o Plano vem antes das Etapas no documento — não é só
    // as duas existirem em algum lugar da tela.
    const boxes = modal.locator(".tm-box.tm-parentbox, .tm-box.tm-planmembers");
    const order = await boxes.evaluateAll((els) => els.map((el) => (el.className.includes("tm-parentbox") ? "plano" : "etapas")));
    const planIndex = order.indexOf("plano");
    const stepsIndex = order.indexOf("etapas");
    expect(planIndex).toBeGreaterThanOrEqual(0);
    expect(stepsIndex).toBeGreaterThanOrEqual(0);
    expect(planIndex).toBeLessThan(stepsIndex);
  });
});
