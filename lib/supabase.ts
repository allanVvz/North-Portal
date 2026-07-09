import { createClient } from "./supabase/server";
import {
  HttpError,
  normalizeInsights,
  normalizeMetrics,
  ACCESS_PLATFORMS,
  type AccessPlatformKey,
  type AdminTabsVisibility,
  type ClientFlowFlags,
  type ClientTask,
  type CredentialSummary,
  type DocumentRecord,
  type PortalPayload,
  type PortalPrefs,
  type ReviewerCandidate,
  type TaskRecord,
  type TaskStatus,
} from "./validation";
import { defaultContent, type PortalContent, type Tone } from "@/app/[slug]/portalData";
import { taskProgress, checkpointsProgress, kindLabel, kindTone, subtypeLabel } from "./taskCatalog";

type ContentRow = { data: Record<string, unknown> | null };
type PrefsRow = { theme: string | null; avatar_style: number | null; display_name: string | null; username: string | null; manual_seen: boolean | null };

const TASK_COLUMNS =
  "id,client_id,kind,subtype,title,status,priority,assignee,reviewer_id,approver_id,plan_id,requires_review,requires_approval,due_date,start_date,end_date,scheduled_start_at,scheduled_end_at,progress_weight,description,client_visible,payload,position";

const STATUS_KANBAN: Record<TaskStatus, string> = {
  backlog: "Kanban · Entrada",
  em_producao: "Kanban · Em produção",
  revisao: "Kanban · Revisão",
  aprovacao: "Kanban · Aprovação",
  aprovado: "Kanban · Concluído",
  concluido: "Kanban · Publicado",
};

// 'YYYY-MM-DD' -> 'dd/mm'; formats a plan's start→end span for the portal card.
function fmtDateRange(start: string | null, end: string | null): string {
  const f = (d: string) => { const [, m, day] = d.split("-"); return day && m ? `${day}/${m}` : d; };
  if (start && end) return `${f(start)} – ${f(end)}`;
  if (start) return `desde ${f(start)}`;
  if (end) return `até ${f(end)}`;
  return "";
}

// Client-visible `plano_acao` cards become the portal "Plano de Ação" cards.
// Progress is the workflow-driven rollup of the plan's member tasks (plan_id),
// computed over the rows the caller can read (`allRows`).
function planoFromTasks(rows: TaskRecord[], allRows: TaskRecord[]): PortalContent["plano"] {
  return rows.map((t) => {
    const p = (t.payload ?? {}) as Record<string, unknown>;
    const members = allRows.filter((m) => m.plan_id === t.id);
    const pct = taskProgress(t, members);
    const statusLabel =
      typeof p.statusLabel === "string"
        ? p.statusLabel
        : pct >= 100 ? "Concluído"
        : pct === 0 ? "A iniciar"
        : "Em andamento";
    const statusTone = (typeof p.statusTone === "string" ? p.statusTone : pct >= 80 ? "green" : pct === 0 ? "neutral" : "green") as Tone;
    const barTone = (typeof p.barTone === "string" ? p.barTone : "green") as Tone;
    return {
      title: t.title,
      desc: t.description ?? "",
      status: statusLabel,
      statusTone,
      pct,
      barTone,
      responsible: t.assignee ?? "N",
      kanban: STATUS_KANBAN[t.status],
      dateRange: fmtDateRange(t.start_date, t.end_date),
      activities: members.map((m) => ({ title: m.title, kind: m.kind, status: STATUS_KANBAN[m.status], pct: taskProgress(m) })),
    };
  });
}

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const MESES_LOWER = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function taskDate(t: TaskRecord): Date | null {
  const iso = t.scheduled_start_at ?? (t.due_date ? `${t.due_date}T00:00:00` : null);
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Real Agenda, built from client-visible `agendamento` cards (meetings, shoots,
// publications) plus any other client-visible/dated task for the calendar
// marks. Returns null when the client has no dated agendamento card yet, so
// the caller can fall back to the static demo content (same pattern as Plano).
function agendaFromTasks(rows: TaskRecord[], now: Date = new Date()): PortalContent["agenda"] | null {
  const events = rows
    .filter((t) => t.kind === "agendamento" && t.client_visible)
    .map((t) => ({ t, date: taskDate(t) }))
    .filter((x): x is { t: TaskRecord; date: Date } => x.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (events.length === 0) return null;

  const eventList = events.map(({ t, date }) => {
    const p = (t.payload ?? {}) as Record<string, unknown>;
    const platform = typeof p.plataforma === "string" ? p.plataforma : "";
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return {
      day: String(date.getDate()).padStart(2, "0"),
      month: MESES[date.getMonth()],
      title: t.title,
      meta: `${hh}:${mm}${platform ? ` · ${platform}` : ""}`,
      tag: subtypeLabel(t.subtype) || kindLabel(t.kind),
      tone: kindTone(t.kind) as Tone,
    };
  });

  const upcoming = events.find((e) => e.date.getTime() >= now.getTime()) ?? events[events.length - 1];
  const next = {
    title: upcoming.t.title,
    when: `${DIAS_SEMANA[upcoming.date.getDay()]}, ${String(upcoming.date.getDate()).padStart(2, "0")} de ${MESES_LOWER[upcoming.date.getMonth()]} · ${String(upcoming.date.getHours()).padStart(2, "0")}:${String(upcoming.date.getMinutes()).padStart(2, "0")}`,
    desc: upcoming.t.description ?? "",
  };

  // Calendar month anchored to the upcoming/most relevant event; marks come
  // from ANY client-visible dated task that month (not just agendamento), so
  // e.g. checkpoint/plan due dates also show up.
  const monthRef = upcoming.date;
  const year = monthRef.getFullYear();
  const month = monthRef.getMonth();
  const startDow = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const marks: Record<string, { tag: string; tone: Tone }> = {};
  for (const t of rows) {
    if (!t.client_visible) continue;
    const d = taskDate(t);
    if (!d || d.getFullYear() !== year || d.getMonth() !== month) continue;
    marks[String(d.getDate())] = { tag: subtypeLabel(t.subtype) || kindLabel(t.kind), tone: kindTone(t.kind) as Tone };
  }

  const legendMap = new Map<string, Tone>();
  for (const e of eventList) legendMap.set(e.tag, e.tone);
  const legend = Array.from(legendMap, ([label, tone]) => ({ label, tone }));

  return {
    events: eventList,
    next,
    calendar: { title: `${MESES_LOWER[month][0].toUpperCase()}${MESES_LOWER[month].slice(1)} ${year}`, startDow, days, marks },
    legend,
  };
}

// DB content overrides the shared Figma defaults section-by-section (shallow).
function mergeContent(data: Record<string, unknown> | null | undefined): PortalContent {
  if (!data || typeof data !== "object") return defaultContent;
  return { ...defaultContent, ...(data as Partial<PortalContent>) } as PortalContent;
}

function toPrefs(row: PrefsRow | undefined, fallbackName: string, slug: string): PortalPrefs {
  return {
    theme: row?.theme === "dark" ? "dark" : "light",
    avatarStyle: typeof row?.avatar_style === "number" ? row.avatar_style : 0,
    displayName: row?.display_name ?? fallbackName,
    username: row?.username ?? `@${slug}`,
    manualSeen: Boolean(row?.manual_seen),
  };
}

// Data access for the portal + admin. All queries run through the authenticated
// SSR client so Postgres RLS enforces role/ownership (admins see everything,
// clients only their own rows). No service-role bypass.

export type ClientRow = { id: string; slug: string; name: string; is_active: boolean };
type BriefingRow = { answers: Record<string, unknown> | null; submitted: boolean | null; updated_at: string | null };
type LinksRow = { brand_url: string | null; products_url: string | null; uploads_url: string | null };
type ResultsRow = { insights: unknown; top_metrics: unknown; report_url: string | null; feedback_url: string | null };

function fail(error: { message?: string; code?: string } | null): never {
  console.error("Supabase query error", { code: error?.code, message: error?.message?.slice(0, 240) });
  throw new HttpError(503, "Nao foi possivel acessar os dados.");
}

export async function getClient(slug: string, includeInactive = false): Promise<ClientRow | null> {
  const supabase = await createClient();
  let query = supabase.from("clients").select("id,slug,name,is_active").eq("slug", slug).limit(1);
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) fail(error);
  return (data?.[0] as ClientRow | undefined) ?? null;
}

export async function getPortalPayload(slug: string): Promise<PortalPayload> {
  const supabase = await createClient();
  const client = await getClient(slug);
  if (!client) throw new HttpError(404, "Cliente nao encontrado.");

  const [briefing, links, results, content, prefs, tasks, documents, credentials, planoVisibility, flowFlags] = await Promise.all([
    supabase.from("briefing_answers").select("answers,submitted,updated_at").eq("client_id", client.id).limit(1),
    supabase.from("client_drive_links").select("brand_url,products_url,uploads_url").eq("client_id", client.id).limit(1),
    supabase.from("client_results").select("insights,top_metrics,report_url,feedback_url").eq("client_id", client.id).limit(1),
    supabase.from("client_content").select("data").eq("client_id", client.id).limit(1),
    supabase.from("client_prefs").select("theme,avatar_style,display_name,username,manual_seen").eq("client_id", client.id).limit(1),
    // Any card in the approval pipeline (aprovacao/aprovado/concluido) is
    // client-facing regardless of `client_visible` — that flag only gates
    // the separate "Plano de Ação" feature for earlier Kanban stages.
    supabase
      .from("tasks")
      .select(`${TASK_COLUMNS},updated_at`)
      .eq("client_id", client.id)
      .or("client_visible.eq.true,status.in.(aprovacao,aprovado,concluido)")
      .order("position"),
    supabase.from("documents").select(DOC_COLUMNS).eq("client_id", client.id).order("doc_date", { ascending: false, nullsFirst: false }),
    listClientCredentials(client.id),
    getPlanoVisibility(),
    getClientFlowFlags(client.id),
  ]);
  if (briefing.error) fail(briefing.error);
  if (links.error) fail(links.error);
  if (results.error) fail(results.error);
  if (content.error) fail(content.error);
  if (prefs.error) fail(prefs.error);
  if (tasks.error) fail(tasks.error);
  if (documents.error) fail(documents.error);

  const b = briefing.data?.[0] as BriefingRow | undefined;
  const l = links.data?.[0] as LinksRow | undefined;
  const r = results.data?.[0] as ResultsRow | undefined;
  const c = content.data?.[0] as ContentRow | undefined;
  const p = prefs.data?.[0] as PrefsRow | undefined;
  const taskRows = (tasks.data as ClientTask[] | null) ?? [];
  const documentRows = (documents.data as DocumentRecord[] | null) ?? [];

  // Platform-wide master switch: while off, every client_visible flag is
  // treated as false for content built from it (Plano de Ação, Agenda),
  // regardless of the task's own DB value — a data-layer guarantee, not just
  // a UI toggle. Approval-pipeline/checkpoint content is untouched — those
  // are never gated by client_visible in the first place.
  const visibleRows: ClientTask[] = planoVisibility
    ? taskRows
    : taskRows.map((t) => (t.client_visible ? { ...t, client_visible: false } : t));

  // Plano de Ação is now a real card kind: client-visible `plano_acao` cards,
  // each showing the rolled-up progress of its member tasks (plan_id).
  const planoRows = visibleRows.filter((t) => t.client_visible && t.kind === "plano_acao");
  const checkpointRows = taskRows
    .filter((t) => t.kind === "checkpoint_comercial")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const mergedContent = mergeContent(c?.data);
  const agenda = agendaFromTasks(visibleRows);
  const content_ = {
    ...mergedContent,
    ...(planoRows.length ? { plano: planoFromTasks(planoRows, visibleRows) } : {}),
    ...(agenda ? { agenda } : {}),
  };

  return {
    client: { slug: client.slug, name: client.name },
    briefing: {
      answers: b?.answers ?? {},
      submitted: Boolean(b?.submitted),
      updatedAt: b?.updated_at ?? null,
    },
    driveLinks: {
      brandUrl: l?.brand_url ?? null,
      productsUrl: l?.products_url ?? null,
      uploadsUrl: l?.uploads_url ?? null,
    },
    results: {
      insights: normalizeInsights(r?.insights),
      topMetrics: normalizeMetrics(r?.top_metrics),
      reportUrl: r?.report_url ?? null,
      feedbackUrl: r?.feedback_url ?? null,
    },
    content: content_,
    prefs: toPrefs(p, client.name, client.slug),
    documents: documentRows,
    credentials,
    pendingApprovals: taskRows
      .filter((t) => t.status === "aprovacao")
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")),
    resolvedApprovals: taskRows
      .filter((t) => t.status === "aprovado" || t.status === "concluido")
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")),
    checkpoints: checkpointRows,
    flowFlags: { revisaoCliente: flowFlags.revisaoCliente, aprovacaoCliente: flowFlags.aprovacaoCliente },
  };
}

// Upserts the client's portal preferences (theme / avatar / display fields).
export async function savePrefs(
  clientId: string,
  patch: { theme?: "light" | "dark"; avatarStyle?: number; displayName?: string | null; username?: string | null; manualSeen?: boolean },
): Promise<PortalPrefs> {
  const supabase = await createClient();
  const row: Record<string, unknown> = { client_id: clientId };
  if (patch.theme !== undefined) row.theme = patch.theme;
  if (patch.avatarStyle !== undefined) row.avatar_style = patch.avatarStyle;
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.username !== undefined) row.username = patch.username;
  if (patch.manualSeen !== undefined) row.manual_seen = patch.manualSeen;
  const { data, error } = await supabase
    .from("client_prefs")
    .upsert(row, { onConflict: "client_id" })
    .select("theme,avatar_style,display_name,username,manual_seen")
    .limit(1);
  if (error) fail(error);
  const saved = data?.[0] as PrefsRow | undefined;
  return {
    theme: saved?.theme === "dark" ? "dark" : "light",
    avatarStyle: typeof saved?.avatar_style === "number" ? saved.avatar_style : 0,
    displayName: saved?.display_name ?? null,
    username: saved?.username ?? null,
    manualSeen: Boolean(saved?.manual_seen),
  };
}

export async function saveBriefing(clientId: string, answers: Record<string, unknown>, submitted: boolean) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("briefing_answers")
    .update({ answers, submitted, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .select("answers,submitted,updated_at");
  if (error) fail(error);
  const row = (data?.[0] as BriefingRow | undefined) ?? null;
  if (!row) throw new HttpError(404, "Briefing nao encontrado.");
  return row;
}

// ---- admin helpers ----------------------------------------------------------

export type AdminClientSummary = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  updated_at: string | null;
  briefing_submitted: boolean;
};

type ListClientRow = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  updated_at: string | null;
  briefing_answers: { submitted: boolean | null }[] | null;
};

export async function listClients(): Promise<AdminClientSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id,slug,name,is_active,updated_at,briefing_answers(submitted)")
    .order("name");
  if (error) fail(error);
  return ((data as ListClientRow[] | null) ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    is_active: row.is_active,
    updated_at: row.updated_at,
    briefing_submitted: Boolean(row.briefing_answers?.[0]?.submitted),
  }));
}

// ---- Client flow flags (Revisão/Aprovação safe-hide, per client) --------------
// Absence of a row means every flag is on (today's behavior for a client that
// was never explicitly configured).

const FLOW_FLAGS_COLUMNS = "revisao_admin,revisao_cliente,revisao_kanban,aprovacao_admin,aprovacao_cliente,aprovacao_kanban";

type ClientFlowFlagsRow = {
  revisao_admin: boolean;
  revisao_cliente: boolean;
  revisao_kanban: boolean;
  aprovacao_admin: boolean;
  aprovacao_cliente: boolean;
  aprovacao_kanban: boolean;
};

// Absence of a row (or of a specific column, for accounts created before the
// kanban toggle existed) is the "natural" state: admin/cliente off (Revisão and
// Aprovação are dormant everywhere by default) but the Kanban column itself
// stays available.
function toFlowFlags(row: ClientFlowFlagsRow | undefined): ClientFlowFlags {
  return {
    revisaoAdmin: row?.revisao_admin ?? false,
    revisaoCliente: row?.revisao_cliente ?? false,
    revisaoKanban: row?.revisao_kanban ?? true,
    aprovacaoAdmin: row?.aprovacao_admin ?? false,
    aprovacaoCliente: row?.aprovacao_cliente ?? false,
    aprovacaoKanban: row?.aprovacao_kanban ?? true,
  };
}

export async function getClientFlowFlags(clientId: string): Promise<ClientFlowFlags> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_flow_flags")
    .select(FLOW_FLAGS_COLUMNS)
    .eq("client_id", clientId)
    .limit(1);
  if (error) fail(error);
  return toFlowFlags(data?.[0] as ClientFlowFlagsRow | undefined);
}

// Cross-client map used to filter the Revisões/Aprovações queues — a client
// admin-disabled for a stage never appears there, even though the nav tab
// itself stays (it's a legitimate cross-client utility view).
export async function listAllClientFlowFlags(): Promise<Map<string, ClientFlowFlags>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("client_flow_flags").select(`client_id,${FLOW_FLAGS_COLUMNS}`);
  if (error) fail(error);
  const map = new Map<string, ClientFlowFlags>();
  for (const row of (data as (ClientFlowFlagsRow & { client_id: string })[] | null) ?? []) {
    map.set(row.client_id, toFlowFlags(row));
  }
  return map;
}

// Saves a client's flow flags. admin-off ⇒ cliente-off is still cascaded (the
// client can never see/act on a stage the admin side doesn't run). The kanban
// toggle is fully independent — it alone decides whether the board shows the
// column, and toggling it off is what moves any stranded card back to
// "em_producao". Toggling admin off separately clears any assigned
// revisor/aprovador (that capability stops being available for the client),
// regardless of whether the column itself stays visible.
export async function saveClientFlowFlags(
  clientId: string,
  patch: Partial<ClientFlowFlags>,
): Promise<ClientFlowFlags> {
  const supabase = await createClient();
  const current = await getClientFlowFlags(clientId);
  const next: ClientFlowFlags = { ...current, ...patch };
  if (!next.revisaoAdmin) next.revisaoCliente = false;
  if (!next.aprovacaoAdmin) next.aprovacaoCliente = false;

  const { data, error } = await supabase
    .from("client_flow_flags")
    .upsert(
      {
        client_id: clientId,
        revisao_admin: next.revisaoAdmin,
        revisao_cliente: next.revisaoCliente,
        revisao_kanban: next.revisaoKanban,
        aprovacao_admin: next.aprovacaoAdmin,
        aprovacao_cliente: next.aprovacaoCliente,
        aprovacao_kanban: next.aprovacaoKanban,
      },
      { onConflict: "client_id" },
    )
    .select(FLOW_FLAGS_COLUMNS)
    .limit(1);
  if (error) fail(error);

  const moves: PromiseLike<unknown>[] = [];
  if (current.revisaoKanban && !next.revisaoKanban) {
    moves.push(supabase.from("tasks").update({ status: "em_producao" }).eq("client_id", clientId).eq("status", "revisao"));
  }
  if (current.aprovacaoKanban && !next.aprovacaoKanban) {
    moves.push(supabase.from("tasks").update({ status: "em_producao" }).eq("client_id", clientId).eq("status", "aprovacao"));
  }
  if (current.revisaoAdmin && !next.revisaoAdmin) {
    // "Sem revisor" from the moment the flow is disabled, not lazily on next save.
    moves.push(supabase.from("tasks").update({ reviewer_id: null, requires_review: false }).eq("client_id", clientId).not("reviewer_id", "is", null));
  }
  if (current.aprovacaoAdmin && !next.aprovacaoAdmin) {
    moves.push(supabase.from("tasks").update({ approver_id: null, requires_approval: false }).eq("client_id", clientId).not("approver_id", "is", null));
  }
  if (moves.length) await Promise.all(moves);

  return toFlowFlags(data?.[0] as ClientFlowFlagsRow | undefined);
}

// ---- Admin nav tabs visibility (Revisões / Aprovações, global switches) -------
// Purely controls whether AdminShell's sidebar renders these two nav items —
// unrelated to the per-client flags above, which gate data/assignment.
export async function getAdminTabsVisibility(): Promise<AdminTabsVisibility> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("site_settings").select("value").eq("key", "admin_tabs_visibility").limit(1);
  if (error) fail(error);
  const value = (data?.[0] as { value: Partial<AdminTabsVisibility> } | undefined)?.value;
  return {
    revisoesTabVisible: value?.revisoesTabVisible ?? false,
    aprovacoesTabVisible: value?.aprovacoesTabVisible ?? false,
  };
}

export async function saveAdminTabsVisibility(patch: Partial<AdminTabsVisibility>): Promise<AdminTabsVisibility> {
  const current = await getAdminTabsVisibility();
  const next = { ...current, ...patch };
  const supabase = await createClient();
  const { error } = await supabase
    .from("site_settings")
    .upsert({ key: "admin_tabs_visibility", value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) fail(error);
  return next;
}

// Cross-client overview used by the Onboarding / Performance / Plano admin pages.
export type AdminOverviewRow = {
  slug: string;
  name: string;
  is_active: boolean;
  briefing_submitted: boolean;
  metricsCount: number;
  hasReport: boolean;
  planCount: number;
};

export async function listAdminOverview(): Promise<AdminOverviewRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("slug,name,is_active,briefing_answers(submitted),client_results(top_metrics,report_url),tasks(client_visible)")
    .order("name");
  if (error) fail(error);
  type Row = {
    slug: string;
    name: string;
    is_active: boolean;
    briefing_answers: { submitted: boolean | null }[] | null;
    client_results: { top_metrics: unknown; report_url: string | null }[] | null;
    tasks: { client_visible: boolean }[] | null;
  };
  return ((data as Row[] | null) ?? []).map((row) => {
    const metrics = row.client_results?.[0]?.top_metrics;
    return {
      slug: row.slug,
      name: row.name,
      is_active: row.is_active,
      briefing_submitted: Boolean(row.briefing_answers?.[0]?.submitted),
      metricsCount: Array.isArray(metrics) ? metrics.length : 0,
      hasReport: Boolean(row.client_results?.[0]?.report_url),
      planCount: (row.tasks ?? []).filter((t) => t.client_visible).length,
    };
  });
}

export type AdminBriefingRow = {
  slug: string;
  name: string;
  answers: Record<string, unknown>;
  submitted: boolean;
  updatedAt: string | null;
  // Onboarding progress = average taskProgress() across the client's real
  // checkpoint_comercial cards (see checkpointsProgress in taskCatalog.ts).
  checkpointsPct: number;
  // Real, server-tracked Manual do Cliente completion (client_prefs.manual_seen).
  manualSeen: boolean;
};

// Full raw briefing answers per client, for the Onboarding screen's
// per-client summary modal + CSV export (small admin-only dataset, one query).
export async function listAllBriefings(): Promise<AdminBriefingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("slug,name,briefing_answers(answers,submitted,updated_at),tasks(kind,status,progress_weight),client_prefs(manual_seen)")
    .order("name");
  if (error) fail(error);
  type Row = {
    slug: string;
    name: string;
    briefing_answers: { answers: Record<string, unknown> | null; submitted: boolean | null; updated_at: string | null }[] | null;
    tasks: { kind: string; status: TaskStatus; progress_weight: number }[] | null;
    // client_prefs.client_id is its own primary key (one row per client), so
    // PostgREST embeds this as a single object, not an array — unlike
    // briefing_answers/tasks above, which have their own surrogate id PK.
    client_prefs: { manual_seen: boolean | null } | null;
  };
  return ((data as unknown as Row[] | null) ?? []).map((row) => {
    const b = row.briefing_answers?.[0];
    const checkpoints = (row.tasks ?? []).filter((t) => t.kind === "checkpoint_comercial");
    return {
      slug: row.slug,
      name: row.name,
      answers: b?.answers ?? {},
      submitted: Boolean(b?.submitted),
      updatedAt: b?.updated_at ?? null,
      checkpointsPct: checkpointsProgress(checkpoints),
      manualSeen: Boolean(row.client_prefs?.manual_seen),
    };
  });
}

export type AdminClientDetail = {
  slug: string;
  name: string;
  is_active: boolean;
  driveLinks: { brandUrl: string | null; productsUrl: string | null; uploadsUrl: string | null };
  results: PortalPayload["results"];
  content: Record<string, unknown>;
};

// Full editable bundle for the admin editor (includes inactive clients).
export async function getAdminClientDetail(slug: string): Promise<AdminClientDetail | null> {
  const supabase = await createClient();
  const client = await getClient(slug, true);
  if (!client) return null;

  const [links, results, content] = await Promise.all([
    supabase.from("client_drive_links").select("brand_url,products_url,uploads_url").eq("client_id", client.id).limit(1),
    supabase.from("client_results").select("insights,top_metrics,report_url,feedback_url").eq("client_id", client.id).limit(1),
    supabase.from("client_content").select("data").eq("client_id", client.id).limit(1),
  ]);
  if (links.error) fail(links.error);
  if (results.error) fail(results.error);
  if (content.error) fail(content.error);

  const l = links.data?.[0] as LinksRow | undefined;
  const r = results.data?.[0] as ResultsRow | undefined;
  const c = content.data?.[0] as ContentRow | undefined;

  return {
    slug: client.slug,
    name: client.name,
    is_active: client.is_active,
    driveLinks: {
      brandUrl: l?.brand_url ?? null,
      productsUrl: l?.products_url ?? null,
      uploadsUrl: l?.uploads_url ?? null,
    },
    results: {
      insights: normalizeInsights(r?.insights),
      topMetrics: normalizeMetrics(r?.top_metrics),
      reportUrl: r?.report_url ?? null,
      feedbackUrl: r?.feedback_url ?? null,
    },
    content: (c?.data as Record<string, unknown> | null) ?? {},
  };
}

// Creates a client + its three empty child rows (briefing/links/results).
export async function createClientWithChildren(input: {
  slug: string;
  name: string;
  is_active: boolean;
}): Promise<ClientRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({ slug: input.slug, name: input.name, is_active: input.is_active })
    .select("id,slug,name,is_active")
    .limit(1);
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "Ja existe um cliente com esse slug.");
    fail(error);
  }
  const client = data?.[0] as ClientRow | undefined;
  if (!client) throw new HttpError(503, "Nao foi possivel criar o cliente.");

  const [b, l, r] = await Promise.all([
    supabase.from("briefing_answers").insert({ client_id: client.id }),
    supabase.from("client_drive_links").insert({ client_id: client.id }),
    supabase.from("client_results").insert({ client_id: client.id }),
  ]);
  if (b.error) fail(b.error);
  if (l.error) fail(l.error);
  if (r.error) fail(r.error);
  await provisionCheckpointsForClient(client.id);
  return client;
}

// Applies the admin edit bundle (client name/active + links + results + content) in place.
export async function updateClientBundle(
  clientId: string,
  patches: {
    client?: Record<string, unknown>;
    links?: Record<string, unknown>;
    results?: Record<string, unknown>;
    content?: Record<string, unknown>;
  },
): Promise<void> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  if (patches.client && Object.keys(patches.client).length) {
    const { error } = await supabase
      .from("clients")
      .update({ ...patches.client, updated_at: now })
      .eq("id", clientId);
    if (error) fail(error);
  }
  if (patches.links && Object.keys(patches.links).length) {
    const { error } = await supabase
      .from("client_drive_links")
      .update({ ...patches.links, updated_at: now })
      .eq("client_id", clientId);
    if (error) fail(error);
  }
  if (patches.results && Object.keys(patches.results).length) {
    const { error } = await supabase
      .from("client_results")
      .update({ ...patches.results, updated_at: now })
      .eq("client_id", clientId);
    if (error) fail(error);
  }
  if (patches.content !== undefined) {
    const { error } = await supabase
      .from("client_content")
      .upsert({ client_id: clientId, data: patches.content, updated_at: now }, { onConflict: "client_id" });
    if (error) fail(error);
  }
}

// ---- Tasks / Kanban (admin) -------------------------------------------------

export async function listTasks(clientId: string): Promise<TaskRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("client_id", clientId)
    .order("position")
    .order("created_at");
  if (error) fail(error);
  return (data as TaskRecord[] | null) ?? [];
}

// Unassigned board — tasks created without a client ("Outros" filter). client_id
// IS NULL never satisfies a client-role RLS policy's `client_id = current_client_id()`
// check, so these rows are naturally invisible to every client session already;
// only admins (the "tasks admin all" policy) can ever see them.
export async function listUnassignedTasks(): Promise<TaskRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .is("client_id", null)
    .order("position")
    .order("created_at");
  if (error) fail(error);
  return (data as TaskRecord[] | null) ?? [];
}

export type BoardTask = TaskRecord & { clientName: string; clientSlug: string };

/** Cross-client Kanban feed — powers the "Todos" option in the client filter. */
export async function listAllTasks(): Promise<BoardTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(`${TASK_COLUMNS},clients(name,slug)`)
    .order("position")
    .order("created_at");
  if (error) fail(error);
  type JoinedClient = { name: string; slug: string };
  type Row = TaskRecord & { clients: JoinedClient | JoinedClient[] | null };
  return ((data as unknown as Row[] | null) ?? []).map(({ clients, ...task }) => {
    const c = Array.isArray(clients) ? clients[0] : clients;
    return { ...task, clientName: c?.name ?? "Outros", clientSlug: c?.slug ?? "" };
  });
}

// ---- Planos de Ação (admin) --------------------------------------------------
// A `plano_acao` card with its member activities (plan_id) grouped under it, each
// with its own workflow progress, plus the plan's rolled-up progress. Powers the
// /admin/plano accordion.

export type PlanActivity = { id: string; title: string; kind: string; status: TaskStatus; progress: number; assignee: string | null; due_date: string | null };
export type ActionPlan = TaskRecord & { clientName: string; clientSlug: string; progress: number; activities: PlanActivity[] };

export async function listActionPlans(): Promise<ActionPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(`${TASK_COLUMNS},clients(name,slug)`)
    .order("position")
    .order("created_at");
  if (error) fail(error);
  type JoinedClient = { name: string; slug: string };
  type Row = TaskRecord & { clients: JoinedClient | JoinedClient[] | null };
  const rows = (data as unknown as Row[] | null) ?? [];
  const membersByPlan = new Map<string, TaskRecord[]>();
  for (const r of rows) {
    if (!r.plan_id) continue;
    const list = membersByPlan.get(r.plan_id);
    if (list) list.push(r); else membersByPlan.set(r.plan_id, [r]);
  }
  return rows
    .filter((r) => r.kind === "plano_acao")
    .map(({ clients, ...task }) => {
      const c = Array.isArray(clients) ? clients[0] : clients;
      const members = membersByPlan.get(task.id) ?? [];
      return {
        ...task,
        clientName: c?.name ?? "—",
        clientSlug: c?.slug ?? "",
        progress: taskProgress(task, members),
        activities: members.map((m) => ({
          id: m.id, title: m.title, kind: m.kind, status: m.status, progress: taskProgress(m),
          assignee: m.assignee, due_date: m.due_date,
        })),
      };
    });
}

// Single task read through the caller's own RLS-bound session — for an admin
// this sees any task, for a client session this only resolves rows their
// "tasks client read visible" policy allows (client_visible=true, own
// client), so a non-visible/foreign task simply comes back as null.
export async function getTaskById(id: string): Promise<TaskRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").select(TASK_COLUMNS).eq("id", id).limit(1);
  if (error) fail(error);
  return (data?.[0] as TaskRecord | undefined) ?? null;
}

export async function createTask(clientId: string | null, input: Record<string, unknown>): Promise<TaskRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...input, client_id: clientId })
    .select(TASK_COLUMNS)
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as TaskRecord | undefined;
  if (!row) throw new HttpError(503, "Nao foi possivel criar a tarefa.");
  return row;
}

export async function updateTask(id: string, patch: Record<string, unknown>): Promise<TaskRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(TASK_COLUMNS)
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as TaskRecord | undefined;
  if (!row) throw new HttpError(404, "Tarefa nao encontrada.");
  return row;
}

export async function deleteTask(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) fail(error);
}

// ---- Revisões & Aprovações (admin) -------------------------------------------
// Both queues are cross-client views over `tasks` — no dedicated table, the
// Kanban is the source. Each screen fetches exactly the status(es) that live
// in its matching Kanban column(s), so a card only ever shows up on the one
// screen that matches where it currently sits on the board:
//   - Revisões    -> "revisao"              (reviewer working it before sending onward)
//   - Aprovações  -> "aprovacao"+"aprovado"  (awaiting/just past the approval gate)
// client_visible is never flipped implicitly by these actions — only the
// explicit toggle in the task editor controls it.

export type ApprovalRecord = TaskRecord & {
  updated_at: string | null; clientName: string; clientSlug: string; reviewerName: string | null; approverName: string | null;
};

type JoinedClient = { name: string; slug: string };
type JoinedReviewer = { full_name: string | null };
type ApprovalRow = TaskRecord & {
  updated_at: string | null;
  clients: JoinedClient | JoinedClient[] | null;
  reviewer: JoinedReviewer | JoinedReviewer[] | null;
  approver: JoinedReviewer | JoinedReviewer[] | null;
};

function toApprovalRecords(rows: ApprovalRow[] | null): ApprovalRecord[] {
  return (rows ?? []).map(({ clients, reviewer, approver, ...task }) => {
    const c = Array.isArray(clients) ? clients[0] : clients;
    const r = Array.isArray(reviewer) ? reviewer[0] : reviewer;
    const a = Array.isArray(approver) ? approver[0] : approver;
    return { ...task, clientName: c?.name ?? "—", clientSlug: c?.slug ?? "", reviewerName: r?.full_name ?? null, approverName: a?.full_name ?? null };
  });
}

async function selectApprovalRows(statuses: TaskStatus[]): Promise<ApprovalRow[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(`${TASK_COLUMNS},updated_at,clients(name,slug),reviewer:profiles!tasks_reviewer_id_fkey(full_name),approver:profiles!tasks_approver_id_fkey(full_name)`)
    .in("status", statuses)
    .order("updated_at", { ascending: false });
  if (error) fail(error);
  return data as unknown as ApprovalRow[] | null;
}

/** Tela Revisões: cards atualmente na coluna "Revisão" do Kanban. Um cliente
 *  com Revisão admin-desligada nunca aparece aqui, ainda que a aba (cross-client,
 *  não pode "sumir" por causa de um único cliente) continue no menu. */
export async function listReviewQueue(): Promise<ApprovalRecord[]> {
  const [rows, flagsMap] = await Promise.all([selectApprovalRows(["revisao"]), listAllClientFlowFlags()]);
  return toApprovalRecords(rows).filter((r) => (r.client_id ? flagsMap.get(r.client_id)?.revisaoAdmin ?? true : true));
}

/** Tela Aprovações: cards nas colunas "Aprovação" e "Concluído" do Kanban. Mesmo
 *  filtro por cliente que listReviewQueue, para a etapa de Aprovação. */
export async function listApprovalQueue(): Promise<ApprovalRecord[]> {
  const [rows, flagsMap] = await Promise.all([selectApprovalRows(["aprovacao", "aprovado"]), listAllClientFlowFlags()]);
  return toApprovalRecords(rows).filter((r) => (r.client_id ? flagsMap.get(r.client_id)?.aprovacaoAdmin ?? true : true));
}

// ---- Performance / métricas (admin) -----------------------------------------
// A published card (status "concluido"/Publicado) can have real-world results
// registered against it — cross-client, one row per task in `task_metrics`.

export type PublishedTask = TaskRecord & {
  updated_at: string | null;
  clientName: string;
  clientSlug: string;
  metrics: Record<string, string>;
  metricsSource: string;
  metricsUpdatedAt: string | null;
};

export async function listPublishedTasks(): Promise<PublishedTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(`${TASK_COLUMNS},updated_at,clients(name,slug),task_metrics(metrics,source,updated_at)`)
    .eq("status", "concluido")
    .order("updated_at", { ascending: false });
  if (error) fail(error);
  type JoinedClient = { name: string; slug: string };
  type JoinedMetrics = { metrics: Record<string, string> | null; source: string; updated_at: string | null };
  type Row = TaskRecord & {
    updated_at: string | null;
    clients: JoinedClient | JoinedClient[] | null;
    task_metrics: JoinedMetrics | JoinedMetrics[] | null;
  };
  return ((data as unknown as Row[] | null) ?? []).map(({ clients, task_metrics, ...task }) => {
    const c = Array.isArray(clients) ? clients[0] : clients;
    const m = Array.isArray(task_metrics) ? task_metrics[0] : task_metrics;
    return {
      ...task,
      clientName: c?.name ?? "—",
      clientSlug: c?.slug ?? "",
      metrics: m?.metrics ?? {},
      metricsSource: m?.source ?? "manual",
      metricsUpdatedAt: m?.updated_at ?? null,
    };
  });
}

export async function upsertTaskMetrics(
  taskId: string,
  clientId: string,
  metrics: Record<string, unknown>,
): Promise<{ metrics: Record<string, string>; source: string; updated_at: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_metrics")
    .upsert({ task_id: taskId, client_id: clientId, metrics }, { onConflict: "task_id" })
    .select("metrics,source,updated_at")
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as { metrics: Record<string, string>; source: string; updated_at: string | null } | undefined;
  if (!row) throw new HttpError(503, "Nao foi possivel salvar as metricas.");
  return row;
}

// ---- Documents (admin) ------------------------------------------------------

const DOC_COLUMNS = "id,client_id,name,doc_type,status,file_url,doc_date,read_at";

export type AdminDocument = DocumentRecord & { clientName: string; clientSlug: string };

export async function listDocuments(): Promise<AdminDocument[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select(`${DOC_COLUMNS},clients(name,slug)`)
    .order("doc_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) fail(error);
  type JoinedClient = { name: string; slug: string };
  type Row = DocumentRecord & { clients: JoinedClient | JoinedClient[] | null };
  return ((data as unknown as Row[] | null) ?? []).map(({ clients, ...doc }) => {
    const c = Array.isArray(clients) ? clients[0] : clients;
    return { ...doc, clientName: c?.name ?? "—", clientSlug: c?.slug ?? "" };
  });
}

export async function createDocument(clientId: string, input: Record<string, unknown>): Promise<DocumentRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .insert({ ...input, client_id: clientId })
    .select(DOC_COLUMNS)
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as DocumentRecord | undefined;
  if (!row) throw new HttpError(503, "Nao foi possivel criar o documento.");
  return row;
}

export async function updateDocument(id: string, patch: Record<string, unknown>): Promise<DocumentRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .update(patch)
    .eq("id", id)
    .select(DOC_COLUMNS)
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as DocumentRecord | undefined;
  if (!row) throw new HttpError(404, "Documento nao encontrado.");
  return row;
}

export async function deleteDocument(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) fail(error);
}

// ---- Acessos & Pastas (platform credentials) -----------------------------------

type CredentialRow = { platform: string; username: string; password: string; notes: string; updated_at: string };

export async function listClientCredentials(clientId: string): Promise<CredentialSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_platform_credentials")
    .select("platform,username,password,notes,updated_at")
    .eq("client_id", clientId);
  if (error) fail(error);
  const byPlatform = new Map((data as CredentialRow[] | null ?? []).map((r) => [r.platform, r]));
  return ACCESS_PLATFORMS.map((p): CredentialSummary => {
    const row = byPlatform.get(p.key);
    return {
      platform: p.key,
      username: row?.username ?? "",
      hasPassword: Boolean(row?.password),
      notes: row?.notes ?? "",
      updatedAt: row?.updated_at ?? "",
    };
  });
}

// Upsert-by-(client,platform). A blank password keeps whatever was already
// stored — password fields never round-trip plaintext to the client, so
// "leave blank to keep the current password" is the only way to edit
// everything else without forcing a re-entry of the secret.
export async function upsertClientCredential(
  clientId: string,
  input: { platform: AccessPlatformKey; username: string; password?: string; notes?: string },
): Promise<CredentialSummary> {
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("client_platform_credentials")
    .select("password")
    .eq("client_id", clientId)
    .eq("platform", input.platform)
    .limit(1);
  if (readError) fail(readError);
  const currentPassword = (existing?.[0] as { password: string } | undefined)?.password ?? "";

  const { data, error } = await supabase
    .from("client_platform_credentials")
    .upsert(
      {
        client_id: clientId,
        platform: input.platform,
        username: input.username,
        password: input.password?.trim() ? input.password.trim() : currentPassword,
        notes: input.notes ?? "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,platform" },
    )
    .select("platform,username,password,notes,updated_at")
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as CredentialRow | undefined;
  if (!row) throw new HttpError(503, "Nao foi possivel salvar o acesso.");
  return { platform: row.platform as AccessPlatformKey, username: row.username, hasPassword: Boolean(row.password), notes: row.notes, updatedAt: row.updated_at };
}

// Client-side "mark as read" — used by the Documentos viewer modal so Jornada
// can reflect a real "leu os documentos" state. Scoped to clientId in the
// WHERE clause as a second layer on top of the "documents client mark read"
// RLS policy; only ever writes read_at (never trusts client-supplied fields).
export async function markDocumentRead(id: string, clientId: string): Promise<DocumentRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("client_id", clientId)
    .select(DOC_COLUMNS)
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as DocumentRecord | undefined;
  if (!row) throw new HttpError(404, "Documento nao encontrado.");
  return row;
}

// ---- Commercial checkpoint templates (admin-configurable, Configurações) ----
// The mold only. Per-client instances are `tasks` rows (kind='checkpoint_comercial'),
// auto-created from this list by provisionCheckpointsForClient. See [[auth-admin-build]].

export type CheckpointTemplate = {
  id: string;
  title: string;
  description: string | null;
  order_index: number;
  active: boolean;
};

const CHECKPOINT_TEMPLATE_COLUMNS = "id,title,description,order_index,active";

export async function listCheckpointTemplates(): Promise<CheckpointTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commercial_checkpoint_templates")
    .select(CHECKPOINT_TEMPLATE_COLUMNS)
    .order("order_index");
  if (error) fail(error);
  return (data as CheckpointTemplate[] | null) ?? [];
}

export async function createCheckpointTemplate(input: {
  title: string;
  description?: string | null;
  order_index?: number;
  active?: boolean;
}): Promise<CheckpointTemplate> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commercial_checkpoint_templates")
    .insert(input)
    .select(CHECKPOINT_TEMPLATE_COLUMNS)
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as CheckpointTemplate | undefined;
  if (!row) throw new HttpError(503, "Nao foi possivel criar o checkpoint.");
  return row;
}

export async function updateCheckpointTemplate(id: string, patch: Record<string, unknown>): Promise<CheckpointTemplate> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commercial_checkpoint_templates")
    .update(patch)
    .eq("id", id)
    .select(CHECKPOINT_TEMPLATE_COLUMNS)
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as CheckpointTemplate | undefined;
  if (!row) throw new HttpError(404, "Checkpoint nao encontrado.");
  return row;
}

export async function deleteCheckpointTemplate(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("commercial_checkpoint_templates").delete().eq("id", id);
  if (error) fail(error);
}

// Instantiates a real `tasks` card (kind='checkpoint_comercial') per active
// template for a client — called on client creation and available as a manual
// backfill for clients that predate this feature.
export async function provisionCheckpointsForClient(clientId: string): Promise<void> {
  const supabase = await createClient();
  const templates = await listCheckpointTemplates();
  const active = templates.filter((t) => t.active);
  if (active.length === 0) return;
  const rows = active.map((t) => ({
    client_id: clientId,
    kind: "checkpoint_comercial",
    title: t.title,
    description: t.description,
    status: "backlog" as TaskStatus,
    client_visible: true,
    position: t.order_index * 10,
  }));
  const { error } = await supabase.from("tasks").insert(rows);
  if (error) fail(error);
}

// ---- Configurações: legal docs + agency settings + team ---------------------

export type LegalDoc = { slug: string; title: string; body: string; status: "rascunho" | "publicada"; updated_at: string | null };

export async function listLegalDocs(): Promise<LegalDoc[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_docs")
    .select("slug,title,body,status,updated_at")
    .order("slug");
  if (error) fail(error);
  return (data as LegalDoc[] | null) ?? [];
}

export async function updateLegalDoc(slug: string, patch: Record<string, unknown>): Promise<LegalDoc> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_docs")
    .update(patch)
    .eq("slug", slug)
    .select("slug,title,body,status,updated_at")
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as LegalDoc | undefined;
  if (!row) throw new HttpError(404, "Documento legal nao encontrado.");
  return row;
}

// Platform-wide master switch for "Visível para o cliente" — when off, every
// client_visible flag is treated as false regardless of its DB value
// (enforced in getPortalPayload, not just the UI toggle).
export async function getPlanoVisibility(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("site_settings").select("value").eq("key", "plano_acao_visibility").limit(1);
  if (error) fail(error);
  const value = (data?.[0] as { value: { enabled?: boolean } } | undefined)?.value;
  return value?.enabled ?? false;
}

export async function savePlanoVisibility(enabled: boolean): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("site_settings")
    .upsert({ key: "plano_acao_visibility", value: { enabled }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) fail(error);
  return enabled;
}

export type AgencyProfile = { name: string; email: string; site: string; note: string };
const AGENCY_DEFAULT: AgencyProfile = { name: "North", email: "", site: "", note: "" };

export async function getAgencyProfile(): Promise<AgencyProfile> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("site_settings").select("value").eq("key", "agency").limit(1);
  if (error) fail(error);
  const value = (data?.[0] as { value: Record<string, unknown> } | undefined)?.value ?? {};
  return { ...AGENCY_DEFAULT, ...(value as Partial<AgencyProfile>) };
}

export async function saveAgencyProfile(value: AgencyProfile): Promise<AgencyProfile> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("site_settings")
    .upsert({ key: "agency", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) fail(error);
  return value;
}

export type TeamMember = {
  id: string;
  full_name: string | null;
  role: "admin" | "client";
  client_id: string | null;
  level: string | null;
};

// Best-effort display name for the sidebar account card; falls back to null
// (caller derives something from the e-mail) rather than throwing.
export async function getProfileName(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("full_name").eq("id", userId).limit(1);
  if (error) return null;
  const name = (data?.[0] as { full_name: string | null } | undefined)?.full_name;
  return name?.trim() || null;
}

export async function listTeam(): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,role,client_id,level")
    .order("role");
  if (error) fail(error);
  return (data as TeamMember[] | null) ?? [];
}

// Reviewer candidates for a task — split by stage, since a reviewer is never
// a client during internal review (Revisão) and never an admin once the card
// is client-facing (Aprovação+): a client account should not show up as a
// candidate for internal review, and vice-versa.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reviewerLabel(p: TeamMember): string {
  const base = p.full_name?.trim() || (p.role === "admin" ? "Administrador" : "Cliente");
  return p.level === "gerente" ? `${base} (gerente)` : base;
}

/** Candidates for the internal Revisão stage — admin accounts only. */
export async function listAdminReviewers(): Promise<ReviewerCandidate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,role,client_id,level")
    .eq("role", "admin")
    .order("full_name");
  if (error) fail(error);
  return ((data as TeamMember[] | null) ?? []).map((p) => ({ id: p.id, role: p.role, label: reviewerLabel(p) }));
}

/** Candidates for the client-facing Aprovação stage — that client's own accounts only. */
export async function listClientReviewerCandidates(clientId: string): Promise<ReviewerCandidate[]> {
  if (!uuidPattern.test(clientId)) throw new HttpError(400, "Cliente invalido.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,role,client_id,level")
    .eq("client_id", clientId)
    .order("full_name");
  if (error) fail(error);
  return ((data as TeamMember[] | null) ?? []).map((p) => ({ id: p.id, role: p.role, label: reviewerLabel(p) }));
}
