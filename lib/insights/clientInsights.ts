// O que os relatórios e as automações já sabem sobre cada cliente, num formato
// só, para Home, Clientes e Performance (29/09/2026).
//
// Até aqui esses números viviam dentro dos PDFs: o retrato de mídia de cada
// semana (traffic_reports.snapshot), os seguidores informados no Feedback
// (task_metrics, client_metric_series) e os PDFs em si (documents). Nenhuma
// tela os mostrava. Aqui eles são lidos UMA vez, com as mesmas contas do PDF
// (mediaTotals, lib/reports/adsInsights.ts), e devolvidos por semana.
//
// Só leitura, sem migração. As funções puras (`weekFromSnapshot`,
// `latestPerPeriod`, `followerWeeks`) são as que os testes exercitam.

import { mediaOutcome, mediaTotals, outcomeCost, outcomeValue, OUTCOME_WORDS, type MediaOutcome } from "@/lib/reports/adsInsights";
import type { MetaPost } from "@/lib/windsor";
import type { AdminClient } from "@/lib/automations/taskAccess";

export type MediaWeek = {
  periodFrom: string;
  periodTo: string;
  spend: number | null;
  reach: number | null;
  impressions: number | null;
  linkClicks: number | null;
  profileVisits: number | null;
  conversations: number | null;
  outcome: MediaOutcome;
  outcomeLabel: string;
  outcomeValue: number | null;
  outcomeCost: number | null;
  /** O alcance veio corrigido pela equipe (comentário "alcance 12.452"). */
  reachCorrected: boolean;
  documentId: string | null;
};

export type FollowerWeek = { periodTo: string; total: number | null; gain: number | null };
export type ConversionWeek = { periodTo: string; vendas: number | null; agendamentos: number | null; receita: number | null };
export type ReportDoc = { name: string; url: string; date: string | null; kind: "anuncios" | "conversao" };

export type ClientInsight = {
  clientId: string;
  slug: string;
  name: string;
  media: MediaWeek[];
  followers: FollowerWeek[];
  conversion: ConversionWeek[];
  reports: ReportDoc[];
  /** Próxima execução da automação de relatório (data do molde de anúncios). */
  nextReport: string | null;
};

type TrafficRow = {
  client_id: string;
  occurrence_id: string | null;
  period_from: string;
  period_to: string;
  revision: number;
  status: string;
  document_id: string | null;
  snapshot: { campaignPosts?: MetaPost[]; trafficFinalView?: { reach?: number | null } | null } | null;
};

/** A última revisão de cada semana. Revisão "superseded" só vale se for a única. */
export function latestPerPeriod<T extends Pick<TrafficRow, "period_to" | "revision" | "status">>(rows: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const current = best.get(row.period_to);
    const rank = (r: T) => (r.status === "superseded" ? -1 : 1) * 1000 + r.revision;
    if (!current || rank(row) > rank(current)) best.set(row.period_to, row);
  }
  return [...best.values()].sort((a, b) => a.period_to.localeCompare(b.period_to));
}

/** Os números de uma semana, com as contas do PDF e o alcance corrigido. */
export function weekFromSnapshot(row: TrafficRow, reachOverride: number | null): MediaWeek {
  const totals = mediaTotals(row.snapshot?.campaignPosts ?? []);
  const snapshotReach = row.snapshot?.trafficFinalView?.reach ?? null;
  const reach = reachOverride ?? snapshotReach ?? totals.reach;
  const outcome = mediaOutcome(totals);
  return {
    periodFrom: row.period_from,
    periodTo: row.period_to,
    spend: totals.spend,
    reach,
    impressions: totals.impressions,
    linkClicks: totals.linkClicks,
    profileVisits: totals.profileVisits,
    conversations: totals.conversations,
    outcome,
    outcomeLabel: OUTCOME_WORDS[outcome].Plural,
    outcomeValue: outcomeValue(totals, outcome),
    outcomeCost: outcomeCost(totals, outcome),
    reachCorrected: (reachOverride ?? snapshotReach) !== null && (reachOverride ?? snapshotReach) !== totals.reach,
    documentId: row.document_id,
  };
}

/** Seguidores por semana: o total (série do perfil) e o ganho informado. */
export function followerWeeks(
  totals: readonly { period_to: string; value: number }[],
  metrics: readonly { period_to: string | null; metrics: Record<string, unknown> | null }[],
): FollowerWeek[] {
  const byWeek = new Map<string, FollowerWeek>();
  const week = (periodTo: string) => byWeek.get(periodTo) ?? { periodTo, total: null, gain: null };
  const num = (value: unknown) => {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  for (const row of totals) byWeek.set(row.period_to, { ...week(row.period_to), total: row.value });
  for (const row of metrics) {
    if (!row.period_to) continue;
    const gain = num(row.metrics?.seguidores_novos);
    const total = num(row.metrics?.seguidores);
    const current = week(row.period_to);
    byWeek.set(row.period_to, { ...current, gain: gain ?? current.gain, total: current.total ?? total });
  }
  // Total que não pode ser total do perfil: igual ao ganho (a regra do
  // relatório — ganho sozinho não é total) ou fracionário ("30,9 mil" gravado
  // como 30.9 antes da correção do intérprete, Cris 28/09).
  return [...byWeek.values()]
    .map((week) => ({ ...week, total: week.total !== null && (week.total === week.gain || !Number.isInteger(week.total) || (week.gain !== null && week.total < week.gain)) ? null : week.total }))
    .sort((a, b) => a.periodTo.localeCompare(b.periodTo));
}

function daysAgo(today: string, days: number): string {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function loadClientInsights(admin: AdminClient, options: { slugs?: string[]; weeks?: number; today: string }): Promise<ClientInsight[]> {
  const weeks = Math.min(Math.max(options.weeks ?? 8, 1), 26);
  const since = daysAgo(options.today, weeks * 7 + 7);

  let clientQuery = admin.from("clients").select("id,slug,name,disabled,is_active");
  if (options.slugs?.length) clientQuery = clientQuery.in("slug", options.slugs);
  const { data: clientRows, error: clientError } = await clientQuery;
  if (clientError) throw clientError;
  const clients = ((clientRows ?? []) as { id: string; slug: string; name: string; disabled: boolean | null; is_active: boolean | null }[])
    .filter((client) => options.slugs?.length || (!client.disabled && client.is_active !== false));
  const ids = clients.map((client) => client.id);
  if (!ids.length) return [];

  const [traffic, series, metrics, docs, configs] = await Promise.all([
    // Só os pedaços do retrato que o painel usa: as miniaturas (previews) e os
    // posts de anúncio pesavam quase todo o payload.
    admin.from("traffic_reports").select("client_id,occurrence_id,period_from,period_to,revision,status,document_id,campaignPosts:snapshot->campaignPosts,finalView:snapshot->trafficFinalView").in("client_id", ids).gte("period_to", since),
    admin.from("client_metric_series").select("client_id,period_to,value").in("client_id", ids).eq("metric_key", "followers_total").gte("period_to", since),
    admin.from("task_metrics").select("client_id,period_to,metrics").in("client_id", ids).gte("period_to", since),
    admin.from("documents").select("client_id,name,file_url,doc_date,created_at").in("client_id", ids).eq("doc_type", "relatorio").order("created_at", { ascending: false }).limit(ids.length * 12),
    admin.from("automation_configs").select("target_task_id,automation_key").eq("active", true).eq("automation_key", "relatorio_trafego_semanal"),
  ]);
  for (const result of [traffic, series, metrics, docs, configs]) if (result.error) throw result.error;

  const trafficRows = ((traffic.data ?? []) as (Omit<TrafficRow, "snapshot"> & { campaignPosts: MetaPost[] | null; finalView: { reach?: number | null } | null })[])
    .map(({ campaignPosts, finalView, ...row }) => ({ ...row, snapshot: { campaignPosts: campaignPosts ?? [], trafficFinalView: finalView } }));
  // Alcance corrigido pela equipe mora na ocorrência (report_instructions).
  const occurrenceIds = [...new Set(trafficRows.map((row) => row.occurrence_id).filter((id): id is string => Boolean(id)))];
  const overrides = new Map<string, number>();
  if (occurrenceIds.length) {
    const { data, error } = await admin.from("tasks").select("id,payload").in("id", occurrenceIds);
    if (error) throw error;
    for (const row of (data ?? []) as { id: string; payload: { report_instructions?: { instrucoes?: { kind: string; valor?: number | null }[] } } | null }[]) {
      const alcance = row.payload?.report_instructions?.instrucoes?.find((instruction) => instruction.kind === "alcance");
      if (typeof alcance?.valor === "number") overrides.set(row.id, alcance.valor);
    }
  }

  const moldIds = ((configs.data ?? []) as { target_task_id: string }[]).map((config) => config.target_task_id);
  const nextByClient = new Map<string, string>();
  if (moldIds.length) {
    const { data, error } = await admin.from("tasks").select("client_id,due_date").in("id", moldIds);
    if (error) throw error;
    for (const row of (data ?? []) as { client_id: string | null; due_date: string | null }[]) {
      if (row.client_id && row.due_date && (!nextByClient.get(row.client_id) || row.due_date < nextByClient.get(row.client_id)!)) nextByClient.set(row.client_id, row.due_date);
    }
  }

  return clients.map((client) => {
    const rows = latestPerPeriod(trafficRows.filter((row) => row.client_id === client.id)).slice(-weeks);
    const media = rows.map((row) => weekFromSnapshot(row, row.occurrence_id ? overrides.get(row.occurrence_id) ?? null : null));
    const clientMetrics = ((metrics.data ?? []) as { client_id: string; period_to: string | null; metrics: Record<string, unknown> | null }[]).filter((row) => row.client_id === client.id);
    const followers = followerWeeks(
      ((series.data ?? []) as { client_id: string; period_to: string; value: number }[]).filter((row) => row.client_id === client.id),
      clientMetrics,
    ).slice(-weeks);
    const num = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : null);
    const conversion = clientMetrics
      .filter((row) => row.period_to && ["vendas", "agendamentos", "receita"].some((key) => row.metrics?.[key] !== undefined))
      .map((row) => ({ periodTo: row.period_to!, vendas: num(row.metrics?.vendas), agendamentos: num(row.metrics?.agendamentos), receita: num(row.metrics?.receita) }))
      .sort((a, b) => a.periodTo.localeCompare(b.periodTo));
    const reports = ((docs.data ?? []) as { client_id: string; name: string; file_url: string; doc_date: string | null }[])
      .filter((doc) => doc.client_id === client.id)
      .slice(0, 6)
      .map((doc): ReportDoc => ({ name: doc.name, url: doc.file_url, date: doc.doc_date, kind: /convers/i.test(doc.name) ? "conversao" : "anuncios" }));
    return { clientId: client.id, slug: client.slug, name: client.name, media, followers, conversion, reports, nextReport: nextByClient.get(client.id) ?? null };
  });
}
