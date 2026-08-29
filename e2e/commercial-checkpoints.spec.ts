import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Real end-to-end coverage of the "Checkpoints comerciais" feature against the
// live Supabase backend — no mocks: (1) a brand-new client auto-provisions one
// real task per active checkpoint template on creation; (2) onboarding % on
// /admin/onboarding reflects the real average across those cards at 0%,
// partial and 100%; (3) Central Comercial on the client portal renders the
// real checkpoint cards, not the static demo array. Cleans up everything it
// creates (including the client itself).

const RUN = Date.now();
const SLUG = `e2e-checkpoints-${RUN}`;
const NAME = `[e2e ${RUN}] Cliente Checkpoints`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key);
}

async function deleteAuthUserByEmail(sb: SupabaseClient, email: string): Promise<void> {
  const { data } = await sb.auth.admin.listUsers({ perPage: 200 });
  const user = data?.users?.find((u) => u.email === email);
  if (user) await sb.auth.admin.deleteUser(user.id);
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
}

test.describe("Checkpoints comerciais (e2e contra o backend real)", () => {
  let sb: SupabaseClient;
  let clientId: string;

  test.beforeAll(async () => {
    sb = serviceClient();
    // Creating the client via the real admin API (not a raw insert) is the
    // point of this test: it's the only path that exercises provisionCheckpointsForClient.
  });

  test.afterAll(async () => {
    if (clientId) {
      await deleteAuthUserByEmail(sb, `${SLUG}@e2e-test.com`);
      await sb.from("tasks").delete().eq("client_id", clientId);
      await sb.from("briefing_answers").delete().eq("client_id", clientId);
      await sb.from("client_drive_links").delete().eq("client_id", clientId);
      await sb.from("client_results").delete().eq("client_id", clientId);
      await sb.from("client_content").delete().eq("client_id", clientId);
      await sb.from("clients").delete().eq("id", clientId);
    }
  });

  test("cliente novo auto-provisiona um checkpoint por template ativo, e o % de onboarding evolui com o estado real", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);

    // 1. Create the client through the real UI/API flow.
    await page.goto("/admin/novo");
    await page.getByPlaceholder("Ex.: Karpinski Detalhamento").fill(NAME);
    await page.getByRole("textbox", { name: "Slug (URL do portal)" }).fill(SLUG);
    await page.getByPlaceholder("cliente@empresa.com").fill(`${SLUG}@e2e-test.com`);
    await page.getByRole("button", { name: "Criar cliente" }).click();
    await expect(page.getByText("Login de acesso do cliente")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Ir para o cliente" }).click();
    await page.waitForURL(new RegExp(`/admin/${SLUG}`), { timeout: 15_000 });

    const { data: client, error } = await sb.from("clients").select("id").eq("slug", SLUG).single();
    if (error || !client) throw new Error(`client '${SLUG}' not found after creation: ${error?.message}`);
    clientId = client.id as string;

    const { data: templates } = await sb.from("commercial_checkpoint_templates").select("id").eq("active", true);
    const templateCount = templates?.length ?? 0;
    expect(templateCount).toBeGreaterThan(0);

    // 2. Real checkpoint cards were auto-created — one per active template, all backlog.
    const { data: checkpoints } = await sb
      .from("tasks")
      .select("id,status")
      .eq("client_id", clientId)
      .eq("kind", "checkpoint_comercial");
    expect(checkpoints?.length ?? 0).toBe(templateCount);
    expect(checkpoints?.every((c) => c.status === "backlog")).toBe(true);

    // 3. Onboarding shows 0% while every checkpoint is still backlog.
    await page.goto("/admin/onboarding");
    const row = page.locator("tr", { hasText: NAME });
    await expect(row).toBeVisible();
    await expect(row.locator(".ob-progress span")).toHaveText("0%");

    // 4. Move half the checkpoints to concluido -> onboarding % updates.
    const ids = (checkpoints ?? []).map((c) => c.id as string);
    const half = ids.slice(0, Math.ceil(ids.length / 2));
    await sb.from("tasks").update({ status: "concluido" }).in("id", half);

    await page.reload();
    const rowAfter = page.locator("tr", { hasText: NAME });
    await expect(rowAfter.locator(".ob-progress span")).not.toHaveText("0%");

    // 5. Mark all concluido -> 100%, and the real checkpoints render on the
    //    client's own Central Comercial page (not the static demo array).
    await sb.from("tasks").update({ status: "concluido" }).in("id", ids);
    await page.reload();
    await expect(page.locator("tr", { hasText: NAME }).locator(".ob-progress span")).toHaveText("100%");

    await sb.from("clients").update({ is_active: true }).eq("id", clientId);
    await page.goto(`/${SLUG}#central`);
    const { data: named } = await sb.from("tasks").select("title").eq("client_id", clientId).eq("kind", "checkpoint_comercial");
    // First navigation to a fresh route can hit Next.js dev-mode's cold
    // compile — give the client portal's own first render more room than the
    // default 5s assertion timeout.
    await expect(page.locator(".np-checkpoints")).toBeVisible({ timeout: 20_000 });
    for (const row2 of named ?? []) {
      await expect(page.getByText(row2.title as string).first()).toBeVisible();
    }
  });
});
