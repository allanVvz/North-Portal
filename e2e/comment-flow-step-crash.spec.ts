import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// ESTRATEGIA-FLUXOS.md — P0-A.
//
// Hoje `append_task_comment` devolve `select t.*` (só colunas de `tasks`), e
// `appendTaskComment` (lib/supabase.ts) repassa essa linha crua pro cliente
// sem re-hidratar. `parents` não é coluna — é derivado de `task_links` por
// `mergeTaskAssigneeRow` — então o card que volta da rota de comentário chega
// SEM `parents`. `TaskModal.tsx` funde essa resposta no estado (`setLiveTask` /
// `onTaskPatched`), e dali em diante `t.parents.some(...)` /
// `t.parents.length` (sem guarda) estouram `TypeError: Cannot read properties
// of undefined`, e a caixa "Faz parte de" (lida via `parents ?? []` em
// `deliveryParentIdsOf`/`planParentIdOf`) some mesmo quando o elo continua
// intacto no banco.
//
// Esperado FALHAR até `appendTaskComment`/`editTaskComment`/`deleteTaskComment`
// passarem a re-hidratar via `getTaskById` (ou até os dois sites de
// `TaskModal.tsx` ganharem guarda) — ver Correção 1/3 do item P0-A.

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

test.describe("Comentar numa etapa de fluxo não pode derrubar a árvore (P0-A)", () => {
  test.setTimeout(120_000);
  let sb: SupabaseClient;
  let clientId = "";
  let deliveryId = "";
  let roteiroId = "";

  const deliveryTitle = `${PREFIX} Entrega para comentário`;

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
      title: `${deliveryTitle} — Roteiro`, status: "em_producao", position: 10,
    });
    const { error: linkErr } = await sb
      .from("task_links")
      .insert({ parent_id: deliveryId, child_id: roteiroId, slot: "roteiro", position: 10 });
    if (linkErr) throw new Error(`seed link falhou: ${linkErr.message}`);
  });

  test.afterAll(async () => {
    const ids = [deliveryId, roteiroId].filter(Boolean);
    if (ids.length) await sb.from("tasks").delete().in("id", ids);
  });

  test("comentar na etapa não gera exceção, a caixa 'Faz parte de' sobrevive e o vínculo persiste após reload", async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

    await login(page);
    await page.goto(`/admin/kanban?task=${roteiroId}`);
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible({ timeout: 20_000 });

    // Antes de comentar, a caixa já está lá — é o "antes" contra o qual
    // comparamos depois do comentário.
    const parentBox = modal.locator(".tm-box.tm-parentbox", { hasText: "Faz parte de" });
    await expect(parentBox).toBeVisible({ timeout: 20_000 });
    await expect(parentBox).toContainText(deliveryTitle);

    await modal.getByPlaceholder("Escrever comentário…").fill("Comentário que não pode quebrar a tela.");
    await modal.getByRole("button", { name: "Enviar" }).click();

    // O sintoma relatado era tela branca com "Application error: a
    // client-side exception has occurred" — se a árvore React caiu, nem o
    // modal nem a caixa continuam no DOM.
    await expect(modal.locator(".tm-comment", { hasText: "Comentário que não pode quebrar a tela." })).toBeVisible({ timeout: 15_000 });
    await expect(modal).toBeVisible();
    await expect(parentBox).toBeVisible();
    await expect(parentBox).toContainText(deliveryTitle);

    expect(pageErrors, "erros JavaScript na página após comentar").toEqual([]);
    expect(consoleErrors, "console.error após comentar").toEqual([]);

    // O elo em si nunca foi tocado — confirma que o problema era a resposta
    // sem `parents`, não o dado.
    const { data: links } = await sb.from("task_links").select("id").eq("parent_id", deliveryId).eq("child_id", roteiroId);
    expect(links).toHaveLength(1);

    // Reabrir (reload da mesma URL, igual a um F5 de verdade) tem que mostrar
    // a mesma caixa — não é só o estado em memória que sobrevive.
    await page.reload();
    const modalAfterReload = page.locator(".tm");
    await expect(modalAfterReload).toBeVisible({ timeout: 20_000 });
    const parentBoxAfterReload = modalAfterReload.locator(".tm-box.tm-parentbox", { hasText: "Faz parte de" });
    await expect(parentBoxAfterReload).toBeVisible({ timeout: 20_000 });
    await expect(parentBoxAfterReload).toContainText(deliveryTitle);
  });
});
