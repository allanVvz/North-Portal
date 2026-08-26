import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// End-to-end coverage of the rebuilt "Cadastrar cliente" screen against the
// real backend: the company/contract cards persist to their new tables, the
// escopo chips (including a tag created inline) land in client_contract.escopo,
// only the selected checkpoints become cards, and the kickoff card shows up on
// the Kanban. Cleans up everything it creates.

const ADMIN_EMAIL = "admin@north.com";
const ADMIN_PASSWORD = "SenhaForte123!";
const RUN = Date.now();
const SLUG = `e2e-cadastro-${RUN}`;
const NAME = `[e2e ${RUN}] Cadastro v2`;
const CLIENT_EMAIL = `${SLUG}@north.test`;
const NEW_TAG = `E2E Tag ${RUN}`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key);
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
}

test.describe("Cadastro de cliente v2", () => {
  // Each route is compiled on first hit by the dev server, which alone can eat
  // the default 30s budget.
  test.describe.configure({ timeout: 120_000 });

  let sb: SupabaseClient;
  let clientId = "";

  test.beforeAll(() => {
    sb = serviceClient();
  });

  test.afterAll(async () => {
    if (clientId) await sb.from("clients").delete().eq("id", clientId);
    await sb.from("scope_tags").delete().eq("label", NEW_TAG);
    const { data } = await sb.auth.admin.listUsers({ perPage: 200 });
    const user = data?.users?.find((u) => u.email === CLIENT_EMAIL);
    if (user) await sb.auth.admin.deleteUser(user.id);
  });

  test("persiste empresa, contrato, escopo e checkpoints escolhidos", async ({ page }) => {
    await login(page);
    await page.goto("/admin/novo");

    await page.getByPlaceholder("Baita Conveniência").fill(NAME);
    await page.getByPlaceholder("baita-conveniencia").fill(SLUG);
    await page.getByPlaceholder("Conveniência, bar, delivery").fill("Automotivo");
    await page.getByPlaceholder("Ponta Grossa / PR").fill("Curitiba / PR");
    await page.getByPlaceholder("@baita").fill("@e2e_cadastro");

    // Plano + escopo, including a tag created from the chip row.
    await page.getByRole("button", { name: "Growth", exact: true }).click();
    await page.getByRole("button", { name: "Criativos", exact: true }).click();
    await page.getByRole("button", { name: /Carrossé/ }).click();
    await page.getByRole("button", { name: "+ Nova tag" }).click();
    await page.getByPlaceholder("Nome da tag").fill(NEW_TAG);
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByRole("button", { name: NEW_TAG })).toHaveAttribute("aria-pressed", "true");

    await page.getByPlaceholder("R$ 3.200").fill("R$ 4.500");
    await page.getByPlaceholder("Nome do contato").fill("Contato E2E");
    await page.getByPlaceholder("(00) 00000-0000").fill("(41) 90000-0000");

    // Drop the one optional checkpoint so we can prove the selection is honored.
    const kickoff = page.getByRole("button", { name: /Kickoff e onboarding/ });
    await expect(kickoff).toHaveAttribute("aria-pressed", "true");
    await kickoff.click();
    await expect(kickoff).toHaveAttribute("aria-pressed", "false");

    await page.getByPlaceholder("cliente@empresa.com").first().fill(CLIENT_EMAIL);
    await page.getByRole("button", { name: /Criar cliente/ }).click();
    await expect(page.getByRole("heading", { name: "Cliente criado" })).toBeVisible({ timeout: 20_000 });

    // ---- assert against the real database ----
    const { data: client } = await sb.from("clients").select("id,name").eq("slug", SLUG).single();
    expect(client).toBeTruthy();
    clientId = client!.id as string;

    const { data: company } = await sb
      .from("client_company_info")
      .select("segmento,cidade_uf,instagram_ou_site")
      .eq("client_id", clientId)
      .single();
    expect(company).toMatchObject({
      segmento: "Automotivo",
      cidade_uf: "Curitiba / PR",
      instagram_ou_site: "@e2e_cadastro",
    });

    const { data: contract } = await sb
      .from("client_contract")
      .select("plano_tier,escopo,valor_mensal,responsavel_nome")
      .eq("client_id", clientId)
      .single();
    expect(contract!.plano_tier).toBe("growth");
    expect(Number(contract!.valor_mensal)).toBe(4500);
    expect(contract!.responsavel_nome).toBe("Contato E2E");
    const keys = (contract!.escopo as { key: string; quantity?: number }[]).map((s) => s.key);
    expect(keys).toContain("criativos");
    expect(keys).toContain("carrosseis");
    expect(keys.length).toBe(3); // criativos + carrosseis + the tag created inline

    // Checkpoints: required ones only, since Kickoff was unselected.
    const { data: checkpoints } = await sb
      .from("tasks")
      .select("title")
      .eq("client_id", clientId)
      .eq("kind", "checkpoint_comercial");
    const titles = (checkpoints ?? []).map((c) => c.title as string);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles).not.toContain("Kickoff e onboarding");

    // The kickoff card is the "card no Kanban" half of the AO CRIAR checklist.
    const { data: kickoffCard } = await sb
      .from("tasks")
      .select("title,kind,subtype,client_visible")
      .eq("client_id", clientId)
      .eq("kind", "planejamento")
      .single();
    expect(kickoffCard).toMatchObject({ subtype: "briefing", client_visible: false });
  });

  test("mostra os novos campos já preenchidos na edição", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/${SLUG}`);
    await expect(page.getByPlaceholder("Conveniência, bar, delivery")).toHaveValue("Automotivo");
    await expect(page.getByRole("button", { name: "Growth", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByPlaceholder("Nome do contato")).toHaveValue("Contato E2E");
  });
});
