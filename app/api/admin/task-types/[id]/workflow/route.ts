import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireAdminManager } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const stepSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().trim().min(1).max(80),
  progress_weight: z.number().min(0.1).max(100),
  lead_days: z.number().int().min(0).max(365),
  default_assignee: z.string().max(120).nullable(),
  client_visible: z.boolean(),
});
const schema = z.object({ steps: z.array(stepSchema).min(1).max(30) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminManager();
    const { id } = await context.params;
    const deliveryTypeId = z.string().uuid().parse(id);
    const input = schema.parse(await request.json());
    if (new Set(input.steps.map((step) => step.key)).size !== input.steps.length) {
      return NextResponse.json({ error: "A cascata não pode repetir etapas." }, { status: 400 });
    }
    const db = createAdminClient();
    const { data, error } = await db.rpc("publish_delivery_workflow", {
      p_delivery_type_id: deliveryTypeId, p_steps: input.steps,
    });
    if (error) throw error;
    return NextResponse.json({ workflowVersionId: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
