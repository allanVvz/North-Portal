import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getTaskById } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { HttpError } from "@/lib/validation";

const linkSchema = z.object({ task_id: z.string().uuid(), cycle_id: z.string().uuid() });
const uuid = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

async function templateFor(id: string) {
  const template = await getTaskById(id);
  if (!template) throw new HttpError(404, "Molde não encontrado.");
  if (!template.recurrence_cadence) throw new HttpError(409, "Este card não é um molde recorrente.");
  return template;
}

export async function GET(_request: Request, context: Context) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    await templateFor(id);
    const db = await createClient();
    const { data, error } = await db.from("routine_execution_links")
      .select("id,template_id,cycle_id,occurrence_date,task_id,created_at")
      .eq("template_id", id).order("occurrence_date", { ascending: false });
    if (error) throw error;
    const links = await Promise.all((data ?? []).map(async (link) => ({ ...link, task: await getTaskById(link.task_id) })));
    return NextResponse.json({ links });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    const { task_id, cycle_id } = linkSchema.parse(await request.json());
    const template = await templateFor(id);
    const task = await getTaskById(task_id);
    const cycle = await getTaskById(cycle_id);
    if (!task || !cycle) throw new HttpError(404, "Card ou reunião não encontrado.");
    if (task_id === id || task_id === cycle_id || task.recurrence_cadence) throw new HttpError(400, "Selecione um card de execução.");
    if (cycle.plan_id !== id || cycle.client_id !== template.client_id || cycle.kind !== template.kind
      || cycle.payload?.recurrence_parent_id !== id) throw new HttpError(400, "Selecione uma reunião deste molde.");
    const occurrenceDate = String(cycle.payload?.occurrence_date || cycle.due_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate)) throw new HttpError(409, "A reunião não tem data válida.");
    const db = await createClient();
    const { data, error } = await db.from("routine_execution_links").insert({
      template_id: id, cycle_id, occurrence_date: occurrenceDate, task_id, created_by: session.userId,
    }).select("id,template_id,cycle_id,occurrence_date,task_id,created_at").single();
    if (error?.code === "23505") throw new HttpError(409, "Este card já está vinculado a esta reunião.");
    if (error) throw error;
    return NextResponse.json({ link: { ...data, task } }, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    await templateFor(id);
    const linkId = uuid.parse(new URL(request.url).searchParams.get("link_id"));
    const db = await createClient();
    const { data, error } = await db.from("routine_execution_links").delete()
      .eq("id", linkId).eq("template_id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Vínculo não encontrado.");
    return NextResponse.json({ id: data.id });
  } catch (error) { return apiError(error); }
}
