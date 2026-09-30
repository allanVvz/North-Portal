import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin, requireAdminManager } from "@/lib/supabase/auth";
import { listGlobalAutomationRules, publishGlobalAutomationRule } from "@/lib/automations/rules";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    await requireAdmin();
    const [rules, legacy] = await Promise.all([
      listGlobalAutomationRules(),
      createAdminClient().from("automation_configs").select("id", { count: "exact", head: true })
        .eq("active", true).is("automation_rule_version_id", null),
    ]);
    if (legacy.error) throw legacy.error;
    return NextResponse.json({ rules, legacyActiveCount: legacy.count ?? 0 });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdminManager();
    const rule = await publishGlobalAutomationRule(await request.json(), session.userId);
    return NextResponse.json(rule, { status: 201 });
  } catch (error) { return apiError(error); }
}
