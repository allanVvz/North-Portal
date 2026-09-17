import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

const RUN = Date.now();
const PREFIX = `[e2e family ${RUN}]`;

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

test("TaskModal mostra reference como contexto, fora do progresso", async ({ page }) => {
  test.setTimeout(90_000);
  const sb = serviceClient();
  const { data: client, error: clientError } = await sb.from("clients").select("id").eq("slug", "karpinski").single();
  if (clientError || !client) throw new Error(`cliente karpinski não encontrado: ${clientError?.message}`);

  let parentId = "";
  let childId = "";
  try {
    const { data: parent, error: parentError } = await sb
      .from("tasks")
      .insert({ client_id: client.id, kind: "operacional", title: `${PREFIX} contexto`, status: "backlog", payload: {} })
      .select("id")
      .single();
    if (parentError || !parent) throw new Error(`seed do contexto falhou: ${parentError?.message}`);
    parentId = parent.id;

    const { data: child, error: childError } = await sb
      .from("tasks")
      .insert({ client_id: client.id, kind: "operacional", title: `${PREFIX} trabalho`, status: "em_producao", payload: {} })
      .select("id")
      .single();
    if (childError || !child) throw new Error(`seed do trabalho falhou: ${childError?.message}`);
    childId = child.id;

    const { error: linkError } = await sb
      .from("task_links")
      .insert({ parent_id: parentId, child_id: childId, relation_kind: "reference", slot: null, position: 0 });
    if (linkError) throw new Error(`seed da referência falhou: ${linkError.message}`);

    await login(page);
    await page.goto(`/admin/operacao?task=${childId}`);
    await expect(page.locator(".tm")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Relacionado a", { exact: true })).toBeVisible();
    const modal = page.locator(".tm");
    await expect(modal.getByText(`${PREFIX} contexto`, { exact: true })).toBeVisible();
    await expect(modal.getByText("Referência · fora do progresso", { exact: true })).toBeVisible();
  } finally {
    if (childId) await sb.from("tasks").delete().eq("id", childId);
    if (parentId) await sb.from("tasks").delete().eq("id", parentId);
  }
});
