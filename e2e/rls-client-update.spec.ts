import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./adminAuth";

// R7.2 — o que a RLS de UPDATE em `tasks` deixa um CLIENTE fazer.
//
// A tela do portal oferece exatamente duas ações num card em "aprovacao":
// aprovar (vai para "aprovado") ou pedir ajustes (não move o card, só anexa o
// comentário) — ver app/api/client/[slug]/tasks/[id]/route.ts. A rota confere
// isso, mas a rota não é a única porta: o cliente tem um token válido do
// Supabase e pode falar com o PostgREST direto, sem passar por ela. Quem
// decide ali é só a policy.
//
// E a policy decidia de menos. O `using` dizia QUAIS linhas ele alcança (só as
// em "aprovacao", e só sendo o aprovador ou gerente da conta); o `with check`
// decide o ESTADO NOVO e só olhava a posse do cliente. Com isso, um card em
// aprovação podia ser levado a qualquer status pelo próprio cliente — inclusive
// "aprovado" sem ser o aprovador... não, esse o `using` barra; mas voltar para
// "backlog", ou pular para "revisao", passava.
//
// Este spec não usa navegador de propósito: ele fala com o banco pelo mesmo
// caminho que um cliente mal-intencionado usaria.

const CLIENT_SLUG = "karpinski";
const RUN = Date.now();
const EMAIL = `e2e-rls-${RUN}@e2e-test.com`;
const PASSWORD = "SenhaForte123!";

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local).");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Um client anônimo autenticado — é o que o navegador de um cliente tem na
 * mão, e é com ele que a RLS é a única guarda. */
async function signedIn(email: string, password: string): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set (.env.local).");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`falha ao autenticar ${email}: ${error.message}`);
  return client;
}

test.describe("RLS de UPDATE em tasks — o que um cliente alcança pelo PostgREST", () => {
  let sb: SupabaseClient;
  let clientSb: SupabaseClient;
  let userId = "";
  let taskId = "";

  test.beforeAll(async () => {
    sb = serviceClient();

    const { data: client, error: clientError } = await sb.from("clients").select("id").eq("slug", CLIENT_SLUG).single();
    if (clientError || !client) throw new Error(`cliente '${CLIENT_SLUG}' não encontrado: ${clientError?.message}`);

    const { data: created, error: createError } = await sb.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role: "client", client_slug: CLIENT_SLUG, level: "usuario" },
    });
    if (createError || !created.user) throw new Error(`falha ao criar usuário e2e: ${createError?.message}`);
    userId = created.user.id;

    // Nível `usuario`, não `gerente`: assim o acesso vem de ser o APROVADOR do
    // card, que é o caminho estreito — um gerente alcançaria o card por outro
    // ramo do `using` e o teste ficaria menos específico.
    const { error: profileError } = await sb.from("profiles").upsert(
      { id: userId, role: "client", level: "usuario", client_id: client.id, full_name: `E2E RLS ${RUN}` },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(`falha ao preparar profile e2e: ${profileError.message}`);

    const { data: task, error: taskError } = await sb
      .from("tasks")
      .insert({
        client_id: client.id,
        kind: "operacional",
        title: `[e2e rls ${RUN}] card aguardando aprovação`,
        status: "aprovacao",
        approver_id: userId,
        client_visible: true,
      })
      .select("id")
      .single();
    if (taskError || !task) throw new Error(`falha ao criar card e2e: ${taskError?.message}`);
    taskId = task.id as string;

    clientSb = await signedIn(EMAIL, PASSWORD);
  });

  test.afterAll(async () => {
    if (taskId) await sb.from("tasks").delete().eq("id", taskId);
    if (userId) await sb.auth.admin.deleteUser(userId);
  });

  async function statusNow(): Promise<string> {
    const { data } = await sb.from("tasks").select("status").eq("id", taskId).single();
    return (data?.status as string) ?? "";
  }

  test("o cliente NÃO consegue levar o card para um status que a tela não oferece", async () => {
    // A tela dá duas saídas: aprovar, ou comentar sem mover. Nenhum botão manda
    // um card de volta para backlog, para revisão, ou para 'parada'.
    for (const status of ["backlog", "em_producao", "revisao", "parada"]) {
      const { error } = await clientSb.from("tasks").update({ status }).eq("id", taskId);
      expect(error, `a policy deveria recusar status='${status}' vindo do cliente`).not.toBeNull();
      // 42501 = new row violates row-level security policy.
      expect(error?.code).toBe("42501");
      expect(await statusNow()).toBe("aprovacao");
    }
  });

  test("pedir ajustes continua funcionando: comenta sem mover o card", async () => {
    const { error } = await clientSb
      .from("tasks")
      .update({ payload: { comments: [{ author: "Cliente e2e", text: "faltou o logo", at: new Date().toISOString() }] } })
      .eq("id", taskId);
    expect(error).toBeNull();
    expect(await statusNow()).toBe("aprovacao");
  });

  test("aprovar continua funcionando: aprovacao → aprovado", async () => {
    const { error } = await clientSb.from("tasks").update({ status: "aprovado" }).eq("id", taskId);
    expect(error).toBeNull();
    expect(await statusNow()).toBe("aprovado");

    // E, aprovado o card, o cliente perde o alcance: o `using` só entrega
    // linhas em 'aprovacao', então não dá para desaprovar depois.
    const { error: reopen } = await clientSb.from("tasks").update({ status: "aprovacao" }).eq("id", taskId);
    // Sem linha alcançável o PostgREST não erra — simplesmente não atualiza nada.
    expect(reopen).toBeNull();
    expect(await statusNow()).toBe("aprovado");
  });

  test("o admin não foi afetado: continua movendo o card para onde quiser", async () => {
    const adminSb = await signedIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    const { error } = await adminSb.from("tasks").update({ status: "backlog" }).eq("id", taskId);
    expect(error).toBeNull();
    expect(await statusNow()).toBe("backlog");
  });
});
