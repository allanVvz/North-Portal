import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createTaskSubtype, createTaskType, listTaskTypes, listTaskTypesForEditor } from "@/lib/taskTypes";
import { taskSubtypeCreateSchema, taskTypeCreateSchema } from "@/lib/validation";

// GET /api/admin/task-types -> o vocabulario inteiro (tipos + subtipos), para
// os dropdowns de Tipo/Subtipo e para a caixa de etapas do modal. Uma consulta
// so: tipos e subtipos moram na mesma tabela.
//
// `?scope=editor` devolve tambem as linhas INATIVAS e quantos cards usam cada
// uma. As telas de trabalho nunca querem isso (uma etapa desativada nao deve
// voltar a aparecer num dropdown); a tela de Configuracoes precisa, porque e
// justamente la que se reativa uma etapa e se decide se da pra excluir outra.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const supabase = await createClient();
    if (new URL(request.url).searchParams.get("scope") === "editor") {
      return NextResponse.json(await listTaskTypesForEditor(supabase));
    }
    return NextResponse.json({ types: await listTaskTypes(supabase) });
  } catch (error) {
    return apiError(error);
  }
}

// POST /api/admin/task-types -> cria uma ETAPA (subtipo) de um tipo existente
// OU um TIPO de topo novo, conforme o corpo tem `parent_id` ou não. Um tipo de
// topo novo (2026-09-13) já nasce com identidade visual própria (icon/tone,
// colunas de task_types) — lib/taskCatalog.ts le isso via o cache ao vivo
// (lib/taskCatalog/liveKinds.ts) em vez de precisar de uma entrada em código.
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const supabase = await createClient();
    if (body && typeof body === "object" && !("parent_id" in body)) {
      const input = taskTypeCreateSchema.parse(body);
      return NextResponse.json(await createTaskType(supabase, input), { status: 201 });
    }
    const { parent_id, ...input } = taskSubtypeCreateSchema.parse(body);
    return NextResponse.json(await createTaskSubtype(supabase, parent_id, input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
