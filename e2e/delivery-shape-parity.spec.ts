import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// ESTRATEGIA-FLUXOS.md — P0-B.
//
// Hoje só o POST (`app/api/admin/tasks/route.ts` → `createFlowDelivery`)
// promove um tipo-entrega a corrente de etapas. De dentro de um Plano de
// Ação, `createLinkedActivity` (TaskModal.tsx) cria a atividade com
// `kind: "operacional"` cravado; o usuário então troca o Tipo para Entrega no
// modal aberto → isso vira um PATCH comum, que hoje só troca a coluna `kind` e
// não materializa nada — reproduzindo a linha real de produção
// (`04331233`: kind=criativo, flow_parent=NULL, sem etapa nenhuma).
//
// A correção esperada (item 2 de P0-B): um PATCH que muda `kind` de um tipo
// comum para um tipo `behavior:'entrega'` PROMOVE o card em vez de só trocar
// a coluna — marca `flow_parent`, congela `flow_total_weight`/`flow_step_count`
// e materializa a primeira etapa (mesma forma que `createFlowDelivery`), de
// modo IDEMPOTENTE.
//
// Este spec espera FALHAR até essa promoção existir: hoje o PATCH abaixo
// devolve 200 mas o card fica "pelado" (sem marca de fluxo, sem etapa).

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

test.describe("Entrega nasce igual, criada por dentro do plano ou pelo botão de Entregas (P0-B)", () => {
  test.setTimeout(150_000);
  let sb: SupabaseClient;
  let clientId = "";
  let planoId = "";
  let atividadeId = ""; // vira a entrega promovida, por PATCH, dentro do plano
  let entregaDiretaId = ""; // criada pelo caminho que já funciona (POST scope=task)
  const created: string[] = [];

  async function insert(fields: Record<string, unknown>): Promise<string> {
    const { data, error } = await sb.from("tasks").insert(fields).select("id").single();
    if (error || !data) throw new Error(`seed falhou: ${error?.message}`);
    created.push(data.id as string);
    return data.id as string;
  }

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error } = await sb.from("clients").select("id").eq("slug", "karpinski").single();
    if (error || !client) throw new Error(`cliente karpinski não encontrado: ${error?.message}`);
    clientId = client.id as string;

    planoId = await insert({
      client_id: clientId, kind: "plano_acao", title: `${PREFIX} Plano com atividade promovida`, status: "em_producao", payload: {},
    });

    // A atividade nasce exatamente como `createLinkedActivity` cria hoje:
    // `kind: "operacional"`, sem marca de fluxo nenhuma. O elo com o plano é
    // sem slot, igual ao que a composição dentro do plano grava.
    atividadeId = await insert({
      client_id: clientId, kind: "operacional", title: `${PREFIX} Atividade que devia virar entrega`,
      status: "backlog", priority: "media", payload: {},
    });
    const { error: linkErr } = await sb.from("task_links").insert({ parent_id: planoId, child_id: atividadeId, slot: null, position: 10 });
    if (linkErr) throw new Error(`seed link falhou: ${linkErr.message}`);
  });

  test.afterAll(async () => {
    if (created.length) await sb.from("tasks").delete().in("id", created);
    // Etapas materializadas pela promoção/cascata, se houver.
    await sb.from("tasks").delete().like("title", `${PREFIX}%`);
  });

  test("PATCH que troca o Tipo para Entrega promove o card (marca de fluxo + 1ª etapa), sem duplicar ao repetir", async ({ page }) => {
    await login(page);

    // É exatamente a sequência do bug real: atividade comum, depois o Tipo é
    // trocado para um tipo-entrega (`criativo`) num PATCH comum.
    const res = await page.request.patch(`/api/admin/tasks/${atividadeId}`, {
      data: { kind: "criativo", subtype: null },
    });
    expect(res.ok()).toBeTruthy();
    const promoted = await res.json();

    // As marcas que `createFlowDelivery` grava — congeladas, não recalculadas
    // a cada leitura.
    expect(promoted.payload?.flow_parent).toBe(true);
    expect(typeof promoted.payload?.flow_total_weight).toBe("number");
    expect(promoted.payload?.flow_total_weight).toBeGreaterThan(0);
    expect(promoted.status).toBe("em_producao"); // DELIVERY_INITIAL_STATUS

    const { data: links } = await sb.from("task_links").select("child_id,slot,position").eq("parent_id", atividadeId);
    expect(links).toHaveLength(1);
    expect(links?.[0]?.slot).toBeTruthy();

    // O elo com o PLANO continua — ele apontava para este id desde o início, e
    // a promoção é in-place (não troca o id do card).
    const { data: planoLinks } = await sb.from("task_links").select("child_id").eq("parent_id", planoId).is("slot", null);
    expect((planoLinks ?? []).map((l) => l.child_id)).toContain(atividadeId);

    // Promover de novo (usuário reabre o modal e salva sem mudar nada, ou
    // clica duas vezes) não pode duplicar a etapa — precedente:
    // lib/automations/execute.ts:94.
    const second = await page.request.patch(`/api/admin/tasks/${atividadeId}`, {
      data: { kind: "criativo", subtype: null },
    });
    expect(second.ok()).toBeTruthy();
    const { data: linksAfterSecond } = await sb.from("task_links").select("id").eq("parent_id", atividadeId);
    expect(linksAfterSecond).toHaveLength(1);
  });

  test("a mesma forma nasce pelo botão de Entregas (POST scope=task)", async ({ page }) => {
    await login(page);
    const res = await page.request.post("/api/admin/tasks?scope=task", {
      data: { slug: "karpinski", title: `${PREFIX} Entrega pelo botão`, kind: "criativo", subtype: null, status: "backlog", priority: "media" },
    });
    expect(res.ok()).toBeTruthy();
    const step = await res.json();
    created.push(step.id);
    entregaDiretaId = (step.parents ?? []).find((p: { id: string }) => p.id)?.id;
    expect(entregaDiretaId).toBeTruthy();
    created.push(entregaDiretaId);

    const { data: entrega } = await sb.from("tasks").select("payload,status").eq("id", entregaDiretaId).single();
    expect(entrega?.payload?.flow_parent).toBe(true);
    expect(entrega?.status).toBe("em_producao");
  });

  test("as duas entregas mostram a mesma caixa de Etapas no modal (mesma fração, mesmo peso congelado)", async ({ page }) => {
    test.skip(!entregaDiretaId, "depende do teste anterior ter criado a entrega direta");
    await login(page);

    // Card promovido de dentro do plano.
    await page.goto(`/admin/kanban?task=${atividadeId}`);
    const modalPromovida = page.locator(".tm");
    await expect(modalPromovida).toBeVisible({ timeout: 20_000 });
    const stepsBoxPromovida = modalPromovida.locator(".tm-box.tm-planmembers", { hasText: "Etapas" });
    await expect(stepsBoxPromovida).toBeVisible({ timeout: 20_000 });
    const labelPromovida = await stepsBoxPromovida.locator(".tm-box-label").innerText();

    // Card criado direto como entrega.
    await page.goto(`/admin/kanban?task=${entregaDiretaId}`);
    const modalDireta = page.locator(".tm");
    await expect(modalDireta).toBeVisible({ timeout: 20_000 });
    const stepsBoxDireta = modalDireta.locator(".tm-box.tm-planmembers", { hasText: "Etapas" });
    await expect(stepsBoxDireta).toBeVisible({ timeout: 20_000 });
    const labelDireta = await stepsBoxDireta.locator(".tm-box-label").innerText();

    // "Etapas · <Tipo> (1/N)" — igual nos dois, porque as duas são a mesma
    // Entrega em produção, só com origem de criação diferente.
    expect(labelPromovida).toBe(labelDireta);
  });
});
