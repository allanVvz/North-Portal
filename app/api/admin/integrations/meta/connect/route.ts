import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiError } from "@/lib/api";
import { buildMetaAuthUrl } from "@/lib/meta";
import { META_OAUTH_STATE_COOKIE } from "@/lib/metaOAuthState";
import { requireAdminManager } from "@/lib/supabase/auth";

// GET /api/admin/integrations/meta/connect → returns the Facebook OAuth
// dialog URL. requireAdminManager: this grants real access to ad accounts
// (spend/read), same sensitivity level as approving métricas.
export async function GET(request: Request) {
  try {
    await requireAdminManager();
    const state = crypto.randomUUID();
    const cookieStore = await cookies();
    cookieStore.set(META_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    const redirectUri = new URL("/api/admin/integrations/meta/callback", request.url).toString();
    const url = buildMetaAuthUrl(redirectUri, state);
    return NextResponse.json({ url });
  } catch (error) {
    return apiError(error);
  }
}
