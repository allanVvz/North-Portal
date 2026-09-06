import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Configurações › Tipos e fluxos, contra o backend real (R2.1).
//
// O molde de uma Entrega — quais etapas, em que ordem, com que prazo, peso e
// visibilidade — só mudava por SQL. Este spec prova que a tela mexe na tabela
// `task_types` de verdade e que as travas seguram o que o SQL cru não segurava:
// etapa em uso não some, Entrega não fica sem etapa ativa.
//
// Tudo acontece sobre um TIPO descartável criado no beforeAll (`creatable
// false`, para não aparecer no dropdown de criação de ninguém enquanto o teste
// roda) e apagado no afterAll — o molde do `criativo`, que está em produção
// com entregas em andamento, nunca é tocado.

const RUN = Date.now();
const EMAIL = `e2e-fluxos-${RUN}@e2e-test.com`;
const PASSWORD = "SenhaForte123!";
const TYPE_KEY = `e2e_fluxo_${RUN}`;
const TYPE_LABEL = `E2E Fluxo ${RUN}`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(EMAIL);
  await page.getByPlaceholder("Sua senha").fill(PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

function panelError(page: Page) {
  return page.locator(".set-card", { hasText: "Tipos e fluxos" }).locator(".admin-error");
}

async function openPanel(page: Page) {
  await page.goto("/admin/configuracoes?tab=fluxos");
  const section = page.locator(".voc-type", { hasText: TYPE_LABEL });
  // Primeira compilação de /admin/configuracoes em dev passa longe dos 5s padrão.
  await expect(section).toBeVisible({ timeout: 30_000 });
  return section;
}

test.describe("Tipos e fluxos — editor do molde de Entrega (e2e real)", () => {
  let sb: SupabaseClient;
  let userId = "";
  let typeId = "";
  let clientId = "";
  const cardIds: string[] = [];

  test.beforeAll(async () => {
    sb = serviceClient();

    const { data: created, error: createError } = await sb.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role: "admin", level: "editor" },
    });
    if (createError || !created.user) throw new Error(`falha ao criar usuário e2e: ${createError?.message}`);
    userId = created.user.id;
    const { error: profileError } = await sb.from("profiles").upsert(
      { id: userId, role: "admin", level: "editor", client_id: null, full_name: `E2E Fluxos ${RUN}` },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(`falha ao preparar profile e2e: ${profileError.message}`);

    const { data: type, error: typeError } = await sb
      .from("task_types")
      .insert({ key: TYPE_KEY, label: TYPE_LABEL, order_index: 900, behavior: "entrega", creatable: false })
      .select("id")
      .single();
    if (typeError || !type) throw new Error(`falha ao semear tipo e2e: ${typeError?.message}`);
    typeId = type.id as string;

    const { error: stepsError } = await sb.from("task_types").insert([
      { parent_id: typeId, key: "etapa_a", label: "Etapa A", order_index: 10, lead_days: 1 },
      { parent_id: typeId, key: "etapa_b", label: "Etapa B", order_index: 20, lead_days: 2 },
    ]);
    if (stepsError) throw new Error(`falha ao semear etapas e2e: ${stepsError.message}`);

    // Um cliente qualquer só para poder criar um card do tipo semeado (a trava
    // de "etapa em uso" precisa de um card real, não de um mock).
    const { data: client } = await sb.from("clients").select("id").limit(1).single();
    clientId = (client?.id as string) ?? "";
  });

  test.afterAll(async () => {
    if (!sb) return;
    if (cardIds.length) await sb.from("tasks").delete().in("id", cardIds);
    // Os subtipos caem por `on delete cascade` do parent_id.
    if (typeId) await sb.from("task_types").delete().eq("id", typeId);
    if (userId) await sb.auth.admin.deleteUser(userId);
  });

  test("cria etapa pela tela, edita prazo/peso/visibilidade e reordena a cascata", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page);
    const section = await openPanel(page);

    // A ordem impressa na tela é a ordem do molde.
    await expect(section.locator(".voc-step").nth(0)).toContainText("Etapa A");
    await expect(section.locator(".voc-step").nth(1)).toContainText("Etapa B");

    // ── criar ───────────────────────────────────────────────────────────────
    await section.getByRole("button", { name: `+ Etapa em ${TYPE_LABEL}` }).click();
    await section.getByPlaceholder("Ex.: Edição").fill("Revisão Final");
    await section.getByRole("button", { name: "Salvar" }).click();
    await expect(section.locator(".voc-step", { hasText: "Revisão Final" })).toBeVisible({ timeout: 15_000 });

    // A key é derivada do rótulo (sem acento, minúscula) e a etapa entra no fim.
    const { data: novaEtapa } = await sb
      .from("task_types")
      .select("id,key,order_index,lead_days,progress_weight,client_visible")
      .eq("parent_id", typeId)
      .eq("label", "Revisão Final")
      .single();
    expect(novaEtapa?.key).toBe("revisao_final");
    expect(novaEtapa?.order_index).toBe(30);

    // ── editar ──────────────────────────────────────────────────────────────
    const nova = section.locator(".voc-step", { hasText: "Revisão Final" });
    await nova.getByRole("button", { name: "Editar" }).click();
    await section.getByLabel("Prazo (dias)").fill("5");
    await section.getByLabel("Peso no progresso").fill("2");
    await section.getByText("O cliente acompanha esta etapa no portal").click();
    await section.getByRole("button", { name: "Salvar" }).click();

    await expect
      .poll(async () => {
        const { data } = await sb
          .from("task_types")
          .select("lead_days,progress_weight,client_visible")
          .eq("id", novaEtapa!.id)
          .single();
        return [data?.lead_days, Number(data?.progress_weight), data?.client_visible];
      }, { timeout: 15_000 })
      .toEqual([5, 2, true]);

    // ── reordenar ───────────────────────────────────────────────────────────
    // Arrastar a etapa nova para cima da primeira reescreve `order_index` —
    // a ordem da lista É a ordem em que a cascata materializa as etapas.
    await page.locator(".voc-step", { hasText: "Revisão Final" }).dragTo(page.locator(".voc-step", { hasText: "Etapa A" }));

    await expect
      .poll(async () => {
        const { data } = await sb
          .from("task_types")
          .select("label,order_index")
          .eq("parent_id", typeId)
          .order("order_index");
        return data?.map((d) => d.label) ?? [];
      }, { timeout: 15_000 })
      .toEqual(["Revisão Final", "Etapa A", "Etapa B"]);
  });

  test("etapa em uso não se exclui, e com card em aberto nem se desativa", async ({ page }) => {
    test.setTimeout(150_000);
    test.skip(!clientId, "nenhum cliente no banco para pendurar o card de teste");

    const { data: card, error: cardError } = await sb
      .from("tasks")
      .insert({
        client_id: clientId,
        title: `E2E card do fluxo ${RUN}`,
        kind: TYPE_KEY,
        subtype: "etapa_a",
        status: "backlog",
      })
      .select("id")
      .single();
    if (cardError || !card) throw new Error(`falha ao criar card e2e: ${cardError?.message}`);
    cardIds.push(card.id as string);

    await login(page);
    const section = await openPanel(page);
    const etapaA = section.locator(".voc-step", { hasText: "Etapa A" });

    // Com histórico, Excluir some da tela — o caminho honesto é desativar.
    await expect(etapaA.getByRole("button", { name: "Excluir" })).toHaveCount(0);

    // E com o card ainda em aberto, nem desativar passa: a cascata leria a
    // etapa seguinte numa lista de onde ela sumiu e pararia em silêncio.
    await etapaA.getByRole("button", { name: "Desativar" }).click();
    // O aviso é do painel inteiro (uma mensagem por vez), não da linha.
    await expect(panelError(page)).toContainText("card em aberto", { timeout: 15_000 });
    const { data: aindaAtiva } = await sb
      .from("task_types")
      .select("active")
      .eq("parent_id", typeId)
      .eq("key", "etapa_a")
      .single();
    expect(aindaAtiva?.active).toBe(true);

    // Fechado o card, a etapa sai do molde sem levar o histórico junto.
    const { error: closeError } = await sb.from("tasks").update({ status: "aprovado" }).eq("id", card.id);
    if (closeError) throw closeError;

    await page.reload();
    const sectionAfter = page.locator(".voc-type", { hasText: TYPE_LABEL });
    await expect(sectionAfter).toBeVisible({ timeout: 30_000 });
    await sectionAfter.locator(".voc-step", { hasText: "Etapa A" }).getByRole("button", { name: "Desativar" }).click();

    await expect
      .poll(async () => {
        const { data } = await sb.from("task_types").select("active").eq("parent_id", typeId).eq("key", "etapa_a").single();
        return data?.active;
      }, { timeout: 15_000 })
      .toBe(false);
  });

  test("uma Entrega nunca fica sem etapa ativa", async ({ page }) => {
    test.setTimeout(120_000);

    // Deixa uma só ativa e tenta desligar essa também.
    const { error } = await sb.from("task_types").update({ active: false }).eq("parent_id", typeId).neq("key", "etapa_b");
    if (error) throw error;

    await login(page);
    const section = await openPanel(page);
    await section.locator(".voc-step", { hasText: "Etapa B" }).getByRole("button", { name: "Desativar" }).click();

    await expect(panelError(page)).toContainText("pelo menos uma etapa ativa", { timeout: 15_000 });
    const { data } = await sb.from("task_types").select("active").eq("parent_id", typeId).eq("key", "etapa_b").single();
    expect(data?.active).toBe(true);
  });
});
