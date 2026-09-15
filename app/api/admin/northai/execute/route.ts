import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireAdmin, requireAdminManager } from "@/lib/supabase/auth";
import { blueprintSchema } from "@/lib/northai/blueprint";
import { blueprintNeedsManager, executeBlueprint } from "@/lib/northai/execute";

export const runtime = "nodejs";

const requestSchema = z.object({ blueprint: blueprintSchema });

// POST /api/admin/northai/execute — executa um plano JÁ CONFIRMADO na tela.
// A rota só autentica, valida e serializa; a regra mora em lib/northai/execute.ts.
export async function POST(request: Request) {
  try {
    const { blueprint } = requestSchema.parse(await request.json());
    const session = blueprintNeedsManager(blueprint) ? await requireAdminManager() : await requireAdmin();
    const result = await executeBlueprint(blueprint, { userId: session.userId });
    const status = result.error ? (result.created.length ? 207 : 422) : 201;
    return NextResponse.json(result, { status });
  } catch (error) {
    return apiError(error);
  }
}
