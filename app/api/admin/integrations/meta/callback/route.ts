import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, exchangeForLongLivedToken, fetchAdAccounts, fetchBusinessName } from "@/lib/meta";
import { saveMetaConnection } from "@/lib/supabase";
import { META_OAUTH_STATE_COOKIE } from "@/lib/metaOAuthState";
import { requireAdminManager } from "@/lib/supabase/auth";

// GET /api/admin/integrations/meta/callback — Facebook redirects the admin's
// browser here after they approve/deny the OAuth dialog. Full-page redirect
// (not a popup/postMessage) — same browser/session that started the flow, so
// requireAdminManager() still works. On any failure we redirect back to
// Configurações with an error flag rather than surfacing raw JSON, since this
// is a browser navigation, not a fetch() call.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const backTo = (params: string) => NextResponse.redirect(`${origin}/admin/configuracoes?tab=integracoes&${params}`);

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(META_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(META_OAUTH_STATE_COOKIE);

  try {
    const session = await requireAdminManager();
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || !expectedState || state !== expectedState) {
      return backTo("metaError=1");
    }

    const redirectUri = `${origin}/api/admin/integrations/meta/callback`;
    const shortToken = await exchangeCodeForToken(code, redirectUri);
    const { token, expiresInSeconds } = await exchangeForLongLivedToken(shortToken);
    const [businessName, adAccounts] = await Promise.all([fetchBusinessName(token), fetchAdAccounts(token)]);
    const expiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null;

    await saveMetaConnection({ token, businessName, adAccounts, expiresAt, connectedBy: session.userId });
    return backTo("connected=meta");
  } catch (error) {
    console.error("Meta OAuth callback error", error);
    return backTo("metaError=1");
  }
}
