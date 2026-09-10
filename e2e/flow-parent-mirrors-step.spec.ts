import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// ESTRATEGIA-FLUXOS.md — P1-C.
//
// Decisão do usuário: o status EXIBIDO da entrega deixa de ser um campo
// próprio (hoje congelado em `DELIVERY_INITIAL_STATUS = "em_producao"` até a
// ÚLTIMA etapa fechar — ver `lib/flows/parentStatus.ts` e `settleDelivery` em
// `lib/flows/advance.ts`) e passa a ESPELHAR a etapa corrente: roteiro em
// produção → pai em produção; roteiro em revisão → pai em revisão; roteiro
// concluído e captação em Entrada → pai em Entrada. O status espelhado PODE
// retroceder (é o próprio exemplo do usuário); o que não pode é a barra de
// progresso, porque ela soma casas acumuladas do fluxo inteiro.
//
// A regra em si é lib/flows + lib/taskCatalog.ts (fora do escopo deste
// agente — dono de e2e/). Este spec fica no nível de integração: percorre um
// fluxo de 4 etapas pela INTERFACE de verdade e prova as duas propriedades
// observáveis, sem fixar a fórmula exata de porcentagem (não é o papel do
// e2e travar a matemática — isso é dos testes unitários de quem implementa).
//
// Esperado FALHAR hoje: o rótulo do stepper no card da entrega fica preso em
// "Em produção" (o valor congelado na criação) independente do que a etapa
// realmente está fazendo — só por coincidência bate quando a etapa também
// está "Em produção".

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

/** Lê o rótulo do passo marcado "current" no header da entrega e o
 *  percentual da barra — os dois pontos observáveis pela pessoa que abre o
 *  card, não implementação. */
async function readDeliveryHeader(page: Page, deliveryId: string): Promise<{ label: string; pct: number }> {
  await page.goto(`/admin/kanban?task=${deliveryId}`);
  const modal = page.locator(".tm");
  await expect(modal).toBeVisible({ timeout: 20_000 });
  const label = (await modal.locator(".tm-step.current .tm-step-label").innerText()).trim();
  const pctText = (await modal.locator(".tm-head-progress b").innerText()).trim();
  const pct = Number(pctText.replace("%", ""));
  expect(Number.isNaN(pct)).toBe(false);
  return { label, pct };
}

/** Move um card pelo stepper de verdade (mesmo clique que um humano dá) e
 *  espera o autosave, para o PATCH (e a cascata que ele dispara) já ter
 *  acontecido antes da próxima leitura. */
async function moveStepTo(page: Page, taskId: string, columnLabel: string): Promise<void> {
  await page.goto(`/admin/kanban?task=${taskId}`);
  const modal = page.locator(".tm");
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await modal.getByRole("button", { name: columnLabel, exact: true }).click();
  await expect(modal.getByRole("status")).toHaveText("Salvo", { timeout: 20_000 });
}

test.describe("O status da entrega espelha a etapa corrente, e o progresso nunca recua (P1-C)", () => {
  test.setTimeout(180_000);
  let sb: SupabaseClient;
  let clientId = "";
  let deliveryId = "";
  let roteiroId = "";

  const deliveryTitle = `${PREFIX} Entrega espelhada`;

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
    roteiroId = await insert({
      client_id: clientId, kind: "criativo", subtype: "roteiro",
      title: `${deliveryTitle} — Roteiro`, status: "backlog", position: 10,
    });
    const { error: linkErr } = await sb.from("task_links").insert({ parent_id: deliveryId, child_id: roteiroId, slot: "roteiro", position: 10 });
    if (linkErr) throw new Error(`seed link falhou: ${linkErr.message}`);
  });

  test.afterAll(async () => {
    const ids = [deliveryId, roteiroId].filter(Boolean);
    if (ids.length) await sb.from("tasks").delete().in("id", ids);
    // A "— Captação" que a cascata materializa ao concluir o roteiro.
    await sb.from("tasks").delete().like("title", `${deliveryTitle}%`);
  });

  test("roteiro percorre a corrente inteira; o pai acompanha e o progresso não recua", async ({ page }) => {
    await login(page);

    const readings: { step: string; label: string; pct: number }[] = [];
    async function checkpoint(step: string, expectedLabel: string) {
      const { label, pct } = await readDeliveryHeader(page, deliveryId);
      readings.push({ step, label, pct });
      // Cada checagem individual aparece no relatório com o nome do passo —
      // mais fácil de ler que um "expected X received Y" solto.
      expect(label, `status do pai em "${step}"`).toBe(expectedLabel);
    }

    // 0) Recém-criada: roteiro ainda em Entrada. A entrega nasce direto em
    //    "em_producao" (DELIVERY_INITIAL_STATUS) — aqui é onde o congelamento
    //    mais destoa do espelhamento pedido.
    await checkpoint("roteiro em Entrada", "Entrada");

    await moveStepTo(page, roteiroId, "Em produção");
    await checkpoint("roteiro em Em produção", "Em produção");

    await moveStepTo(page, roteiroId, "Revisão");
    await checkpoint("roteiro em Revisão", "Revisão");

    await moveStepTo(page, roteiroId, "Aprovação");
    await checkpoint("roteiro em Aprovação", "Aprovação");

    // Fecha o roteiro — a cascata materializa a Captação (nasce em Entrada).
    await moveStepTo(page, roteiroId, "Concluído");
    await checkpoint("roteiro Concluído, captação recém-nascida em Entrada", "Entrada");

    const { data: captacaoRow, error: captacaoError } = await sb
      .from("tasks").select("id").eq("client_id", clientId).eq("subtype", "captacao")
      .like("title", `${deliveryTitle}%`).single();
    if (captacaoError || !captacaoRow) throw new Error(`captação não foi materializada: ${captacaoError?.message}`);
    const captacaoId = captacaoRow.id as string;

    await moveStepTo(page, captacaoId, "Em produção");
    await checkpoint("captação em Em produção", "Em produção");

    await moveStepTo(page, captacaoId, "Revisão");
    await checkpoint("captação em Revisão", "Revisão");

    // A propriedade dura: o progresso nunca é menor que o da leitura anterior,
    // mesmo quando o STATUS do pai retrocede (a virada roteiro→captação vai
    // de "Aprovação" para "Entrada", e mesmo assim o progresso tem que subir
    // ou empatar, nunca cair).
    for (let i = 1; i < readings.length; i++) {
      expect(
        readings[i].pct,
        `progresso caiu de ${readings[i - 1].pct}% (${readings[i - 1].step}) para ${readings[i].pct}% (${readings[i].step})`,
      ).toBeGreaterThanOrEqual(readings[i - 1].pct);
    }
  });
});
