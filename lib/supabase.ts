import { HttpError, normalizeInsights, normalizeMetrics, type PortalPayload } from "./validation";

type ClientRow = { id: string; slug: string; name: string; is_active: boolean };
type BriefingRow = { answers: Record<string, unknown> | null; submitted: boolean | null; updated_at: string | null };
type LinksRow = { brand_url: string | null; products_url: string | null; uploads_url: string | null };
type ResultsRow = { insights: unknown; top_metrics: unknown; report_url: string | null; feedback_url: string | null };

function getConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new HttpError(503, "Servico indisponivel.");
  return { url, serviceKey };
}

export async function supabaseRest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, serviceKey } = getConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    console.error("Supabase REST error", { status: response.status, path, message: message.slice(0, 240) });
    throw new HttpError(response.status >= 500 ? 503 : response.status, "Nao foi possivel acessar os dados.");
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function getClient(slug: string, includeInactive = false) {
  const activeFilter = includeInactive ? "" : "&is_active=eq.true";
  const rows = await supabaseRest<ClientRow[]>(
    `clients?slug=eq.${encodeURIComponent(slug)}${activeFilter}&select=id,slug,name,is_active&limit=1`,
  );
  return rows[0] ?? null;
}

export async function getPortalPayload(slug: string): Promise<PortalPayload> {
  const client = await getClient(slug);
  if (!client) throw new HttpError(404, "Cliente nao encontrado.");

  const [briefingRows, linkRows, resultRows] = await Promise.all([
    supabaseRest<BriefingRow[]>(`briefing_answers?client_id=eq.${client.id}&select=answers,submitted,updated_at&limit=1`),
    supabaseRest<LinksRow[]>(`client_drive_links?client_id=eq.${client.id}&select=brand_url,products_url,uploads_url&limit=1`),
    supabaseRest<ResultsRow[]>(`client_results?client_id=eq.${client.id}&select=insights,top_metrics,report_url,feedback_url&limit=1`),
  ]);

  const briefing = briefingRows[0];
  const links = linkRows[0];
  const results = resultRows[0];

  return {
    client: { slug: client.slug, name: client.name },
    briefing: {
      answers: briefing?.answers ?? {},
      submitted: Boolean(briefing?.submitted),
      updatedAt: briefing?.updated_at ?? null,
    },
    driveLinks: {
      brandUrl: links?.brand_url ?? null,
      productsUrl: links?.products_url ?? null,
      uploadsUrl: links?.uploads_url ?? null,
    },
    results: {
      insights: normalizeInsights(results?.insights),
      topMetrics: normalizeMetrics(results?.top_metrics),
      reportUrl: results?.report_url ?? null,
      feedbackUrl: results?.feedback_url ?? null,
    },
  };
}

export async function saveBriefing(clientId: string, answers: Record<string, unknown>, submitted: boolean) {
  const rows = await supabaseRest<BriefingRow[]>(`briefing_answers?client_id=eq.${clientId}&select=answers,submitted,updated_at`, {
    method: "PATCH",
    body: JSON.stringify({ answers, submitted, updated_at: new Date().toISOString() }),
  });
  if (!rows[0]) throw new HttpError(404, "Briefing nao encontrado.");
  return rows[0];
}
