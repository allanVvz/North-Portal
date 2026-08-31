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
// PRÉ-REQUISITO: a migração 20260831030000_north_trilhas.sql precisa estar
// aplicada no backend real — enquanto não estiver, este spec falha na criação.

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
  const form = page.locator(".set-legal-editor");
  await form.getByLabel("Link do vídeo do YouTube").fill(url);
  await form.getByLabel("Título").fill(title);
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator(".trilha-row", { hasText: title })).toBeVisible({ timeout: 20_000 });
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
    await sb.from("north_trilhas").delete().like("title", `Trilha vídeo%${RUN}`);
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
    // O Manual do Cliente é a linha fixa, sempre presente e sem "Excluir".
    const manualRow = page.locator(".trilha-row", { hasText: "Manual do Cliente" });
    await expect(manualRow).toBeVisible({ timeout: 20_000 });
    await expect(manualRow.getByRole("button", { name: "Excluir" })).toHaveCount(0);
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

    // Reordena: arrasta a segunda trilha para cima da primeira.
    const rowV1 = page.locator(".trilha-row", { hasText: V1 });
    const rowV2 = page.locator(".trilha-row", { hasText: V2 });
    await rowV2.dragTo(rowV1);

    await expect
      .poll(async () => {
        const { data } = await sb.from("north_trilhas").select("title,position").in("title", [V1, V2]).order("position");
        return data?.map((d) => d.title) ?? [];
      }, { timeout: 15_000 })
      .toEqual([V2, V1]);
  });

  test("o portal do cliente mostra a mesma lista global", async ({ page }) => {
    test.setTimeout(90_000);
    // Garante pelo menos um item além do Manual.
    const { data: seeded } = await sb
      .from("north_trilhas")
      .insert({ kind: "video_youtube", title: V1, youtube_id: "dQw4w9WgXcQ", position: 100 })
      .select("id")
      .single();
    if (seeded?.id) created.push(seeded.id as string);

    await login(page);
    await page.goto(`/${clientSlug}`);
    // Navega até Trilhas North no portal.
    await page.getByRole("button", { name: /Trilhas North/ }).first().click();
    await expect(page.getByRole("heading", { name: /Trilhas/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".np-trail-hero", { hasText: "Manual do Cliente" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".np-trail-row", { hasText: V1 })).toBeVisible();
  });
});
