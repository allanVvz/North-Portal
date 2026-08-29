import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// End-to-end coverage of the Plano de Ação model against the live backend:
// seeds one plan per client (Karpinski + Baita), each with real member
// activities, then logs in as an admin, opens /admin/plano and asserts both
// plans render with the correct rolled-up progress and their activities. Cleans
// up everything it creates.

const RUN = Date.now();

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key);
}

async function clientIdBySlug(sb: SupabaseClient, slug: string): Promise<string> {
  const { data, error } = await sb.from("clients").select("id").eq("slug", slug).single();
  if (error || !data) throw new Error(`client '${slug}' not found: ${error?.message}`);
  return data.id as string;
}

type MemberSeed = { kind: string; status: string };

async function seedPlan(sb: SupabaseClient, clientId: string, title: string, members: MemberSeed[]): Promise<string[]> {
  const { data: plan, error: planErr } = await sb
    .from("tasks")
    .insert({ client_id: clientId, kind: "plano_acao", title, status: "em_producao", client_visible: true, start_date: "2026-07-06", end_date: "2026-07-11" })
    .select("id")
    .single();
  if (planErr || !plan) throw new Error(`seed plan failed: ${planErr?.message}`);
  const ids = [plan.id as string];
  for (const [i, m] of members.entries()) {
    const { data: mem, error: memErr } = await sb
      .from("tasks")
      .insert({ client_id: clientId, kind: m.kind, title: `${title} · ativ ${i + 1}`, status: m.status, client_visible: true })
      .select("id")
      .single();
    if (memErr || !mem) throw new Error(`seed member failed: ${memErr?.message}`);
    // Membership virou elo em `task_links`; `plan_id` hoje significa apenas
    // "ocorrência de recorrência". Semear pelo campo antigo faria as atividades
    // simplesmente não aparecerem no plano.
    const { error: linkErr } = await sb.from("task_links").insert({ parent_id: plan.id, child_id: mem.id, position: i });
    if (linkErr) throw new Error(`seed link failed: ${linkErr.message}`);
    ids.push(mem.id as string);
  }
  return ids;
}

test.describe("Planos de Ação — dois clientes (e2e contra o backend real)", () => {
  let sb: SupabaseClient;
  let seededIds: string[] = [];
  // Karpinski: criativo em_producao (30%) + criativo concluido (100%) => 65%
  const planKarp = `[e2e ${RUN}] Plano Karpinski`;
  // Baita: agendamento aprovacao (80%) + operacional concluido (100%) => 90%
  const planBaita = `[e2e ${RUN}] Plano Baita`;

  test.beforeAll(async () => {
    sb = serviceClient();
    const karpId = await clientIdBySlug(sb, "karpinski");
    const baitaId = await clientIdBySlug(sb, "baita-conveniencia");
    const a = await seedPlan(sb, karpId, planKarp, [
      { kind: "criativo", status: "em_producao" },
      { kind: "criativo", status: "concluido" },
    ]);
    const b = await seedPlan(sb, baitaId, planBaita, [
      { kind: "agendamento", status: "aprovacao" },
      { kind: "operacional", status: "concluido" },
    ]);
    seededIds = [...a, ...b];
  });

  test.afterAll(async () => {
    if (seededIds.length) await sb.from("tasks").delete().in("id", seededIds);
  });

  test("ambos os planos aparecem em /admin/plano com o progresso rollado correto", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("voce@empresa.com").fill(ADMIN_EMAIL);
    await page.getByPlaceholder("Sua senha").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /Entrar/ }).click();
    await page.waitForURL(/\/admin/, { timeout: 15_000 });

    await page.goto("/admin/plano");
    // Lista is the default view, but click it explicitly so this regression
    // test keeps asserting the accordion structure even if the default moves.
    await page.getByRole("button", { name: "Lista", exact: true }).click();

    // Karpinski plan: header shows 65%, expanding lists its 2 activities.
    const karpItem = page.locator(".plan-acc-item", { hasText: planKarp });
    await expect(karpItem).toBeVisible();
    await expect(karpItem.locator(".plan-acc-progress b")).toHaveText("65%");
    await karpItem.getByRole("button", { name: "Expandir" }).click();
    await expect(karpItem.locator(".plan-acc-list li")).toHaveCount(2);

    // Baita plan: 90%.
    const baitaItem = page.locator(".plan-acc-item", { hasText: planBaita });
    await expect(baitaItem).toBeVisible();
    await expect(baitaItem.locator(".plan-acc-progress b")).toHaveText("90%");
    await baitaItem.getByRole("button", { name: "Expandir" }).click();
    await expect(baitaItem.locator(".plan-acc-list li")).toHaveCount(2);
  });
});
