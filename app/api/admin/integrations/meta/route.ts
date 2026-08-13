import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { disconnectMeta, getMetaSettings, updateMetaAccountMap } from "@/lib/supabase";
import { requireAdmin, requireAdminManager } from "@/lib/supabase/auth";
import { metaAccountMapSchema } from "@/lib/validation";

// GET → connection status + ad accounts, masked (token never leaves the server).
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await getMetaSettings());
  } catch (error) {
    return apiError(error);
  }
}

// PATCH → only the client account mapping. Consistent with the Windsor
// route: mapping accounts to clients is agency configuration, not a
// sensitive grant, so requireAdmin (not manager) is enough here.
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const { accountMap } = metaAccountMapSchema.parse(await request.json());
    return NextResponse.json(await updateMetaAccountMap(accountMap));
  } catch (error) {
    return apiError(error);
  }
}

// DELETE → disconnect. requireAdminManager: same sensitivity as connecting.
export async function DELETE() {
  try {
    await requireAdminManager();
    await disconnectMeta();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
