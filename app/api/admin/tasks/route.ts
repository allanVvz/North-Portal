import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createTask, getClient, listAllTasks, listTasks } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, taskCreateSchema, validateSlug } from "@/lib/validation";

// GET /api/admin/tasks?slug=<client>  → all tasks for a client's board
// GET /api/admin/tasks (no slug)      → cross-client feed, for the "Todos" filter
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const rawSlug = url.searchParams.get("slug") ?? "";
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

// POST /api/admin/tasks  → create a task on a client's board
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = taskCreateSchema.parse(await request.json());
    const client = await getClient(body.slug, true);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");
    const { slug: _slug, ...fields } = body;
    void _slug;
    const task = await createTask(client.id, fields);
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
