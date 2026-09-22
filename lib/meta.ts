import { HttpError } from "./validation";

// Meta (Facebook) Graph API client for the real OAuth connection —
// "Facebook Login for Business". SERVER ONLY: app secret + access tokens must
// never reach the browser. Mirrors the error-handling shape of lib/windsor.ts.

/**
 * Versão da Graph/Marketing API. A Meta aposenta cada versão ~2 anos depois do
 * lançamento e, a partir daí, TODA chamada de anúncios passa a falhar de uma vez
 * (`(#2635) You are calling a deprecated version of the Ads API`) — uma falha
 * datada, que chega numa segunda-feira sem aviso nenhum.
 *
 * Datas de validade publicadas pela Meta (docs/graph-api/changelog/versions):
 *   v21.0 → 21/01/2027   v22.0 → 20/05/2027   v23.0 → 08/10/2027
 *   v24.0 → 18/02/2028   v25.0 → 29/07/2028   v26.0 → a definir
 *
 * O padrão é v25.0: madura desde fevereiro/2026 e com prazo até meados de 2028.
 * O override por env existe porque este código não pode ser validado contra uma
 * conta real sem um token funcionando — se um campo do `/insights` tiver saído
 * entre v21 e v25, `META_GRAPH_VERSION=v21.0` volta ao comportamento anterior na
 * Vercel sem precisar de deploy.
 */
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const META_OAUTH_SCOPES = ["ads_management", "ads_read", "business_management", "pages_show_list"];

export type MetaAdAccount = { accountId: string; accountName: string };

/**
 * Traduz um erro da Graph API para uma frase que diz O QUE FAZER.
 *
 * Existe porque o erro que mais dói não vem como 401. Em 21/09/2026 as
 * automações de relatório de quatro clientes pararam com o texto cru da Meta —
 * "You cannot access the app till you log in to www.facebook.com and follow the
 * instructions given" — que é um CHECKPOINT na conta de quem autorizou o app:
 * enquanto essa pessoa não entrar no Facebook e concluir a verificação, nenhuma
 * chamada passa. A Meta manda isso como `OAuthException` em **HTTP 400**, então
 * o teste `status === 401 || status === 403` nunca pegava e o comentário no card
 * saía em inglês, sem dizer a quem recorrer.
 *
 * Classifica pelo `error.code`/`error_subcode` do corpo, não pelo status:
 *   - 190 (com subcódigos 458–467) e 102: credencial — checkpoint ou sessão inválida.
 *   - 368: conta bloqueada por política.
 *   - 17 / 80004 / 613: limite de chamadas.
 *   - 1 subcódigo 99: janela de dados grande demais.
 * O texto original da Meta continua no fim da frase — é o que permite procurar
 * o código exato depois, no card.
 */
export function metaErrorMessage(status: number, body: Record<string, unknown> | null): string {
  const error = (body?.error ?? null) as { message?: string; code?: number; error_subcode?: number; type?: string } | null;
  const message = error?.message?.trim() || null;
  const code = typeof error?.code === "number" ? error.code : null;
  const subcode = typeof error?.error_subcode === "number" ? error.error_subcode : null;
  const suffix = message ? ` (Meta: ${message})` : ` (HTTP ${status})`;

  // Checkpoint: a conta existe e o token é válido, mas a Meta exige uma
  // verificação humana. Nenhuma mudança no portal resolve.
  const checkpointed = (code === 190 && subcode != null && subcode >= 458 && subcode <= 467)
    || /log in to www\.facebook\.com/i.test(message ?? "")
    || /checkpoint/i.test(message ?? "");
  if (checkpointed) {
    return "Credencial da Meta bloqueada por verificação de segurança: quem conectou o North App precisa entrar em www.facebook.com e concluir o que a Meta pedir. Até lá nenhum relatório de anúncios é gerado." + suffix;
  }

  if (code === 190 || code === 102 || status === 401 || status === 403) {
    return "Token da Meta inválido ou expirado: reconecte a integração em Configurações › Integrações." + suffix;
  }
  if (code === 368) {
    return "Conta da Meta temporariamente bloqueada por violação de política. Verifique os avisos no Gerenciador de Anúncios." + suffix;
  }
  if (code === 17 || code === 613 || code === 80004) {
    return "Limite de chamadas da Meta atingido para esta conta de anúncios. A próxima execução tende a passar." + suffix;
  }
  if (code === 1 && subcode === 99) {
    return "A Meta recusou o volume de dados pedido de uma vez. Reduza a janela do relatório (ver TREND_WEEKS em lib/automations/run.ts)." + suffix;
  }
  return message ? `A Meta respondeu com erro: ${message}` : `A Meta respondeu com erro (${status}).`;
}

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
  if (!res.ok) throw new HttpError(502, metaErrorMessage(res.status, body));
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
