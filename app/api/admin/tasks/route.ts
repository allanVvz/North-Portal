import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createTask, getClient, getClientFlowFlags, listAllTasks, listRelatedTasks, listTasks, listUnassignedTasks } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, taskCreateSchema, validateSlug } from "@/lib/validation";

// GET /api/admin/tasks?slug=<client>  → all tasks for a client's board
// GET /api/admin/tasks?unassigned=1   → tasks with no client ("Outros" filter)
// GET /api/admin/tasks (neither)      → cross-client feed, for the "Todos" filter
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const rawSlug = url.searchParams.get("slug") ?? "";
    const parentId = url.searchParams.get("parentId");
    if (parentId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parentId)) {
        throw new HttpError(400, "ID do card pai invalido.");
      }
      return NextResponse.json({ tasks: await listRelatedTasks(parentId) });
    }
    if (url.searchParams.get("unassigned") === "1") {
      return NextResponse.json({ tasks: await listUnassignedTasks() });
    }
    if (!rawSlug) {
      return NextResponse.json({ tasks: await listAllTasks() });
    }
    const slug = validateSlug(rawSlug);
    const client = await getClient(slug, true);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");
    return NextResponse.json({ tasks: await listTasks(client.id) });
  } catch (error) {
    return apiError(error);
  }
}

// POST /api/admin/tasks  → create a task, optionally on a client's board.
// Omitting slug creates an unassigned ("Outros") task.
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const scope = new URL(request.url).searchParams.get("scope");
    if (scope && !["task", "plan", "routine"].includes(scope)) throw new HttpError(400, "Contexto de criacao invalido.");
    const body = taskCreateSchema.parse(await request.json());
    const client = body.slug ? await getClient(body.slug, true) : null;
    if (body.slug && !client) throw new HttpError(404, "Cliente nao encontrado.");
    const { slug: _slug, ...fields } = body;
    void _slug;

    if (scope === "plan") {
      fields.kind = "plano_acao";
      fields.recurrence_cadence = null;
      fields.recurrence_weekdays = [];
      fields.recurrence_day_of_month = null;
    } else if (scope === "task") {
      if (fields.kind === "plano_acao") throw new HttpError(400, "A tela Tarefas nao cria Planos de Acao.");
      fields.recurrence_cadence = null;
      fields.recurrence_weekdays = [];
      fields.recurrence_day_of_month = null;
    } else if (scope === "routine") {
      if (fields.kind === "plano_acao") throw new HttpError(400, "A tela Rotinas nao cria Planos de Acao.");
      if (!fields.recurrence_cadence) throw new HttpError(400, "Uma Rotina precisa ter recorrencia.");
    }

    if (fields.status === "concluido" && (fields.kind ?? "criativo") !== "criativo") {
      throw new HttpError(400, "Apenas cards do tipo Criativo podem ir para Publicado.");
    }
    if (fields.kind === "plano_acao" && fields.recurrence_cadence) {
      throw new HttpError(400, "Plano de Acao e um tipo unico e nao pode ser recorrente.");
    }

    // Defense-in-depth: never create a task with a reviewer/approver for a
    // client whose stage is admin-disabled. Unassigned tasks have no flags
    // to check — the fields pass through as given.
    if (client) {
      const flags = await getClientFlowFlags(client.id);
      if (!flags.revisaoAdmin) { fields.reviewer_id = null; fields.requires_review = false; }
      if (!flags.aprovacaoAdmin) { fields.approver_id = null; fields.requires_approval = false; }
    }

    const task = await createTask(client?.id ?? null, fields);
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
