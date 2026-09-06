import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createTaskSubtype, listTaskTypes, listTaskTypesForEditor } from "@/lib/taskTypes";
import { taskSubtypeCreateSchema } from "@/lib/validation";

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

// POST /api/admin/task-types -> cria uma ETAPA (subtipo) no fim da fila de um
// tipo. Tipo de topo nao nasce por aqui: ele tem contraparte em
// lib/taskCatalog.ts (tom, icone, uniao TaskKind), e uma linha so no banco
// renderizaria com o visual de fallback em todo card.
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { parent_id, ...input } = taskSubtypeCreateSchema.parse(await request.json());
    const supabase = await createClient();
    return NextResponse.json(await createTaskSubtype(supabase, parent_id, input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
