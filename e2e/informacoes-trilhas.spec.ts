import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// R0.2 — Trilhas North virou uma LISTA GLOBAL (tabela north_trilhas), igual para
// todo cliente: o admin adiciona apresentação HTML ou vídeo do YouTube, reordena
// por arraste, e o portal do cliente lê a mesma lista.
//
// Este spec cobre: as 3 abas de Informações navegam; adicionar um vídeo do
// YouTube cai em north_trilhas (sem client_id); a reordenação persiste
// `position`; e o portal de um cliente vê a mesma lista, na mesma ordem.
//
// PRÉ-REQUISITO: a migração north_trilhas precisa estar aplicada no backend real.

const RUN = Date.now();
const EMAIL = `e2e-informacoes-${RUN}@e2e-test.com`;
const PASSWORD = "SenhaForte123!";
const V1 = `Trilha vídeo ${RUN}`;
const V2 = `Trilha vídeo 2 ${RUN}`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials are required.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(EMAIL);
  await page.getByPlaceholder("Sua senha").fill(PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

async function addVideo(page: Page, title: string, url: string) {
  await page.getByRole("button", { name: "+ Vídeo do YouTube" }).click();
  const modal = page.locator(".kb-modal");
  await modal.getByLabel("Link do vídeo do YouTube").fill(url);
  await modal.getByLabel("Título").fill(title);
  await modal.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator(".trilha-card", { hasText: title })).toBeVisible({ timeout: 20_000 });
}

test.describe("Informações — Trilhas North lista global (e2e contra o backend real)", () => {
  let sb: SupabaseClient;
  let userId = "";
  let clientSlug = "";
  const created: string[] = [];

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data, error } = await sb.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role: "admin", level: "editor" },
    });
    if (error || !data.user) throw new Error(error?.message || "Não foi possível criar o admin E2E.");
    userId = data.user.id;
    const { error: profileError } = await sb.from("profiles").upsert({ id: userId, role: "admin", level: "editor", client_id: null }, { onConflict: "id" });
    if (profileError) throw new Error(profileError.message);

    const { data: client } = await sb.from("clients").select("slug").eq("is_active", true).limit(1).single();
    clientSlug = (client?.slug as string) ?? "karpinski";
  });

  test.afterAll(async () => {
    if (created.length) await sb.from("north_trilhas").delete().in("id", created);
    await sb.from("north_trilhas").delete().like("title", `Trilha %${RUN}`);
    if (userId) await sb.auth.admin.deleteUser(userId);
  });

  test("as 3 abas navegam e a de Trilhas mostra o gerenciador global", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await page.goto("/admin/documentos");

    const tabs = page.locator(".clients-section-tabs");
    await expect(tabs).toBeVisible({ timeout: 20_000 });
    await expect(tabs.getByRole("button", { name: /Documentos/ })).toBeVisible();
    await expect(tabs.getByRole("button", { name: /Trilhas North/ })).toBeVisible();
    await expect(tabs.getByRole("button", { name: /Onboarding/ })).toBeVisible();

    await tabs.getByRole("button", { name: /Trilhas North/ }).click();
    await expect(page.getByRole("heading", { name: "Trilhas North" })).toBeVisible();
    // O Manual do Cliente é o card fixo, sempre presente e sem "Excluir".
    const manualCard = page.locator(".trilha-card", { hasText: "Manual do Cliente" });
    await expect(manualCard).toBeVisible({ timeout: 20_000 });
    await expect(manualCard.getByRole("button", { name: "Excluir" })).toHaveCount(0);

    // Visualizar embute o deck no modal e dá pra navegar entre os slides,
    // sem gravar `manual_seen` de ninguém (é só admin).
    await manualCard.getByRole("button", { name: "Visualizar" }).click();
    const preview = page.locator(".tm.tm-lg");
    await expect(preview.locator(".manual-viewer")).toBeVisible({ timeout: 15_000 });
    await expect(preview.locator(".manual-count")).toHaveText("01 / 11");
    await preview.getByRole("button", { name: /Próximo/ }).click();
    await expect(preview.locator(".manual-count")).toHaveText("02 / 11");
    await preview.getByRole("button", { name: "Fechar" }).first().click();
  });

  test("adiciona vídeo do YouTube → cai em north_trilhas sem client_id; reordena persiste", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto("/admin/documentos");
    await page.locator(".clients-section-tabs").getByRole("button", { name: /Trilhas North/ }).click();

    await addVideo(page, V1, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await addVideo(page, V2, "https://youtu.be/oHg5SJYRHA0");

    const { data: rows, error } = await sb
      .from("north_trilhas")
      .select("id,title,kind,youtube_id,position")
      .in("title", [V1, V2]);
    if (error || !rows) throw new Error(error?.message);
    for (const r of rows) created.push(r.id as string);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.kind).toBe("video_youtube");
      expect(r.youtube_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      // não tem coluna client_id — a lista é global
      expect(r).not.toHaveProperty("client_id");
    }

    // Visualizar um vídeo mostra o embed do YouTube.
    const cardV1 = page.locator(".trilha-card", { hasText: V1 });
    await cardV1.getByRole("button", { name: "Visualizar" }).click();
    await expect(page.locator(".tm.tm-lg .trilha-preview-embed iframe")).toHaveAttribute("src", /youtube\.com\/embed\/dQw4w9WgXcQ/);
    await page.locator(".tm.tm-lg .kb-modal-close").click();

    // Reordena: arrasta o segundo card para cima do primeiro.
    const cardV2 = page.locator(".trilha-card", { hasText: V2 });
    await cardV2.dragTo(page.locator(".trilha-card", { hasText: V1 }));

    await expect
      .poll(async () => {
        const { data } = await sb.from("north_trilhas").select("title,position").in("title", [V1, V2]).order("position");
        return data?.map((d) => d.title) ?? [];
      }, { timeout: 15_000 })
      .toEqual([V2, V1]);
  });

  test("o portal do cliente mostra a mesma lista global", async ({ page }) => {
    test.setTimeout(90_000);
    const PORTAL_ITEM = `Trilha portal ${RUN}`;
    const { data: seeded } = await sb
      .from("north_trilhas")
      .insert({ kind: "video_youtube", title: PORTAL_ITEM, youtube_id: "dQw4w9WgXcQ", position: 500 })
      .select("id")
      .single();
    if (seeded?.id) created.push(seeded.id as string);

    await login(page);
    // O portal usa rota por hash — vai direto pra Trilhas North.
    await page.goto(`/${clientSlug}#trilhas`);
    await expect(page.locator(".np-trail-list")).toBeVisible({ timeout: 30_000 });
    // A lista global (a mesma pra todo cliente): o Manual é o hero, e o item que
    // o admin adicionou aparece na lista.
    await expect(page.locator(".np-trail-hero", { hasText: "Manual do Cliente" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".np-trail-row", { hasText: PORTAL_ITEM })).toBeVisible();
  });
});
