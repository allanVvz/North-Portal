import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Real end-to-end coverage (no mocks) for the direct Meta Graph API ads
// insights path (lib/metaInsights.ts): with the agency's real Meta
// connection + client→ad-account mapping already in Supabase, Performance
// must leave demo mode and /api/admin/performance/insights must actually
// round-trip through the Marketing API without erroring. This is the live
// verification the implementation plan called for — a wrong Graph API field
// name would surface here as a non-ok response, not just in a unit test.

const RUN = Date.now();
const EMAIL = `e2e-perf-meta-${RUN}@e2e-test.com`;
const PASSWORD = "SenhaForte123!";

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
  // Dev-mode first compile of /admin can take well past the default 5-15s
  // (same gotcha noted in e2e/profile-settings-and-comments.spec.ts).
  await page.waitForURL(/\/admin/, { timeout: 45_000 });
}

type InsightsResponse = {
  demo: boolean;
  stale: boolean;
  error?: string;
  posts: unknown[];
  datasources: Record<string, boolean>;
};

test.describe("Performance · conexão direta com a Meta (Graph API real)", () => {
  let sb: SupabaseClient;
  let userId = "";

  test.beforeAll(async () => {
    sb = serviceClient();

    // Sanity check before spending a test run on it: the agency's Meta
    // connection must actually be configured, or "sair do modo demo" isn't
    // a meaningful assertion.
    const { data: metaRow, error: metaError } = await sb
      .from("integration_credentials")
      .select("status,meta")
      .eq("provider", "meta")
      .eq("scope", "agency")
      .limit(1)
      .maybeSingle();
    if (metaError) throw new Error(`falha ao ler integration_credentials: ${metaError.message}`);
    if (!metaRow || metaRow.status !== "connected") {
      throw new Error("Conexão com a Meta não está conectada — conecte antes de rodar este teste.");
    }
    const accountMap = (metaRow.meta as { accountMap?: Record<string, unknown> } | null)?.accountMap ?? {};
    if (Object.keys(accountMap).filter((slug) => accountMap[slug]).length === 0) {
      throw new Error("Nenhum cliente está mapeado para uma conta de anúncio Meta — mapeie antes de rodar este teste.");
    }

    const { data: created, error: createError } = await sb.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role: "admin", level: "editor" },
    });
    if (createError || !created.user) throw new Error(`falha ao criar admin e2e: ${createError?.message}`);
    userId = created.user.id;
    const { error: profileError } = await sb.from("profiles").upsert(
      { id: userId, role: "admin", level: "editor", client_id: null },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(`falha ao preparar profile e2e: ${profileError.message}`);
  });

  test.afterAll(async () => {
    if (userId) await sb.auth.admin.deleteUser(userId);
  });

  test("dashboard sai do modo demo e /insights busca dados reais da Marketing API", async ({ page }) => {
    // Generous: `next dev` + React StrictMode double-invokes the dashboard's
    // load() effect, so a cold run can fire two concurrent live fetches
    // across every mapped ad account (each following Graph API pagination)
    // — a dev-only artifact (StrictMode's double effect-fire is stripped in
    // production builds), but it makes first-load timing here worst-case.
    test.setTimeout(180_000);
    await login(page);

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/admin/performance/insights") && res.request().method() === "GET",
      { timeout: 90_000 },
    );
    await page.goto("/admin/performance");
    const res = await responsePromise;
    const body = (await res.json()) as InsightsResponse;

    expect(res.ok(), `insights request failed: ${JSON.stringify(body)}`).toBe(true);
    expect(body.demo, "esperava sair do modo demo com a Meta conectada").toBe(false);
    expect(body.datasources.meta_ads, "esperava o token da Meta ser lido com sucesso do vault").toBe(true);
    // A live Graph API failure with no prior cache makes the route throw
    // (500, caught above) rather than degrade — `stale` only trips when a
    // fetch fails AND a previous successful fetch had already populated the
    // cache. Assert it's not silently degraded either.
    expect(body.stale, `insights degradou para cache stale: ${body.error}`).toBe(false);
    expect(Array.isArray(body.posts)).toBe(true);

    // UI: no "Dados de demonstração" chip, and the paid KPI ("Custo") shows
    // once a meta_ads-backed period is loaded.
    await expect(page.locator(".perf-demo-chip")).toHaveCount(0);
    await expect(page.getByText("Custo (R$)")).toBeVisible();
  });

  test("filtro por cliente mapeado também busca sem erro", async ({ page }) => {
    test.setTimeout(180_000);
    const { data: metaRow } = await sb
      .from("integration_credentials")
      .select("meta")
      .eq("provider", "meta")
      .eq("scope", "agency")
      .limit(1)
      .maybeSingle();
    const accountMap = (metaRow?.meta as { accountMap?: Record<string, unknown> } | null)?.accountMap ?? {};
    const mappedSlug = Object.keys(accountMap).find((slug) => accountMap[slug]);
    test.skip(!mappedSlug, "nenhum cliente mapeado encontrado");

    const { data: client } = await sb.from("clients").select("name").eq("slug", mappedSlug!).single();

    await login(page);
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/admin/performance/insights") && res.request().method() === "GET",
      { timeout: 90_000 },
    );
    await page.goto("/admin/performance");
    await responsePromise;

    const filterResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/admin/performance/insights") && res.url().includes(`client=${mappedSlug}`),
      { timeout: 60_000 },
    );
    await page.getByRole("combobox").filter({ hasText: "Todos os clientes" }).selectOption({ label: client?.name ?? mappedSlug! });
    const filterRes = await filterResponsePromise;
    const filterBody = (await filterRes.json()) as InsightsResponse;
    expect(filterRes.ok(), `insights request failed for client=${mappedSlug}: ${JSON.stringify(filterBody)}`).toBe(true);
    expect(filterBody.demo).toBe(false);
  });
});
