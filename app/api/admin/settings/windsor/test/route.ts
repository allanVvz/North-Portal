import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getWindsorSettings } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, windsorTestSchema } from "@/lib/validation";
import { testWindsorConnection, type WindsorDatasource } from "@/lib/windsor";

// POST /api/admin/settings/windsor/test → tests the provided key (pre-save
// "Testar conexão") or, when omitted, the stored one. The account list in the
// response also feeds the client→account mapping dropdowns in Integrações.
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = windsorTestSchema.parse(await request.json().catch(() => ({})));
    const settings = await getWindsorSettings();
    const apiKey = body.apiKey ?? settings.apiKey;
    if (!apiKey) throw new HttpError(400, "Informe a chave da API da Windsor.ai.");
    const enabled = (Object.keys(settings.datasources) as WindsorDatasource[]).filter((ds) => settings.datasources[ds]);
    const result = await testWindsorConnection(apiKey, enabled.length ? enabled : ["instagram"]);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
