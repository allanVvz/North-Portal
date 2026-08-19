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
  });

  test.afterAll(async () => {
    if (taskId) await sb.from("tasks").delete().eq("id", taskId);
    if (userId) await sb.auth.admin.deleteUser(userId);
  });

  test("sino mostra a notificação real do trigger de revisor e marca como lida ao abrir", async ({ page }) => {
    test.setTimeout(90_000);

    // Backend proof the trigger actually fired before touching the UI at all.
    const { data: seeded, error: seededError } = await sb
      .from("notifications")
      .select("id,message,read_at")
      .eq("profile_id", userId)
      .eq("type", "task_review_assigned")
      .single();
    if (seededError) throw seededError;
    expect(seeded?.message).toContain(TASK_TITLE);
    expect(seeded?.read_at).toBeNull();

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
        const { data } = await sb.from("notifications").select("read_at").eq("id", seeded!.id).single();
        return data?.read_at ?? null;
      }, { timeout: 15_000 })
      .not.toBeNull();

    await page.reload();
    await expect(page.locator(".admin-notif .admin-notif-dot")).toHaveCount(0);
  });
});
