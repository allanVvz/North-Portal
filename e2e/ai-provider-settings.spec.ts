import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Real end-to-end coverage (no mocks) for Configurações → Integrações →
// Provedor de IA. It used to be local component state only (no save/vault
// call — see the removed comment in AiProviderIntegration.tsx) because
// integration_credentials.provider only allowed 'windsor'/'meta'. Migration
// 20260819000002_ai_provider_credential.sql added 'ai'; this proves the same
// vault-backed round trip already used by Windsor/Meta now works for it too:
// save persists to a real integration_credentials row + vault secret, GET
// only ever returns configured/last4 (never the raw key), and clearing it
// really disconnects.
//
// The vault_* RPCs (lib/vault.ts) are SECURITY DEFINER but still gate on
// auth.uid()/is_admin() internally — a service-role client has no JWT, so
// auth.uid() is null there and every vault_* call raises "forbidden". Table
// reads/deletes and admin.createUser/deleteUser still use the service
// client; anything touching the vault goes through a real signed-in admin
// session instead (adminVaultClient below), same as the app itself does.

const RUN = Date.now();
const EMAIL = `e2e-aiprovider-${RUN}@e2e-test.com`;
const PASSWORD = "SenhaForte123!";
const FAKE_KEY = `sk-e2e-test-key-${RUN}`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set (.env.local).");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`falha ao autenticar cliente vault e2e: ${error.message}`);
  return client;
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(EMAIL);
  await page.getByPlaceholder("Sua senha").fill(PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

async function wipeAiProviderRow(sb: SupabaseClient, vault: SupabaseClient): Promise<void> {
  const { data: existing } = await sb
    .from("integration_credentials")
    .select("id,vault_secret_id")
    .eq("provider", "ai")
    .eq("scope", "agency")
    .limit(1);
  const row = existing?.[0];
  if (!row) return;
  const { error: vaultError } = await vault.rpc("vault_delete_secret", { p_id: row.vault_secret_id });
  if (vaultError) throw new Error(`falha ao apagar segredo do cofre e2e: ${vaultError.message}`);
  const { error: rowDeleteError } = await sb.from("integration_credentials").delete().eq("id", row.id);
  if (rowDeleteError) throw rowDeleteError;
}

test.describe("Provedor de IA real (e2e contra o backend real)", () => {
  let sb: SupabaseClient;
  let vault: SupabaseClient;
  let userId = "";

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
      { id: userId, role: "admin", level: "editor", client_id: null, full_name: `E2E AI Provider ${RUN}` },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(`falha ao preparar profile e2e: ${profileError.message}`);

    vault = await signedInClient(EMAIL, PASSWORD);

    // Pristine start: this integration is agency-wide (one row, not scoped
    // to the disposable test user), so wipe any leftover row from a prior
    // failed run before asserting on a fresh state.
    await wipeAiProviderRow(sb, vault);
  });

  test.afterAll(async () => {
    if (sb && vault) await wipeAiProviderRow(sb, vault);
    if (userId) await sb.auth.admin.deleteUser(userId);
  });

  test("salvar provedor/chave persiste no cofre real; remover chave desconecta de verdade", async ({ page }) => {
    test.setTimeout(90_000);

    await login(page);
    await page.goto("/admin/configuracoes?tab=integracoes");
    // Dev-mode first compile of /admin/configuracoes can take well past the
    // default 5s (same gotcha noted in e2e/profile-settings-and-comments.spec.ts).
    const card = page.locator(".set-card", { hasText: "Provedor de IA" });
    await expect(card.getByRole("heading", { name: "Provedor de IA" })).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Configurado")).toHaveCount(0);

    await card.locator("select").selectOption("anthropic");
    await expect(card.getByText("Claude Sonnet 5")).toBeVisible();
    await card.getByPlaceholder(/Cole a API key/).fill(FAKE_KEY);
    await card.getByRole("button", { name: "Salvar" }).click();
    await expect(card.getByText("Configurado")).toBeVisible({ timeout: 15_000 });

    // Backend proof: real integration_credentials row + vault secret, never
    // the raw key exposed back through the masked GET the UI itself uses.
    const { data: row, error: rowError } = await sb
      .from("integration_credentials")
      .select("id,vault_secret_id,meta,status")
      .eq("provider", "ai")
      .eq("scope", "agency")
      .single();
    if (rowError) throw rowError;
    expect((row?.meta as { vendor?: string })?.vendor).toBe("anthropic");
    expect(row?.status).toBe("connected");
    const { data: secret, error: secretError } = await vault.rpc("vault_read_secret", { p_id: row!.vault_secret_id });
    if (secretError) throw secretError;
    expect(secret).toBe(FAKE_KEY);

    // Survives reload — the browser only ever sees the masked shape.
    await page.reload();
    const cardAfterReload = page.locator(".set-card", { hasText: "Provedor de IA" });
    await expect(cardAfterReload.getByText("Configurado")).toBeVisible();
    await expect(cardAfterReload.locator("select")).toHaveValue("anthropic");
    await expect(cardAfterReload.getByPlaceholder(new RegExp(`••••${FAKE_KEY.slice(-4)}`))).toBeVisible();

    // Clear: really disconnects (vault secret wiped to "", status flips).
    await cardAfterReload.getByRole("button", { name: "Remover chave" }).click();
    await expect(cardAfterReload.getByText("Configurado")).toHaveCount(0, { timeout: 15_000 });
    const { data: rowAfterClear, error: rowAfterClearError } = await sb
      .from("integration_credentials")
      .select("status,vault_secret_id")
      .eq("provider", "ai")
      .eq("scope", "agency")
      .single();
    if (rowAfterClearError) throw rowAfterClearError;
    expect(rowAfterClear?.status).toBe("disconnected");
    const { data: secretAfterClear } = await vault.rpc("vault_read_secret", { p_id: rowAfterClear!.vault_secret_id });
    expect(secretAfterClear).toBe("");
  });
});
