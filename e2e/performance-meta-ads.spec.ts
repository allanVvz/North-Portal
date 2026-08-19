import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MetaPost } from "@/lib/windsor";

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
  posts: MetaPost[];
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
    const paid = body.posts.filter((post) => post.source === "paid");
    const hasMetric = (key: keyof MetaPost["metrics"]) => paid.some((post) => post.metrics[key] !== undefined);
    expect(paid.length, "esperava campanhas pagas reais no período").toBeGreaterThan(0);
    expect(paid.some((post) => post.platform === "instagram"), "esperava anúncios entregues no Instagram").toBe(true);
    for (const [key, label] of [
      ["alcance", "alcance"], ["impressoes", "impressões"], ["frequencia", "frequência"],
      ["custo", "investimento"], ["cliques", "cliques"], ["cliquesUnicos", "cliques únicos"],
      ["cliquesLink", "cliques no link"], ["ctr", "CTR"], ["cpc", "CPC"], ["cpm", "CPM"],
      ["engajamento", "engajamento"], ["likes", "reações/curtidas"], ["comentarios", "comentários"],
      ["compartilhamentos", "compartilhamentos"], ["salvos", "salvamentos"], ["videoViews", "views de vídeo"],
      ["mensagens", "conversas iniciadas"], ["leads", "leads"], ["compras", "compras"],
    ] as [keyof MetaPost["metrics"], string][]) {
      expect(hasMetric(key), `${label} de anúncios ausente`).toBe(true);
    }

    // UI: paid-only surface, real Instagram filter and engagement columns.
    await expect(page.locator(".perf-demo-chip")).toHaveCount(0);
    await expect(page.getByText("Investimento", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Instagram", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Engajamento", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Reações", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Comentários", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Instagram", exact: true }).click();
    await expect(page.locator(".perf-ads-table tbody tr").first()).toContainText("Instagram");
    const renderedRows = await page.locator(".perf-ads-table tbody tr").evaluateAll((rows) =>
      rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim() ?? "")),
    );
    expect(renderedRows.some((cells) => cells[7] && cells[7] !== "—"), "engajamento não renderizado na tabela").toBe(true);
    expect(renderedRows.some((cells) => cells[8] && cells[8] !== "—"), "reações não renderizadas na tabela").toBe(true);
    expect(renderedRows.some((cells) => cells[9] && cells[9] !== "—"), "comentários não renderizados na tabela").toBe(true);
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

// Personalization features on top of the same real Meta connection: custom
// date range, sortable/configurable "Campanhas" columns (shared prefs,
// gerente-only to persist), CSV export, and the ad-level drill-down. A
// gerente user is required here (not just "editor") because column/sort
// changes only persist to the shared site_settings row for that level.
test.describe("Performance · personalização da tela de Campanhas", () => {
  let sb: SupabaseClient;
  let userId = "";
  const GERENTE_EMAIL = `e2e-perf-personaliza-${RUN}@e2e-test.com`;

  test.beforeAll(async () => {
    sb = serviceClient();
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

    const { data: created, error: createError } = await sb.auth.admin.createUser({
      email: GERENTE_EMAIL,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role: "admin", level: "gerente" },
    });
    if (createError || !created.user) throw new Error(`falha ao criar gerente e2e: ${createError?.message}`);
    userId = created.user.id;
    const { error: profileError } = await sb.from("profiles").upsert(
      { id: userId, role: "admin", level: "gerente", client_id: null },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(`falha ao preparar profile e2e: ${profileError.message}`);
  });

  test.afterAll(async () => {
    if (userId) await sb.auth.admin.deleteUser(userId);
    // Reset the shared prefs row so this run never leaks state into a later one.
    await sb.from("site_settings").delete().eq("key", "performance_view_prefs");
  });

  async function loginGerente(page: Page): Promise<void> {
    await page.goto("/login");
    await page.getByPlaceholder("voce@empresa.com").fill(GERENTE_EMAIL);
    await page.getByPlaceholder("Sua senha").fill(PASSWORD);
    await page.getByRole("button", { name: /Entrar/ }).click();
    await page.waitForURL(/\/admin/, { timeout: 45_000 });
  }

  test("período customizado busca o intervalo escolhido", async ({ page }) => {
    test.setTimeout(120_000);
    await loginGerente(page);
    await page.goto("/admin/performance");
    await page.waitForResponse((res) => res.url().includes("/api/admin/performance/insights") && !res.url().includes("/insights/ads"), { timeout: 90_000 });

    const from = "2026-07-01";
    const to = "2026-07-10";
    const customResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/admin/performance/insights") && res.url().includes(`to=${to}`),
      { timeout: 60_000 },
    );
    await page.getByLabel("Período customizado: de", { exact: true }).fill(from);
    await page.getByLabel("Período customizado: até", { exact: true }).fill(to);
    const res = await customResponsePromise;
    expect(res.ok(), "requisição com período customizado falhou").toBe(true);
    // Custom range replaces the preset toggle — none of 7/30/90 stay highlighted
    // (scoped to the first .kb-modetoggle: the platform filter is a second one
    // further down and always has an "on" button of its own).
    const periodToggle = page.locator(".perf-filters > .kb-modetoggle").first();
    await expect(periodToggle.locator("button.on")).toHaveCount(0);
  });

  test("ordenar a tabela de Campanhas por uma coluna alterna asc/desc", async ({ page }) => {
    test.setTimeout(120_000);
    await loginGerente(page);
    await page.goto("/admin/performance");
    await page.waitForResponse((res) => res.url().includes("/api/admin/performance/insights") && !res.url().includes("/insights/ads"), { timeout: 90_000 });

    const header = page.getByRole("columnheader", { name: /Investimento/ });
    await expect(header).toBeVisible();
    // "Investimento" (custo) is the shared default sort column, so it may
    // already be sorted desc or asc depending on what a prior gerente last
    // set — read the starting state instead of assuming it, then assert the
    // click toggles to the opposite state and back.
    const initialSort = await header.getAttribute("aria-sort");
    const afterFirstClick = initialSort === "descending" ? "ascending" : "descending";
    await header.click();
    await expect(header).toHaveAttribute("aria-sort", afterFirstClick);
    const firstAfterOneClick = await page.locator(".perf-ads-table tbody tr").first().locator("td").allTextContents();
    // "Investimento" is now definitely the active sort column, so the second
    // click is a plain toggle of whatever the first click landed on.
    const afterSecondClick = afterFirstClick === "descending" ? "ascending" : "descending";
    await header.click();
    await expect(header).toHaveAttribute("aria-sort", afterSecondClick);
    const firstAfterTwoClicks = await page.locator(".perf-ads-table tbody tr").first().locator("td").allTextContents();
    expect(firstAfterOneClick).not.toEqual(firstAfterTwoClicks);
  });

  test("colunas configuráveis: ocultar uma coluna some da tabela e persiste no backend", async ({ page }) => {
    test.setTimeout(120_000);
    await loginGerente(page);
    await page.goto("/admin/performance");
    await page.waitForResponse((res) => res.url().includes("/api/admin/performance/insights") && !res.url().includes("/insights/ads"), { timeout: 90_000 });

    await expect(page.getByRole("columnheader", { name: "Leads", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Colunas/ }).click();
    const prefsSavedPromise = page.waitForResponse(
      (res) => res.url().includes("/api/admin/performance/prefs") && res.request().method() === "PUT",
      { timeout: 5_000 },
    );
    await page.locator(".perf-columns-item", { hasText: "Leads" }).locator("input[type=checkbox]").click();
    await prefsSavedPromise.catch(() => null); // debounced — may fire slightly after the click resolves
    await expect(page.getByRole("columnheader", { name: "Leads", exact: true })).toHaveCount(0);

    // Confirm it actually persisted server-side (shared across every viewer), not just local state.
    await expect(async () => {
      const res = await page.request.get("/api/admin/performance/prefs");
      const body = (await res.json()) as { visibleColumns: string[] };
      expect(body.visibleColumns).not.toContain("leads");
    }).toPass({ timeout: 5_000 });
  });

  test("exportar CSV dispara o download da tabela atual", async ({ page }) => {
    test.setTimeout(120_000);
    await loginGerente(page);
    await page.goto("/admin/performance");
    await page.waitForResponse((res) => res.url().includes("/api/admin/performance/insights") && !res.url().includes("/insights/ads"), { timeout: 90_000 });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^campanhas_.*\.csv$/);
  });

  test("expandir uma campanha da conexão direta com a Meta carrega o detalhamento por anúncio", async ({ page }) => {
    test.setTimeout(120_000);
    await loginGerente(page);
    await page.goto("/admin/performance");
    await page.waitForResponse((res) => res.url().includes("/api/admin/performance/insights") && !res.url().includes("/insights/ads"), { timeout: 90_000 });

    await page.locator(".perf-ads-table tbody tr").first().waitFor({ state: "attached", timeout: 15_000 });
    // Only rows sourced from the direct Meta connection (not Windsor) render
    // the expand indicator (they carry a real campaignId) — and the default
    // sort is by spend, so a Windsor-heavy account can push every direct-Meta
    // row past the first page. Page through "Carregar mais" before giving up.
    const expandableRow = page.locator(".perf-ads-table tbody tr").filter({ has: page.locator(".perf-expand-cell", { hasText: "▸" }) }).first();
    const loadMore = page.getByRole("button", { name: /^Carregar mais/ });
    let clicks = 0;
    while ((await expandableRow.count()) === 0 && (await loadMore.count()) > 0 && clicks < 30) {
      await loadMore.click();
      await page.waitForTimeout(300);
      clicks++;
    }
    test.skip((await expandableRow.count()) === 0, "nenhuma campanha com campaignId (conexão direta) no período, mesmo após paginar tudo");

    const adsResponsePromise = page.waitForResponse((res) => res.url().includes("/api/admin/performance/insights/ads"), { timeout: 60_000 });
    await expandableRow.click();
    const adsRes = await adsResponsePromise;
    expect(adsRes.ok(), "requisição de detalhamento por anúncio falhou").toBe(true);
    const adsBody = (await adsRes.json()) as { demo: boolean; stale: boolean; ads: unknown[] };
    expect(adsBody.demo, "detalhamento por anúncio caiu em modo demo com a Meta conectada").toBe(false);
    await expect(page.locator(".perf-ad-subrow")).toBeVisible();
  });
});
