import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import {
  getClient,
  listAllTasks,
  listRelatedTasks,
  listTasks,
  listUnassignedTasks,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, taskCreateSchema, validateSlug } from "@/lib/validation";
import { TASK_CREATE_SCOPES, createTaskFromInput, type TaskCreateScope } from "@/lib/tasks/createFromInput";

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
    if (scope && !(TASK_CREATE_SCOPES as readonly string[]).includes(scope)) throw new HttpError(400, "Contexto de criacao invalido.");
    const body = taskCreateSchema.parse(await request.json());
    // A regra inteira mora em lib/tasks/createFromInput.ts — o Estúdio do
    // NorthAi cria pela mesma porta.
    const { task } = await createTaskFromInput(body, (scope as TaskCreateScope | null) ?? null);
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
