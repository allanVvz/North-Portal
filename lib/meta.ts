import { HttpError } from "./validation";

// Meta (Facebook) Graph API client for the real OAuth connection —
// "Facebook Login for Business". SERVER ONLY: app secret + access tokens must
// never reach the browser. Mirrors the error-handling shape of lib/windsor.ts.

export const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const META_OAUTH_SCOPES = ["ads_management", "ads_read", "business_management", "pages_show_list"];

export type MetaAdAccount = { accountId: string; accountName: string };

function requireAppCredentials(): { appId: string; appSecret: string } {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new HttpError(503, "Integracao com a Meta nao configurada (META_APP_ID/META_APP_SECRET ausentes).");
  }
  return { appId, appSecret };
}

export function buildMetaAuthUrl(redirectUri: string, state: string): string {
  const { appId } = requireAppCredentials();
  const qs = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: META_OAUTH_SCOPES.join(","),
    response_type: "code",
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${qs}`;
}

export async function graphGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams(params);
  let res: Response;
  try {
    res = await fetch(`${GRAPH_BASE}${path}?${qs}`, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  } catch {
    throw new HttpError(502, "Nao foi possivel falar com a Meta — verifique a conexao e tente de novo.");
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const message = (body?.error as { message?: string } | undefined)?.message;
    if (res.status === 401 || res.status === 403) throw new HttpError(502, "Token da Meta invalido ou expirado.");
    throw new HttpError(502, message ? `A Meta respondeu com erro: ${message}` : `A Meta respondeu com erro (${res.status}).`);
  }
  return body ?? {};
}

// Short-lived user token (from the OAuth `code`) — expires in ~1h, only used
// as a stepping stone to the long-lived exchange below.
export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const { appId, appSecret } = requireAppCredentials();
  const body = await graphGet("/oauth/access_token", {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const token = body.access_token as string | undefined;
  if (!token) throw new HttpError(502, "A Meta nao retornou um token de acesso.");
  return token;
}

// Long-lived user token — valid ~60 days. There is no OAuth2 refresh_token
// flow for Meta; renewal means re-running this exchange with a still-valid
// long-lived token before it expires (see plan's "known limitations").
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ token: string; expiresInSeconds: number | null }> {
  const { appId, appSecret } = requireAppCredentials();
  const body = await graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });
  const token = body.access_token as string | undefined;
  if (!token) throw new HttpError(502, "A Meta nao retornou um token de longa duracao.");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null;
  return { token, expiresInSeconds: expiresIn };
}

export async function fetchBusinessName(token: string): Promise<string> {
  const body = await graphGet("/me", { fields: "name", access_token: token });
  return typeof body.name === "string" ? body.name : "Conta Meta";
}

export async function fetchAdAccounts(token: string): Promise<MetaAdAccount[]> {
  const body = await graphGet("/me/adaccounts", { fields: "account_id,name", access_token: token });
  const rows = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
  return rows
    .map((r) => ({ accountId: String(r.account_id ?? ""), accountName: String(r.name ?? r.account_id ?? "") }))
    .filter((a) => a.accountId);
}
