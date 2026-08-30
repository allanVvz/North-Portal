import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Real end-to-end coverage (no mocks) for the admin bell/dropdown in
// app/admin/AdminShell.tsx, which used to render a hardcoded MOCK_NOTIFICATIONS
// constant. It now reads GET /api/admin/notifications and marks the inbox
// read via PATCH on open — this proves both round-trip against the real
// backend, including the notify_task_reviewer_assigned DB trigger
// (supabase/migrations/20260819000001_notifications.sql) that produces the
// row in the first place.

const RUN = Date.now();
const EMAIL = `e2e-notif-${RUN}@e2e-test.com`;
// Segundo envolvido, e não é detalhe de fixture: quem AGE é excluído do leque
// de propósito (ninguém precisa ser avisado do que acabou de fazer), então um
// teste com um participante só mede zero e parece bug.
const EMAIL_COLEGA = `e2e-notif-colega-${RUN}@e2e-test.com`;
const PASSWORD = "SenhaForte123!";
const TASK_TITLE = `[e2e ${RUN}] Revisão de notificação`;

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

test.describe("Notificações reais no sino do rail (e2e contra o backend real)", () => {
  let sb: SupabaseClient;
  let userId = "";
  let colegaId = "";
  let taskId = "";

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
      { id: userId, role: "admin", level: "editor", client_id: null, full_name: `E2E Notif ${RUN}` },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(`falha ao preparar profile e2e: ${profileError.message}`);

    const { data: colega, error: colegaError } = await sb.auth.admin.createUser({
      email: EMAIL_COLEGA,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role: "admin", level: "editor" },
    });
    if (colegaError || !colega.user) throw new Error(`falha ao criar colega e2e: ${colegaError?.message}`);
    colegaId = colega.user.id;
    const { error: colegaProfileError } = await sb.from("profiles").upsert(
      { id: colegaId, role: "admin", level: "editor", client_id: null, full_name: `E2E Colega ${RUN}` },
      { onConflict: "id" },
    );
    if (colegaProfileError) throw new Error(`falha ao preparar profile do colega: ${colegaProfileError.message}`);

    const { data: client, error: clientError } = await sb.from("clients").select("id").eq("disabled", false).limit(1).single();
    if (clientError || !client) throw new Error(`cliente para e2e não encontrado: ${clientError?.message}`);

    // Created directly in "revisao" with reviewer_id already set: the trigger
    // only fires on UPDATE, so this needs a second write to actually cross
    // into the state it watches for (old.status/reviewer_id distinct from new).
    const { data: task, error: taskError } = await sb
      .from("tasks")
      .insert({ client_id: client.id, kind: "operacional", title: TASK_TITLE, status: "backlog", priority: "media" })
      .select("id")
      .single();
    if (taskError || !task) throw new Error(`falha ao criar tarefa e2e: ${taskError?.message}`);
    taskId = task.id as string;

    const { error: updateError } = await sb.from("tasks").update({ status: "revisao", reviewer_id: userId }).eq("id", taskId);
    if (updateError) throw new Error(`falha ao atribuir revisor e2e: ${updateError.message}`);

    // O colega é o RESPONSÁVEL do card — envolvido pela via de task_assignees,
    // que é o vínculo real de responsável nesta base.
    const { error: assigneeError } = await sb
      .from("task_assignees").insert({ task_id: taskId, profile_id: colegaId });
    if (assigneeError) throw new Error(`falha ao vincular responsável e2e: ${assigneeError.message}`);
  });

  test.afterAll(async () => {
    if (taskId) await sb.from("tasks").delete().eq("id", taskId);
    if (userId) await sb.auth.admin.deleteUser(userId);
    if (colegaId) await sb.auth.admin.deleteUser(colegaId);
    // As regras são GLOBAIS: um teste que mexe nelas e não devolve deixa a
    // agência inteira configurada pelo último e2e que rodou. Apagar a chave
    // devolve os defaults, que é o estado de quem nunca mexeu.
    await sb.from("site_settings").delete().eq("key", "notification_rules");
  });

  test("sino mostra a notificação real do trigger de revisor e marca como lida ao abrir", async ({ page }) => {
    test.setTimeout(90_000);

    // Backend proof the trigger actually fired before touching the UI at all.
    //
    // Contagem, e não `.single()`. O leque é append-only de propósito — o mesmo
    // par (pessoa, card, tipo) PODE acumular linhas, e desde que ele passou a
    // cobrir comentário, criação e edição isso deixou de ser exceção.
    // `.single()` transformaria uma segunda notificação correta num teste
    // vermelho.
    const { data: seededRows, error: seededError } = await sb
      .from("notifications")
      .select("id,message,read_at,created_at")
      .eq("profile_id", userId)
      .eq("task_id", taskId)
      .eq("type", "task_review_assigned")
      .order("created_at", { ascending: false });
    if (seededError) throw seededError;
    expect(seededRows!.length).toBeGreaterThanOrEqual(1);
    const seeded = seededRows![0];
    expect(seeded.message).toContain(TASK_TITLE);
    expect(seeded.read_at).toBeNull();

    await login(page);
    await page.goto("/admin/plano");

    // Dev-mode first compile of /admin/plano can take well past the default
    // 5s (same gotcha noted in e2e/profile-settings-and-comments.spec.ts).
    const bell = page.locator(".admin-notif [aria-label='Notificações']");
    await expect(bell.locator(".admin-notif-dot")).toBeVisible({ timeout: 30_000 });

    await bell.click();
    const panel = page.locator(".admin-notif-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText(TASK_TITLE)).toBeVisible();

    // Opening marks the whole inbox read (fire-and-forget PATCH) — verify the
    // backend row, then that the dot is gone on a fresh load.
    await expect
      .poll(async () => {
        const { data } = await sb.from("notifications").select("read_at").eq("id", seeded.id).single();
        return data?.read_at ?? null;
      }, { timeout: 15_000 })
      .not.toBeNull();

    await page.reload();
    await expect(page.locator(".admin-notif .admin-notif-dot")).toHaveCount(0);
  });

  // Regressão do bug de 26/08: o gatilho fazia `on conflict (profile_id,
  // task_id, type)` e a migração daquele dia trocou o índice único por um
  // PARCIAL (só `task_due_soon`). Índice parcial não arbitra outro tipo, então
  // o Postgres levantava 42P10 — e como a notificação é escrita DENTRO da
  // mesma transação, a UPDATE do card inteira era desfeita. O sintoma não era
  // "notificação com problema", era "não consigo salvar".
  test("atribuir revisor duas vezes seguidas não quebra a escrita do card", async () => {
    const passadas: number[] = [];
    for (const status of ["em_producao", "revisao", "em_producao", "revisao"] as const) {
      const { error } = await sb.from("tasks").update({ status, reviewer_id: userId }).eq("id", taskId);
      // ESTE expect é o teste. Antes do conserto o segundo `revisao` devolvia
      // "there is no unique or exclusion constraint matching the ON CONFLICT".
      expect(error).toBeNull();
      if (status === "revisao") {
        const { count } = await sb
          .from("notifications").select("id", { count: "exact", head: true })
          .eq("profile_id", userId).eq("task_id", taskId).eq("type", "task_review_assigned");
        passadas.push(count ?? 0);
      }
    }
    // Append-only: cada entrada em Revisão gera uma linha nova, não sobrescreve
    // a anterior. É o que a migração de 26/08 queria e o gatilho não seguiu.
    expect(passadas[1]).toBeGreaterThan(passadas[0]);
  });

  // A regra é lida DENTRO do banco justamente para valer em todo caminho de
  // escrita. Este teste é o que falharia na hora se alguém a movesse para o
  // TypeScript.
  test("desligar um tipo em Configurações para de gerar linha no banco", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);

    // Conta a caixa do COLEGA, não a de quem comenta: o autor é excluído do
    // leque, então medir a própria caixa daria zero sempre e esconderia a
    // regra que este teste quer provar.
    const contar = async () => {
      const { count } = await sb
        .from("notifications").select("id", { count: "exact", head: true })
        .eq("profile_id", colegaId).eq("task_id", taskId).eq("type", "task_commented");
      return count ?? 0;
    };

    const desligar = await page.request.patch("/api/admin/settings/notification-rules", {
      data: { comments: false },
    });
    expect(desligar.ok()).toBeTruthy();

    const antes = await contar();
    const mudo = await page.request.post(`/api/admin/tasks/${taskId}/comments`, {
      data: { text: `[e2e ${RUN}] comentário com a regra desligada` },
    });
    expect(mudo.ok()).toBeTruthy();
    expect(await contar()).toBe(antes);

    const religar = await page.request.patch("/api/admin/settings/notification-rules", {
      data: { comments: true },
    });
    expect(religar.ok()).toBeTruthy();

    const audivel = await page.request.post(`/api/admin/tasks/${taskId}/comments`, {
      data: { text: `[e2e ${RUN}] comentário com a regra ligada` },
    });
    expect(audivel.ok()).toBeTruthy();
    await expect.poll(contar, { timeout: 15_000 }).toBeGreaterThan(antes);

    // E o autor continua sem se notificar — a outra metade da mesma regra.
    const { count: proprias } = await sb
      .from("notifications").select("id", { count: "exact", head: true })
      .eq("profile_id", userId).eq("task_id", taskId).eq("type", "task_commented");
    expect(proprias ?? 0).toBe(0);
  });
});
