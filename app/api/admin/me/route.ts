import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { updateProfileName } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { meProfileSchema } from "@/lib/validation";

// PATCH /api/admin/me → update the logged-in admin's own display name.
// Email/password go through supabase.auth.updateUser() client-side instead —
// those are auth.users fields, not RLS-governed application data.
export async function PATCH(request: Request) {
  try {
    const session = await requireAdmin();
    const value = meProfileSchema.parse(await request.json());
    await updateProfileName(session.userId, value.full_name);
    return NextResponse.json({ full_name: value.full_name });
  } catch (error) {
    return apiError(error);
  }
}
