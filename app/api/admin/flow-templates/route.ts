import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listFlowTemplates } from "@/lib/flows/template";

// GET /api/admin/flow-templates → os moldes de fluxo, para o seletor de
// "Nova entrega" e para a tela de Configurações. ?active=1 filtra os ligados,
// que é o que o seletor de criação quer: um molde desativado continua
// existindo para as entregas que já rodam com ele, mas não inicia entrega nova.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const onlyActive = new URL(request.url).searchParams.get("active") === "1";
    const supabase = await createClient();
    return NextResponse.json({ templates: await listFlowTemplates(supabase, onlyActive) });
  } catch (error) {
    return apiError(error);
  }
}
