import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// Bug relatado: abrir um card por link direto (o que "🔗 Copiar link" e o
// NorthAi geram) fazia a sidebar acender "Clientes" em vez de "Operação", e ao
// fechar o modal a tela ficava incoerente — /admin/operacao tinha virado
// /admin/kanban por baixo (mesmo componente, KanbanBoard.tsx, montado em duas
// rotas; a rota "real" era decidida por um literal fixo, não pela rota atual).
// Ver app/admin/navActive.ts e o efeito de deep-link em KanbanBoard.tsx.
//
// Os quatro casos abaixo são o critério de aceitação: URL, sidebar ativa e
// conteúdo têm que concordar sempre — abrindo por clique, pelo link novo
// (/admin/operacao?task=) e pelo link antigo (/admin/kanban?task=), e sem
// perder um filtro (`?situacao=`) que estivesse na URL.

const RUN = Date.now();
const PREFIX = `[e2e ${RUN}]`;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Entrar/ }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

function activeNavHref(page: Page) {
  return page.locator("a.admin-nav-item.active").first().getAttribute("href");
}

test.describe("Abrir um card não pode trocar o módulo ativo da sidebar", () => {
  test.setTimeout(90_000);
  let sb: SupabaseClient;
  let taskId = "";

  test.beforeAll(async () => {
    sb = serviceClient();
    const { data: client, error } = await sb.from("clients").select("id").eq("slug", "karpinski").single();
    if (error || !client) throw new Error(`cliente karpinski não encontrado: ${error?.message}`);
    const { data, error: insErr } = await sb
      .from("tasks")
      .insert({ client_id: client.id, kind: "operacional", title: `${PREFIX} card`, status: "em_producao", payload: {} })
      .select("id")
      .single();
    if (insErr || !data) throw new Error(`seed falhou: ${insErr?.message}`);
    taskId = data.id;
  });

  test.afterAll(async () => {
    await sb.from("tasks").delete().like("title", `${PREFIX}%`);
  });

  test("clique em Operação: abrir e fechar mantêm a aba e a sidebar", async ({ page }) => {
    await login(page);
    await page.goto("/admin/operacao");
    await expect(activeNavHref(page)).resolves.toBe("/admin/operacao");

    await page.getByText(`${PREFIX} card`, { exact: false }).first().click();
    await expect(page.locator(".tm")).toBeVisible({ timeout: 20_000 });
    await expect(activeNavHref(page)).resolves.toBe("/admin/operacao");
    expect(new URL(page.url()).pathname).toBe("/admin/operacao");

    await page.locator(".kb-modal-close").click();
    await expect(page.locator(".tm")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/admin/operacao");
    await expect(activeNavHref(page)).resolves.toBe("/admin/operacao");
    await expect(page.locator(".clients-section-tabs")).toBeVisible();
  });

  test("link novo /admin/operacao?task=: abre, tira só o task da URL, mantém situacao", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/operacao?situacao=atrasada&task=${taskId}`);
    await expect(page.locator(".tm")).toBeVisible({ timeout: 20_000 });
    await expect(activeNavHref(page)).resolves.toBe("/admin/operacao");

    await expect.poll(() => new URL(page.url()).searchParams.get("task")).toBeNull();
    expect(new URL(page.url()).searchParams.get("situacao")).toBe("atrasada");
    expect(new URL(page.url()).pathname).toBe("/admin/operacao");

    await page.locator(".kb-modal-close").click();
    expect(new URL(page.url()).pathname).toBe("/admin/operacao");
    await expect(activeNavHref(page)).resolves.toBe("/admin/operacao");
  });

  test("link antigo /admin/kanban?task=: sidebar mostra Operação, não Clientes", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/kanban?task=${taskId}`);
    await expect(page.locator(".tm")).toBeVisible({ timeout: 20_000 });
    await expect(activeNavHref(page)).resolves.toBe("/admin/operacao");
    expect(new URL(page.url()).pathname).toBe("/admin/kanban");

    await page.locator(".kb-modal-close").click();
    await expect(page.locator(".tm")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/admin/kanban");
    await expect(activeNavHref(page)).resolves.toBe("/admin/operacao");
  });
});
