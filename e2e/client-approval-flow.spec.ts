import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Real end-to-end coverage of the client-side approval flow (Feedbacks page,
// /karpinski#feedbacks) against the live Supabase backend — no mocks. Seeds
// real `tasks` rows with a service-role client, drives the real UI as the
// real karpinski client login, then asserts both the UI and the resulting DB
// state. Cleans up everything it creates.

const CLIENT_SLUG = "karpinski";
const CLIENT_EMAIL = "cliente@karpinski.com";
const CLIENT_PASSWORD = "SenhaForte123!";
const RUN_TAG = Date.now();

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key);
}

// The client account this suite logs in as (CLIENT_EMAIL) is the 'gerente'
// level profile — karpinski also has a 'usuario' (colaborador) account now
// that multi-level client access exists, so this must pick the gerente one
// specifically rather than assuming a single client profile per client_id.
async function getKarpinskiIds(supabase: SupabaseClient) {
  const { data: client, error: clientError } = await supabase
    .from("clients").select("id").eq("slug", CLIENT_SLUG).single();
  if (clientError || !client) throw new Error(`client '${CLIENT_SLUG}' not found: ${clientError?.message}`);
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("id").eq("client_id", client.id).eq("role", "client").eq("level", "gerente").single();
  if (profileError || !profile) throw new Error(`client gerente profile for '${CLIENT_SLUG}' not found: ${profileError?.message}`);
  return { clientId: client.id as string, reviewerId: profile.id as string };
}

async function seedTask(
  supabase: SupabaseClient,
  clientId: string,
  overrides: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({ client_id: clientId, kind: "criativo", client_visible: true, ...overrides })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed task failed: ${error?.message}`);
  return data.id as string;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(CLIENT_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(CLIENT_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(new RegExp(`/${CLIENT_SLUG}`), { timeout: 15_000 });
}

test.describe("Feedbacks do cliente — fluxo de aprovação (e2e contra o backend real)", () => {
  let supabase: SupabaseClient;
  let clientId: string;
  let reviewerId: string;
  let approveId: string;
  let adjustId: string;
  let notPendingId: string;

  const approveTitle = `[e2e ${RUN_TAG}] Aprovar entrega`;
  const adjustTitle = `[e2e ${RUN_TAG}] Solicitar ajuste`;
  const notPendingTitle = `[e2e ${RUN_TAG}] Ainda em revisão`;

  test.beforeAll(async () => {
    supabase = serviceClient();
    ({ clientId, reviewerId } = await getKarpinskiIds(supabase));
    approveId = await seedTask(supabase, clientId, {
      title: approveTitle, status: "aprovacao", approver_id: reviewerId,
      description: "Card seedado pelo teste e2e — aprovar.",
    });
    adjustId = await seedTask(supabase, clientId, {
      title: adjustTitle, status: "aprovacao", approver_id: reviewerId,
      description: "Card seedado pelo teste e2e — pedir ajuste.",
    });
    notPendingId = await seedTask(supabase, clientId, {
      title: notPendingTitle, status: "revisao",
      description: "Ainda em revisão interna — não deve aparecer em Feedbacks.",
    });
  });

  test.afterAll(async () => {
    await supabase.from("tasks").delete().in("id", [approveId, adjustId, notPendingId]);
  });

  test("só cards em 'aprovacao' aparecem na fila; um card em 'revisao' não aparece", async ({ page }) => {
    await login(page);
    await page.goto(`/${CLIENT_SLUG}#feedbacks`);
    await expect(page.getByText(approveTitle)).toBeVisible();
    await expect(page.getByText(adjustTitle)).toBeVisible();
    await expect(page.getByText(notPendingTitle)).toHaveCount(0);
  });

  test("Aprovar entrega move o card para 'aprovado' e ele sai da fila de pendentes", async ({ page }) => {
    await login(page);
    await page.goto(`/${CLIENT_SLUG}#feedbacks`);
    const card = page.locator(".np-approval", { hasText: approveTitle });
    await card.getByRole("button", { name: "Aprovar entrega" }).click();
    await expect(page.getByText("Entrega aprovada.")).toBeVisible();
    // The card only disappears once the background "quiet" refetch (real
    // network round-trip to Supabase, not mocked) resolves — give it room.
    await expect(page.locator(".np-approval", { hasText: approveTitle })).toHaveCount(0, { timeout: 10_000 });

    await expect.poll(async () => {
      const { data } = await supabase.from("tasks").select("status").eq("id", approveId).single();
      return data?.status;
    }, { timeout: 10_000 }).toBe("aprovado");
  });

  test("Solicitar ajustes exige um comentário, mantém o card em 'aprovacao' (mesma coluna) e anexa o feedback nele", async ({ page }) => {
    await login(page);
    await page.goto(`/${CLIENT_SLUG}#feedbacks`);
    const card = page.locator(".np-approval", { hasText: adjustTitle });
    await card.getByRole("button", { name: "Solicitar ajustes" }).click();

    const modal = page.locator(".np-modal");
    await expect(modal).toBeVisible();
    const submit = modal.getByRole("button", { name: /Enviar ajuste/ });
    await expect(submit).toBeDisabled();

    const commentText = `Ajustar o rodapé conforme a marca — ${RUN_TAG}`;
    await modal.locator("textarea").fill(commentText);
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText("Ajuste enviado ao time North.")).toBeVisible();
    // The card stays put (it does NOT leave the pending queue) — only the
    // comment gets attached, visible right on the card for the admin team.
    await expect(page.locator(".np-approval", { hasText: adjustTitle })).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator(".np-approval", { hasText: adjustTitle }).getByText(commentText)).toBeVisible();

    await expect.poll(async () => {
      const { data } = await supabase.from("tasks").select("status").eq("id", adjustId).single();
      return data?.status;
    }, { timeout: 10_000 }).toBe("aprovacao");

    const { data } = await supabase.from("tasks").select("payload").eq("id", adjustId).single();
    const comments = (data?.payload as { comments?: { text: string }[] } | null)?.comments ?? [];
    expect(comments.some((c) => c.text === commentText)).toBe(true);
  });
});
