import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { getNotificationRules, saveNotificationRules } from "@/lib/supabase";
import { notificationRulesSchema } from "@/lib/validation";

// GET|PATCH /api/admin/settings/notification-rules — as regras GLOBAIS de
// notificação da agência. Mesma forma de tabs-visibility: PATCH é fusão
// parcial, então a tela manda uma chave por vez.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await getNotificationRules());
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const patch = notificationRulesSchema.parse(await request.json());
    return NextResponse.json(await saveNotificationRules(patch));
  } catch (error) {
    return apiError(error);
  }
}
