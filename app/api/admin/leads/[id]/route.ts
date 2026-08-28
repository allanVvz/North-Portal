import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { updateLead } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, leadPatchSchema } from "@/lib/validation";

// Toda mutação de lead passa por aqui, nunca por Supabase direto do client.
// É essa costura que deixa a tela pronta para um CRM: um webhook ou job de
// sincronização reusa esta mesma rota, com a mesma validação e o mesmo
// requireAdmin, em vez de abrir um segundo caminho de escrita.
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const patch = leadPatchSchema.parse(await request.json());
    return NextResponse.json(await updateLead(id, patch));
  } catch (error) {
    return apiError(error);
  }
}
