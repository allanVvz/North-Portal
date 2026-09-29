import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadClientInsights } from "@/lib/insights/clientInsights";
import { agencyToday } from "@/lib/time/agency";

// GET /api/admin/insights/clients?slug=a,b&weeks=8 — o que os relatórios e
// as automações já sabem de cada cliente (mídia por semana, seguidores,
// conversão informada, PDFs, próximo relatório). Home, Clientes e a página do
// cliente leem daqui. Sem slug: todos os clientes ativos.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const slugs = (url.searchParams.get("slug") ?? "").split(",").map((slug) => slug.trim()).filter(Boolean);
    const weeks = Number(url.searchParams.get("weeks") ?? 8) || 8;
    const insights = await loadClientInsights(createAdminClient(), { slugs, weeks, today: agencyToday() });
    return NextResponse.json({ insights });
  } catch (error) {
    return apiError(error);
  }
}
