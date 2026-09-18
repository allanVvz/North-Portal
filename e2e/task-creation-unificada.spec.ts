import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// R0.1 — a criação de tarefa foi unificada num botão só ("+ Nova tarefa"),
// idêntico em toda tela; o que nasce é decidido pelo TIPO escolhido no modal.
//
// O backend (`POST /api/admin/tasks?scope=`) sempre foi a porta única; a novidade
// é a separação de responsabilidades: escolher Entrega cria a corrente;
// escolher uma Tarefa com subtipo cria só aquele card, solto.

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

test.describe("Criação de tarefa unificada", () => {
  test.setTimeout(120_000);
  let sb: SupabaseClient;
  const created: string[] = [];

  test.beforeAll(async () => {
    sb = serviceClient();
  });

  test.afterAll(async () => {
    if (created.length) await sb.from("tasks").delete().in("id", created);
    // Etapas materializadas pela cascata e o pai de qualquer recorrência.
    await sb.from("tasks").delete().like("title", `${PREFIX}%`);
  });

  test("o botão de criação abre o mesmo modal, com a lista de tipos completa", async ({ page }) => {
    await login(page);
    await page.goto("/admin/home", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Nova tarefa/ }).click();
    const modal = page.locator(".tm").first();
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // O dropdown de tipo lista tudo que se pode criar — inclusive a porta
    // sintética Rotina e um tipo-entrega —, sem nenhuma tela pré-restringir.
    await modal.locator(".tm-new-kind").first().click();
    await expect(page.getByRole("button", { name: /Rotina/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".tm-headpick-hint", { hasText: /corrente de etapas/ })).toBeVisible();
  });

  test("scope=task com tipo-entrega monta a corrente inteira", async ({ page }) => {
    await login(page);
    const res = await page.request.post("/api/admin/tasks?scope=task", {
      data: { title: `${PREFIX} Entrega completa`, kind: "criativo", subtype: null, status: "backlog", priority: "media" },
    });
    expect(res.ok()).toBeTruthy();
    const step = await res.json();
    created.push(step.id);

    // A resposta é a primeira ETAPA; o pai é uma Entrega ligada ao passo persistido.
    const parentId = (step.parents ?? []).find((p: { id: string }) => p.id)?.id;
    expect(parentId).toBeTruthy();
    created.push(parentId);
    const { data: parent } = await sb.from("tasks").select("workflow_version_id,kind").eq("id", parentId).single();
    expect(parent?.workflow_version_id).toBeTruthy();
    const { data: links } = await sb.from("task_links").select("workflow_step_id").eq("parent_id", parentId);
    expect((links ?? []).some((l) => l.workflow_step_id)).toBeTruthy();
  });

  test("Tarefa com subtipo cria só o card executável, sem Entrega-pai", async ({ page }) => {
    await login(page);
    const res = await page.request.post("/api/admin/tasks?scope=task", {
      data: { title: `${PREFIX} Só a edição`, kind: "operacional", subtype: "edicao", status: "backlog", priority: "media" },
    });
    expect(res.ok()).toBeTruthy();
    const card = await res.json();
    created.push(card.id);

    expect(card.kind).toBe("operacional");
    expect(card.subtype).toBe("edicao");
    expect(card.workflow_version_id).toBeNull();
    expect((card.parents ?? []).length).toBe(0);
    // Nenhum elo — nasce solto, para ser vinculado depois pelo botão de corrente.
    const { data: links } = await sb.from("task_links").select("id").eq("child_id", card.id);
    expect((links ?? []).length).toBe(0);
  });

  test("Rotina liga a recorrência; trocar de tipo a limpa", async ({ page }) => {
    await login(page);
    await page.goto("/admin/home", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Nova tarefa/ }).click();
    const modal = page.locator(".tm").first();
    await expect(modal).toBeVisible({ timeout: 15_000 });

    const kindIcon = modal.locator(".cal-pick-ico").first();
    const recToggle = page.locator(".cal-rec-toggle input");
    // Troca o tipo pelo dropdown do header. Fecha o popover do calendário antes
    // (clicar no ícone de novo) — apertar Escape fecharia o modal inteiro.
    async function pickKind(label: string) {
      if (await recToggle.isVisible().catch(() => false)) await kindIcon.click();
      await modal.locator(".tm-new-kind").first().click();
      await page.locator(".tm-headpick-option", { hasText: label }).first().click();
      await kindIcon.click();
      await expect(recToggle).toBeVisible();
    }

    await pickKind("Rotina");
    await expect(recToggle).toBeChecked();

    await pickKind("Plano");
    await expect(recToggle).not.toBeChecked();

    // Sair da Rotina sempre limpa a recorrência que ela ligou — inclusive indo
    // direto para Entrega.
    await pickKind("Entrega");
    await expect(recToggle).not.toBeChecked();
  });

  test("Entrega pode ser recorrente: molde fixa a versão + recurrence_group, ocorrência tem etapa", async ({ page }) => {
    await login(page);
    const res = await page.request.post("/api/admin/tasks?scope=task", {
      data: {
        title: `${PREFIX} Entrega recorrente`,
        kind: "criativo",
        subtype: null,
        status: "backlog",
        priority: "media",
        start_date: "2026-09-07", // segunda-feira
        recurrence_cadence: "semanal",
        recurrence_weekdays: [], // opcional — cai no dia da data de início
      },
    });
    expect(res.ok()).toBeTruthy();
    const step = await res.json();
    created.push(step.id);

    // A resposta é a 1ª ETAPA da ocorrência 0; o pai dessa etapa é a
    // entrega-ocorrência, e o pai DELA é o molde recorrente.
    const occurrenceId = (step.parents ?? []).find((p: { id: string }) => p.id)?.id;
    expect(occurrenceId).toBeTruthy();
    created.push(occurrenceId);

    const { data: occurrence } = await sb.from("tasks").select("workflow_version_id,kind,plan_id").eq("id", occurrenceId).single();
    expect(occurrence?.workflow_version_id).toBeTruthy();
    const templateId = occurrence?.plan_id as string;
    expect(templateId).toBeTruthy();
    created.push(templateId);

    const { data: template } = await sb.from("tasks").select("payload,kind,workflow_version_id,recurrence_cadence,recurrence_weekdays").eq("id", templateId).single();
    expect(template?.kind).toBe("criativo");
    expect(template?.workflow_version_id).toBeTruthy();
    expect(template?.payload?.recurrence_group).toBe(true);
    expect(template?.recurrence_cadence).toBe("semanal");
    // Dia-da-semana ausente → fixado no dia da data de início (segunda = 1).
    expect(template?.recurrence_weekdays).toEqual([1]);
  });

  test("uma Entrega não aceita subtipo de Tarefa", async ({ page }) => {
    await login(page);
    const comSubtipo = await page.request.post("/api/admin/tasks?scope=task", {
      data: { title: `${PREFIX} inválida`, kind: "criativo", subtype: "edicao", status: "backlog", priority: "media" },
    });
    expect(comSubtipo.status()).toBe(400);
  });
});
