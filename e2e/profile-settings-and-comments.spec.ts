import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Real end-to-end coverage against the live backend (no mocks) for two fixes:
// (1) task comments were always authored "Admin North" regardless of who was
//     logged in — every admin comment now carries the real session user's name;
// (2) Configurações' first tab ("Perfil da agência") gained a "Minha conta"
//     section: username (real, persisted to profiles.full_name), a mock photo
//     picker (local-only, no bucket yet), and real email/password changes via
//     supabase.auth.updateUser(). Uses a disposable admin user created via the
//     service role so the shared ADMIN_EMAIL/PASSWORD fixture used by other
//     specs is never touched, and deletes everything it creates.

const RUN = Date.now();
const TEST_EMAIL = `e2e-profile-${RUN}@e2e-test.com`;
const INITIAL_PASSWORD = "SenhaForte123!";
const NEW_PASSWORD = "NovaSenhaForte456!";
const INITIAL_NAME = `E2E Perfil ${RUN}`;
const RENAMED = `${INITIAL_NAME} editado`;
const TASK_TITLE = `[e2e ${RUN}] Comentário de autoria`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(email);
  await page.getByPlaceholder("Sua senha").fill(password);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
}

// A tiny valid 1x1 PNG, used as the mock profile-photo upload.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Comentários com nome real + Minha conta (e2e contra o backend real)", () => {
  let sb: SupabaseClient;
  let userId = "";
  let taskId = "";

  test.beforeAll(async () => {
    sb = serviceClient();

    const { data: created, error: createError } = await sb.auth.admin.createUser({
      email: TEST_EMAIL,
      password: INITIAL_PASSWORD,
      email_confirm: true,
      app_metadata: { role: "admin", level: "editor" },
    });
    if (createError || !created.user) throw new Error(`falha ao criar usuário e2e: ${createError?.message}`);
    userId = created.user.id;

    // Defensive, same as scripts/create-user.mjs: don't depend on trigger timing.
    const { error: profileError } = await sb.from("profiles").upsert(
      { id: userId, role: "admin", level: "editor", client_id: null, full_name: INITIAL_NAME },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(`falha ao preparar profile e2e: ${profileError.message}`);

    const { data: client, error: clientError } = await sb.from("clients").select("id").eq("disabled", false).limit(1).single();
    if (clientError || !client) throw new Error(`cliente para e2e não encontrado: ${clientError?.message}`);
    const { data: task, error: taskError } = await sb
      .from("tasks")
      .insert({ client_id: client.id, kind: "operacional", title: TASK_TITLE, status: "backlog", priority: "media" })
      .select("id")
      .single();
    if (taskError || !task) throw new Error(`falha ao criar tarefa e2e: ${taskError?.message}`);
    taskId = task.id as string;
  });

  test.afterAll(async () => {
    if (taskId) await sb.from("tasks").delete().eq("id", taskId);
    if (userId) await sb.auth.admin.deleteUser(userId);
  });

  test("comentário mostra o nome real da conta logada; Minha conta salva foto mock, nome, e-mail e senha de verdade", async ({ page }) => {
    test.setTimeout(120_000);

    // 1) Comment authorship: bug was every comment hardcoding "Admin North".
    await login(page, TEST_EMAIL, INITIAL_PASSWORD);
    await page.goto("/admin/kanban");
    await page.locator(".kb-card", { hasText: TASK_TITLE }).click();
    const modal = page.locator(".tm");
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder("Escrever comentário…").fill("Confirmando autoria do comentário.");
    await modal.getByRole("button", { name: "Enviar" }).click();
    const lastComment = modal.locator(".tm-comment").first();
    // The PATCH route's first dev-mode compile can take several seconds
    // (same gotcha as e2e/task-modal-progress.spec.ts) — give it more room
    // than the default 5s before asserting on the saved comment.
    await expect(lastComment.locator(".tm-comment-meta b")).toHaveText(INITIAL_NAME, { timeout: 15_000 });
    await expect(lastComment.locator(".tm-comment-meta b")).not.toHaveText("Admin North");

    // Backend check: the persisted payload really carries the real name.
    const { data: taskRow, error: taskReadError } = await sb.from("tasks").select("payload").eq("id", taskId).single();
    if (taskReadError) throw taskReadError;
    const comments = (taskRow?.payload as { comments?: { author: string }[] } | null)?.comments ?? [];
    expect(comments.at(-1)?.author).toBe(INITIAL_NAME);

    // 2) Configurações → Minha conta: real username round-trip.
    await page.goto("/admin/configuracoes");
    const myAccount = page.locator(".set-card", { hasText: "Minha conta" });
    await expect(myAccount.getByRole("heading", { name: "Minha conta" })).toBeVisible();
    const nameInput = myAccount.getByLabel("Nome de usuário");
    await expect(nameInput).toHaveValue(INITIAL_NAME);

    // 2a) Mock photo picker: local preview only, no backend call.
    await myAccount.locator('input[type="file"]').setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(myAccount.locator(".set-avatar-big img")).toBeVisible();
    const photoSrc = await myAccount.locator(".set-avatar-big img").getAttribute("src");
    expect(photoSrc).toMatch(/^data:image\/png;base64,/);

    // 2b) Username: PATCH /api/admin/me → profiles.full_name.
    await nameInput.fill(RENAMED);
    await myAccount.getByRole("button", { name: "Salvar nome" }).click();
    await expect(myAccount.getByText("Salvo.")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.locator(".set-card", { hasText: "Minha conta" }).getByLabel("Nome de usuário")).toHaveValue(RENAMED);
    const { data: profileRow, error: profileReadError } = await sb.from("profiles").select("full_name").eq("id", userId).single();
    if (profileReadError) throw profileReadError;
    expect(profileRow?.full_name).toBe(RENAMED);

    // 2c) Email: real supabase.auth.updateUser() call (pending confirmation,
    // so it won't break subsequent logins with the original email).
    const myAccountAfterReload = page.locator(".set-card", { hasText: "Minha conta" });
    await myAccountAfterReload.getByLabel("E-mail").fill(`novo-${RUN}@e2e-test.com`);
    await myAccountAfterReload.getByRole("button", { name: "Salvar e-mail" }).click();
    await expect(myAccountAfterReload.getByText(/Confirme o novo e-mail/)).toBeVisible({ timeout: 15_000 });

    // 2d) Password: real supabase.auth.updateUser() call, applies immediately
    // (no confirmation step) — proven by logging back in with it below.
    await myAccountAfterReload.getByLabel("Nova senha").fill(NEW_PASSWORD);
    await myAccountAfterReload.getByLabel("Confirmar senha").fill(NEW_PASSWORD);
    await myAccountAfterReload.getByRole("button", { name: "Alterar senha" }).click();
    await expect(myAccountAfterReload.getByText("Senha atualizada.")).toBeVisible({ timeout: 15_000 });

    // 3) Backend proof: log out, log back in with only the NEW password.
    await page.goto("/logout");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await login(page, TEST_EMAIL, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/admin/);
  });
});
