import { createClient } from "./supabase/server";
import {
  currentRecurringExecutionFields,
  explicitDateExecutionFields,
  nextRecurringDueDate,
  recurringExecutionFields,
  recurringExecutionId,
} from "./recurrence";
import { RECURRENCE_CYCLE_KEY, RECURRENCE_GROUP_KEY, RECURRENCE_REVISION_KEY, recurrenceCycleOf, recurrenceParentPayload, recurrenceRevisionOf } from "./recurrenceState";
import { EXPLICIT_GROUP_KEY, explicitDatesOf, inferDateGroupRule, isExplicitDateParent, normalizeOccurrenceDates, parentTemplatePatch, replicaPatch } from "./taskDateGrouping";
import { mergeAssigneeDisplay } from "./assignees";
import { actionPlanIdOf, actionPlanMembersOf, belongsToTaskScreen, detachedTaskRelationPatch, recurrenceParentIdOf, visibleOnTaskBoard, withActionPlanId } from "./taskRelations";
import {
  HttpError,
  normalizeInsights,
  normalizeMetrics,
  flowFlagsCascadeEffects,
  scopeItemSchema,
  ACCESS_PLATFORMS,
  type AccessPlatformKey,
  type AdminTabsVisibility,
  type ClientFlowFlags,
  type ClientTask,
  type CompanyInfo,
  type ContractInfo,
  type ScopeItem,
  type CredentialSummary,
  type DocumentRecord,
  type PortalPayload,
  type PortalPrefs,
  type ReviewerCandidate,
  type RecurringCadence,
  type RecurringTaskRecord,
  type TaskRecord,
  type TaskStatus,
} from "./validation";
import { defaultContent, type PortalContent, type Tone } from "@/app/[slug]/portalData";
import { WINDSOR_SETTINGS_DEFAULT, type MetaPost, type WindsorDatasource, type WindsorSettings } from "./windsor";
import { AI_PROVIDER_SETTINGS_DEFAULT, type AiProviderSettings, type AiVendor } from "./aiProviders";
import { META_ADS_ADSET_DATASOURCE, META_ADS_CREATIVE_DATASOURCE, META_ADS_DATASOURCE } from "./metaInsights";
import { sanitizePerformanceViewPrefs, type PerformanceViewPrefs } from "./performancePrefs";
import {
  sanitizePerformanceTemplateConfig,
  type PerformanceTemplate,
  type PerformanceTemplateConfig,
} from "./performanceTemplates";
import { taskProgress, checkpointsProgress, kindLabel, kindTone, subtypeLabel } from "./taskCatalog";
import { averageProgress, isOverdue, plansInProgress, weekAhead } from "./adminHome";
import { vaultDelete, vaultRead, vaultSet, vaultUpdate } from "./vault";
import type { MetaAdAccount } from "./meta";

type ContentRow = { data: Record<string, unknown> | null };
type PrefsRow = { theme: string | null; avatar_style: number | null; display_name: string | null; username: string | null; manual_seen: boolean | null };

export const TASK_COLUMNS =
  "id,client_id,kind,subtype,title,status,priority,assignee,reviewer_id,approver_id,plan_id,requires_review,requires_approval,due_date,start_date,end_date,scheduled_start_at,scheduled_end_at,progress_weight,description,client_visible,payload,position,recurrence_cadence,recurrence_weekdays,recurrence_day_of_month,updated_at,created_by,created_at,completed_at";

// Responsável linked to a real account (task_assignees), merged into the
// legacy `assignee` free-text column at read time — see mergeAssigneeDisplay.
// Every read path that ends up in a UI-facing response selects this instead
// of the bare TASK_COLUMNS so `assignee` always reflects linked accounts too.
const TASK_ASSIGNEES_JOIN = "task_assignees(profile:profiles(id,full_name))";
const TASK_AUTHOR_JOIN = "created_by_profile:profiles!tasks_created_by_fkey(full_name)";
const TASK_COLUMNS_WITH_ASSIGNEES = `${TASK_COLUMNS},${TASK_ASSIGNEES_JOIN},${TASK_AUTHOR_JOIN}`;

type JoinedAssigneeProfile = { id: string; full_name: string | null };
type JoinedAuthor = { full_name: string | null };
type TaskAssigneesJoin = {
  task_assignees?: { profile: JoinedAssigneeProfile | JoinedAssigneeProfile[] | null }[] | null;
  created_by_profile?: JoinedAuthor | JoinedAuthor[] | null;
};

// Merges linked-account names into the legacy free-text `assignee` column
// (mergeAssigneeDisplay) and surfaces the linked profile ids too, so the
// picker can pre-select real-account chips wherever a task object already
// flows (Kanban board state, modal, detail panel) without a second request —
// same precedent as reviewer_id/approver_id already being plain fields.
function mergeTaskAssigneeRow<T extends { assignee: string | null } & TaskAssigneesJoin>(
  row: T,
): Omit<T, "task_assignees" | "created_by_profile"> & { assignee_profile_ids: string[]; created_by_name: string | null } {
  const { task_assignees, created_by_profile, ...rest } = row;
  const linkedProfiles = (task_assignees ?? [])
    .map((r) => (Array.isArray(r.profile) ? r.profile[0] : r.profile))
    .filter((p): p is JoinedAssigneeProfile => Boolean(p));
  const author = Array.isArray(created_by_profile) ? created_by_profile[0] : created_by_profile;
  return {
    ...rest,
    assignee: mergeAssigneeDisplay(rest.assignee, linkedProfiles.map((p) => p.full_name)),
    assignee_profile_ids: linkedProfiles.map((p) => p.id),
    created_by_name: author?.full_name ?? null,
  };
}


const STATUS_KANBAN: Record<TaskStatus, string> = {
  backlog: "Kanban · Entrada",
  em_producao: "Kanban · Em produção",
  revisao: "Kanban · Revisão",
  aprovacao: "Kanban · Aprovação",
  aprovado: "Kanban · Concluído",
  concluido: "Kanban · Publicado",
  parada: "Kanban · Parada",
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
    const members = actionPlanMembersOf(t.id, allRows);
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

// During a rolling deploy the application can reach production before a new
// optional feature migration. Keep established screens available only for
// that precise PostgREST "table missing from schema cache" response; all
// connectivity, permission and query errors must still fail loudly.
function isMissingOptionalTable(error: { message?: string; code?: string } | null, table: string): boolean {
  return error?.code === "PGRST205" && Boolean(error.message?.includes(`public.${table}`));
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
    // "parada" (automation halted, needs admin attention) is excluded
    // unconditionally — an internal error state, never client-facing even
    // when client_visible=true on the underlying card.
    supabase
      .from("tasks")
      .select(TASK_COLUMNS_WITH_ASSIGNEES)
      .eq("client_id", client.id)
      .or("client_visible.eq.true,status.in.(aprovacao,aprovado,concluido)")
      .neq("status", "parada")
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
  const taskRows = ((tasks.data as unknown as (ClientTask & TaskAssigneesJoin)[] | null) ?? []).map(mergeTaskAssigneeRow);
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
  disabled: boolean;
  updated_at: string | null;
  briefing_submitted: boolean;
};

type ListClientRow = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  disabled: boolean;
  updated_at: string | null;
  briefing_answers: { submitted: boolean | null }[] | null;
};

// Every picker/dropdown across the app (Kanban's Cliente filter, TaskModal's
// Cliente select, Etapas, PlanSearchBar, Performance...) goes through this
// function, so excluding disabled=true here by default is what makes "Remover
// do sistema" (soft-delete) actually hide a client platform-wide. The
// Clientes admin screen itself passes includeDisabled so it can still find
// and re-enable them.
export async function listClients(opts?: { includeDisabled?: boolean }): Promise<AdminClientSummary[]> {
  const supabase = await createClient();
  let query = supabase
    .from("clients")
    .select("id,slug,name,is_active,disabled,updated_at,briefing_answers(submitted)")
    .order("name");
  if (!opts?.includeDisabled) query = query.eq("disabled", false);
  const { data, error } = await query;
  if (error) fail(error);
  return ((data as ListClientRow[] | null) ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    is_active: row.is_active,
    disabled: row.disabled,
    updated_at: row.updated_at,
    briefing_submitted: Boolean(row.briefing_answers?.[0]?.submitted),
  }));
}

// ---- Client flow flags (Revisão/Aprovação safe-hide, per client) --------------
// Absence of a row means every flag is on (today's behavior for a client that
// was never explicitly configured).

const FLOW_FLAGS_COLUMNS = "revisao_admin,revisao_cliente,aprovacao_admin,aprovacao_cliente";

type ClientFlowFlagsRow = {
  revisao_admin: boolean;
  revisao_cliente: boolean;
  aprovacao_admin: boolean;
  aprovacao_cliente: boolean;
};

// Absence of a row is the "natural" state: admin/cliente off (Revisão and
// Aprovação are dormant everywhere by default).
function toFlowFlags(row: ClientFlowFlagsRow | undefined): ClientFlowFlags {
  return {
    revisaoAdmin: row?.revisao_admin ?? false,
    revisaoCliente: row?.revisao_cliente ?? false,
    aprovacaoAdmin: row?.aprovacao_admin ?? false,
    aprovacaoCliente: row?.aprovacao_cliente ?? false,
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
// client can never see/act on a stage the admin side doesn't run). Turning
// admin off also clears any assigned revisor/aprovador and moves any of that
// client's cards sitting in that stage back to "em_producao" — the Kanban
// column itself has no flag; it just disappears on its own once nothing sits
// in it (see KanbanBoard's visibleColumns).
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
        aprovacao_admin: next.aprovacaoAdmin,
        aprovacao_cliente: next.aprovacaoCliente,
      },
      { onConflict: "client_id" },
    )
    .select(FLOW_FLAGS_COLUMNS)
    .limit(1);
  if (error) fail(error);

  // "Sem revisor"/"sem aprovador" from the moment the flow is disabled, not
  // lazily on next save — see flowFlagsCascadeEffects for the (unit-tested)
  // decision of when this fires.
  const moves: PromiseLike<unknown>[] = [];
  for (const effect of flowFlagsCascadeEffects(current, next)) {
    if (effect === "clear_reviewer_and_move_revisao_to_em_producao") {
      moves.push(supabase.from("tasks").update({ reviewer_id: null, requires_review: false }).eq("client_id", clientId).not("reviewer_id", "is", null));
      moves.push(supabase.from("tasks").update({ status: "em_producao" }).eq("client_id", clientId).eq("status", "revisao"));
    } else {
      moves.push(supabase.from("tasks").update({ approver_id: null, requires_approval: false }).eq("client_id", clientId).not("approver_id", "is", null));
      moves.push(supabase.from("tasks").update({ status: "em_producao" }).eq("client_id", clientId).eq("status", "aprovacao"));
    }
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
    publicadoColumnVisible: value?.publicadoColumnVisible ?? false,
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

export type DriveFolderIds = {
  rootFolderId: string | null;
  brandFolderId: string | null;
  productsFolderId: string | null;
  uploadsFolderId: string | null;
  syncedAt: string | null;
};

// ---- Home do admin -----------------------------------------------------------

export type AdminHomeSummary = {
  reviewQueueCount: number;
  approvalQueueCount: number;
  overdueTasks: number;
  actionPlansInProgress: number;
  actionPlansAvgProgress: number;
  /** Total de tarefas não realizadas na janela de 7 dias — separado de
   *  `weekAhead` porque a lista é truncada para não inchar o payload. */
  weekAheadCount: number;
  weekAhead: { id: string; title: string; clientName: string; clientSlug: string; dueDate: string; status: TaskStatus }[];
};

/**
 * Everything the /admin/home KPIs need, assembled from queries that already
 * exist plus one light scan of dated tasks. No new table.
 */
export async function listAdminHomeSummary(): Promise<AdminHomeSummary> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // listAdminOverview() saiu daqui junto com o painel "precisam de atenção",
  // que agora vive na tela Clientes: era a query mais cara do conjunto (join de
  // tasks por cliente) e a Home não usa mais nada dela.
  const [plans, reviewQueue, approvalQueue, dated] = await Promise.all([
    listActionPlans(),
    listReviewQueue(),
    listApprovalQueue(),
    supabase
      .from("tasks")
      .select("id,title,due_date,status,kind,recurrence_cadence,payload,clients(name,slug)")
      .not("due_date", "is", null)
      .neq("status", "concluido")
      .neq("status", "aprovado"),
  ]);
  if (dated.error) fail(dated.error);

  type JoinedName = { name: string; slug: string };
  type DatedRow = {
    id: string; title: string; due_date: string | null; status: TaskStatus;
    kind: string; recurrence_cadence: RecurringCadence | null; payload: Record<string, unknown>;
    clients: JoinedName | JoinedName[] | null;
  };
  // Só tarefas. Rotinas (o card-modelo recorrente) têm vocabulário e tela
  // próprios — o `due_date` delas é a PRÓXIMA execução, não um prazo vencido,
  // então somá-las aqui inventava atraso que não existe. `belongsToTaskScreen`
  // é a mesma definição que o quadro de Tarefas usa, então o KPI e a tela que
  // ele abre nunca podem discordar.
  const rows = ((dated.data as unknown as DatedRow[] | null) ?? [])
    .filter((r) => belongsToTaskScreen(r))
    .map((r) => {
    const client = Array.isArray(r.clients) ? r.clients[0] : r.clients;
    return {
      id: r.id,
      title: r.title,
      due_date: r.due_date,
      status: r.status,
      clientName: client?.name ?? "Sem cliente",
      // Sem cliente o card ainda abre: o modal aceita slug vazio (é o mesmo
      // caminho do card "Outros" no Kanban).
      clientSlug: client?.slug ?? "",
    };
  });

  return {
    reviewQueueCount: reviewQueue.length,
    approvalQueueCount: approvalQueue.length,
    overdueTasks: rows.filter((t) => isOverdue(t, today)).length,
    actionPlansInProgress: plansInProgress(plans).length,
    actionPlansAvgProgress: averageProgress(plans),
    weekAheadCount: weekAhead(rows, today).length,
    // Truncado: a lista da Home mostra os primeiros e o calendário atrás do
    // toggle cabe em 60 — o número cheio vai em weekAheadCount.
    weekAhead: weekAhead(rows, today).slice(0, 60).map((t) => ({
      id: t.id,
      title: t.title,
      clientName: t.clientName,
      clientSlug: t.clientSlug,
      dueDate: t.due_date ?? "",
      status: t.status,
    })),
  };
}

export type AdminClientDetail = {
  slug: string;
  name: string;
  is_active: boolean;
  driveLinks: { brandUrl: string | null; productsUrl: string | null; uploadsUrl: string | null };
  driveFolders: DriveFolderIds;
  results: PortalPayload["results"];
  content: Record<string, unknown>;
  companyInfo: CompanyInfo;
  contract: ContractInfo;
};

type CompanyInfoRow = { segmento: string | null; cidade_uf: string | null; instagram_ou_site: string | null };
type ContractRow = {
  plano_tier: string | null;
  escopo: unknown;
  valor_mensal: string | number | null;
  contract_start: string | null;
  responsavel_nome: string | null;
  responsavel_whatsapp: string | null;
};

function normalizeScope(raw: unknown): ScopeItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const parsed = scopeItemSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

// Full editable bundle for the admin editor (includes inactive clients).
export async function getAdminClientDetail(slug: string): Promise<AdminClientDetail | null> {
  const supabase = await createClient();
  const client = await getClient(slug, true);
  if (!client) return null;

  const [links, results, content, company, contract] = await Promise.all([
    supabase
      .from("client_drive_links")
      .select("brand_url,products_url,uploads_url,root_folder_id,brand_folder_id,products_folder_id,uploads_folder_id,drive_synced_at")
      .eq("client_id", client.id)
      .limit(1),
    supabase.from("client_results").select("insights,top_metrics,report_url,feedback_url").eq("client_id", client.id).limit(1),
    supabase.from("client_content").select("data").eq("client_id", client.id).limit(1),
    supabase.from("client_company_info").select("segmento,cidade_uf,instagram_ou_site").eq("client_id", client.id).limit(1),
    supabase
      .from("client_contract")
      .select("plano_tier,escopo,valor_mensal,contract_start,responsavel_nome,responsavel_whatsapp")
      .eq("client_id", client.id)
      .limit(1),
  ]);
  if (links.error) fail(links.error);
  if (results.error) fail(results.error);
  if (content.error) fail(content.error);
  if (company.error) fail(company.error);
  if (contract.error) fail(contract.error);

  const l = links.data?.[0] as (LinksRow & Record<string, string | null>) | undefined;
  const r = results.data?.[0] as ResultsRow | undefined;
  const c = content.data?.[0] as ContentRow | undefined;
  const ci = company.data?.[0] as CompanyInfoRow | undefined;
  const ct = contract.data?.[0] as ContractRow | undefined;

  return {
    slug: client.slug,
    name: client.name,
    is_active: client.is_active,
    driveLinks: {
      brandUrl: l?.brand_url ?? null,
      productsUrl: l?.products_url ?? null,
      uploadsUrl: l?.uploads_url ?? null,
    },
    driveFolders: {
      rootFolderId: l?.root_folder_id ?? null,
      brandFolderId: l?.brand_folder_id ?? null,
      productsFolderId: l?.products_folder_id ?? null,
      uploadsFolderId: l?.uploads_folder_id ?? null,
      syncedAt: l?.drive_synced_at ?? null,
    },
    results: {
      insights: normalizeInsights(r?.insights),
      topMetrics: normalizeMetrics(r?.top_metrics),
      reportUrl: r?.report_url ?? null,
      feedbackUrl: r?.feedback_url ?? null,
    },
    content: (c?.data as Record<string, unknown> | null) ?? {},
    companyInfo: {
      segmento: ci?.segmento ?? null,
      cidadeUf: ci?.cidade_uf ?? null,
      instagramOuSite: ci?.instagram_ou_site ?? null,
    },
    contract: {
      planoTier: (ct?.plano_tier as ContractInfo["planoTier"]) ?? null,
      escopo: normalizeScope(ct?.escopo),
      valorMensal: ct?.valor_mensal === null || ct?.valor_mensal === undefined ? null : Number(ct.valor_mensal),
      contractStart: ct?.contract_start ?? null,
      responsavelNome: ct?.responsavel_nome ?? null,
      responsavelWhatsapp: ct?.responsavel_whatsapp ?? null,
    },
  };
}

// Creates a client + its child rows (briefing/links/results/company/contract),
// the commercial checkpoints, and the kickoff card on the Kanban.
//
// briefing_answers is created unconditionally: it IS the client's onboarding
// questionnaire (app/[slug]/content.ts) and getPortalPayload assumes the row
// exists. The "Criar briefing de onboarding" toggle in the form reflects that
// rather than gating it.
export async function createClientWithChildren(input: {
  slug: string;
  name: string;
  is_active: boolean;
  companyInfo?: CompanyInfo;
  contract?: ContractInfo;
  checkpointTemplateIds?: string[];
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

  const [b, l, r, ci, ct] = await Promise.all([
    supabase.from("briefing_answers").insert({ client_id: client.id }),
    supabase.from("client_drive_links").insert({ client_id: client.id }),
    supabase.from("client_results").insert({ client_id: client.id }),
    supabase.from("client_company_info").insert({ client_id: client.id, ...companyInfoPatch(input.companyInfo) }),
    supabase.from("client_contract").insert({ client_id: client.id, ...contractPatch(input.contract) }),
  ]);
  if (b.error) fail(b.error);
  if (l.error) fail(l.error);
  if (r.error) fail(r.error);
  if (ci.error) fail(ci.error);
  if (ct.error) fail(ct.error);
  await provisionCheckpointsForClient(client.id, input.checkpointTemplateIds);
  await provisionKickoffTask(client.id);
  return client;
}

// The "card no Kanban" half of the AO CRIAR checklist. Reuses the existing
// planejamento/briefing vocabulary from lib/taskCatalog.ts — no new kind.
// Internal by design (client_visible false): it's the North team's own
// reminder to review what the client filled in.
export async function provisionKickoffTask(clientId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert({
    client_id: clientId,
    kind: "planejamento",
    subtype: "briefing",
    title: "Kickoff — revisar onboarding do cliente",
    description: "Conferir o briefing preenchido, os acessos concedidos e as pastas do Drive antes da reunião de kickoff.",
    status: "backlog" as TaskStatus,
    priority: "media",
    client_visible: false,
    position: 0,
  });
  if (error) fail(error);
}

// Column mappers shared by create and update — camelCase (API/Zod) to
// snake_case (Postgres). Undefined fields are dropped so a PATCH never
// blanks a column the caller didn't mention.
function companyInfoPatch(info?: CompanyInfo): Record<string, unknown> {
  if (!info) return {};
  const out: Record<string, unknown> = {};
  if (info.segmento !== undefined) out.segmento = info.segmento;
  if (info.cidadeUf !== undefined) out.cidade_uf = info.cidadeUf;
  if (info.instagramOuSite !== undefined) out.instagram_ou_site = info.instagramOuSite;
  return out;
}

function contractPatch(contract?: ContractInfo): Record<string, unknown> {
  if (!contract) return {};
  const out: Record<string, unknown> = {};
  if (contract.planoTier !== undefined) out.plano_tier = contract.planoTier;
  if (contract.escopo !== undefined) out.escopo = contract.escopo;
  if (contract.valorMensal !== undefined) out.valor_mensal = contract.valorMensal;
  if (contract.contractStart !== undefined) out.contract_start = contract.contractStart;
  if (contract.responsavelNome !== undefined) out.responsavel_nome = contract.responsavelNome;
  if (contract.responsavelWhatsapp !== undefined) out.responsavel_whatsapp = contract.responsavelWhatsapp;
  return out;
}

// Applies the admin edit bundle (client name/active + links + results + content) in place.
export async function updateClientBundle(
  clientId: string,
  patches: {
    client?: Record<string, unknown>;
    links?: Record<string, unknown>;
    results?: Record<string, unknown>;
    content?: Record<string, unknown>;
    companyInfo?: CompanyInfo;
    contract?: ContractInfo;
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
  // upsert, not update: clients created before these tables existed have no row.
  const company = companyInfoPatch(patches.companyInfo);
  if (Object.keys(company).length) {
    const { error } = await supabase
      .from("client_company_info")
      .upsert({ client_id: clientId, ...company, updated_at: now }, { onConflict: "client_id" });
    if (error) fail(error);
  }
  const contract = contractPatch(patches.contract);
  if (Object.keys(contract).length) {
    const { error } = await supabase
      .from("client_contract")
      .upsert({ client_id: clientId, ...contract, updated_at: now }, { onConflict: "client_id" });
    if (error) fail(error);
  }
}

// Records the folders created by the Drive automation. The *_url columns stay
// the single source of the link shown in the UI (so a hand-pasted link keeps
// working); the *_folder_id columns exist to re-sync and to list files.
export async function saveDriveFolderProvisioning(
  clientId: string,
  folders: { root: { id: string; url: string }; brand: { id: string; url: string }; products: { id: string; url: string }; uploads: { id: string; url: string } },
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_drive_links")
    .update({
      brand_url: folders.brand.url,
      products_url: folders.products.url,
      uploads_url: folders.uploads.url,
      root_folder_id: folders.root.id,
      brand_folder_id: folders.brand.id,
      products_folder_id: folders.products.id,
      uploads_folder_id: folders.uploads.id,
      drive_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId);
  if (error) fail(error);
}

// ---- Escopo contratado: catálogo de tags ------------------------------------
// Lives in the DB rather than an in-code catalog because the admin creates tags
// straight from the cadastro form ("+ Nova tag") and they must apply immediately.

export type ScopeTag = { id: string; key: string; label: string; has_quantity: boolean };

export async function listScopeTags(): Promise<ScopeTag[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("scope_tags").select("id,key,label,has_quantity").order("label");
  if (error) fail(error);
  return (data as ScopeTag[] | null) ?? [];
}

export async function createScopeTag(input: { label: string; hasQuantity?: boolean }): Promise<ScopeTag> {
  const supabase = await createClient();
  const key = slugifyScopeKey(input.label);
  if (!key) throw new HttpError(400, "Nome de tag invalido.");
  const { data, error } = await supabase
    .from("scope_tags")
    .upsert({ key, label: input.label.trim(), has_quantity: Boolean(input.hasQuantity) }, { onConflict: "key" })
    .select("id,key,label,has_quantity")
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as ScopeTag | undefined;
  if (!row) throw new HttpError(503, "Nao foi possivel criar a tag.");
  return row;
}

export function slugifyScopeKey(label: string): string {
  // NFD splits accented letters into base + combining mark; dropping every
  // non-ASCII code unit then leaves the plain letter, so "Captacao" and its
  // accented spelling produce the same key.
  const ascii = label
    .normalize("NFD")
    .split("")
    .filter((c) => c.charCodeAt(0) < 128)
    .join("");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// ---- Tasks / Kanban (admin) -------------------------------------------------

export type RecurringTask = TaskRecord & Omit<RecurringTaskRecord, "id" | "client_id" | "title" | "description" | "kind" | "priority" | "assignee" | "client_visible" | "position"> & {
  clientName: string;
  clientSlug: string;
  executions: TaskRecord[];
};

/** Cross-client recurring routine feed. Deliberately independent of ActionPlan. */
export async function listRecurringTasks(): Promise<RecurringTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(`${TASK_COLUMNS_WITH_ASSIGNEES},clients(name,slug,disabled)`)
    .or("recurrence_cadence.not.is.null,payload->>recurrence_group.eq.true")
    .order("position")
    .order("due_date", { nullsFirst: false });
  if (error) fail(error);
  type JoinedClient = { name: string; slug: string; disabled: boolean };
  type Row = TaskRecord & TaskAssigneesJoin & { clients: JoinedClient | JoinedClient[] | null };
  const parents = ((data as unknown as Row[] | null) ?? [])
    .filter(({ clients }) => !(Array.isArray(clients) ? clients[0] : clients)?.disabled)
    .map(mergeTaskAssigneeRow);
  const executionsByParent = new Map<string, TaskRecord[]>();
  if (parents.length) {
    const { data: executionRows, error: executionError } = await supabase
      .from("tasks")
      .select(TASK_COLUMNS_WITH_ASSIGNEES)
      .in("plan_id", parents.map((task) => task.id))
      .order("position")
      .order("due_date", { nullsFirst: false });
    if (executionError) fail(executionError);
    for (const execution of ((executionRows as unknown as (TaskRecord & TaskAssigneesJoin)[] | null) ?? []).map(mergeTaskAssigneeRow)) {
      if (!execution.plan_id) continue;
      const list = executionsByParent.get(execution.plan_id);
      if (list) list.push(execution); else executionsByParent.set(execution.plan_id, [execution]);
    }
  }
  return parents
    .map(({ clients, ...task }) => {
      const client = Array.isArray(clients) ? clients[0] : clients;
      const payload = task.payload ?? {};
      return {
        ...task,
        cadence: (task.recurrence_cadence ?? (typeof payload.recurrence_last_cadence === "string" ? payload.recurrence_last_cadence : "semanal")) as RecurringCadence,
        weekdays: task.recurrence_weekdays,
        day_of_month: task.recurrence_day_of_month, next_due_date: task.due_date,
        time_of_day: typeof payload.hora === "string" ? payload.hora : null,
        timezone: "America/Sao_Paulo", active: Boolean(task.recurrence_cadence),
        completed_cycles: typeof payload.completed_cycles === "number" ? payload.completed_cycles : 0,
        last_completed_at: typeof payload.last_completed_at === "string" ? payload.last_completed_at : null,
        template_payload: payload,
        source: typeof payload.imported_from === "string" ? payload.imported_from : null,
        external_id: typeof payload.external_id === "string" ? payload.external_id : null,
        created_at: "",
        clientName: client?.name ?? "—", clientSlug: client?.slug ?? "",
        executions: executionsByParent.get(task.id) ?? [],
      };
    });
}

export async function recurringTasksStorageAvailable(): Promise<boolean> {
  return true;
}

export async function listTasks(clientId: string): Promise<TaskRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS_WITH_ASSIGNEES)
    .eq("client_id", clientId)
    .order("position")
    .order("created_at");
  if (error) fail(error);
  return ((data as unknown as (TaskRecord & TaskAssigneesJoin)[] | null) ?? []).map(mergeTaskAssigneeRow).filter(visibleOnTaskBoard);
}

// Unassigned board — tasks created without a client ("Outros" filter). client_id
// IS NULL never satisfies a client-role RLS policy's `client_id = current_client_id()`
// check, so these rows are naturally invisible to every client session already;
// only admins (the "tasks admin all" policy) can ever see them.
export async function listUnassignedTasks(): Promise<TaskRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS_WITH_ASSIGNEES)
    .is("client_id", null)
    .order("position")
    .order("created_at");
  if (error) fail(error);
  return ((data as unknown as (TaskRecord & TaskAssigneesJoin)[] | null) ?? []).map(mergeTaskAssigneeRow).filter(visibleOnTaskBoard);
}

export type BoardTask = TaskRecord & { clientName: string; clientSlug: string };

/** Cross-client Kanban feed — powers the "Todos" option in the client filter. */
export async function listAllTasks(): Promise<BoardTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(`${TASK_COLUMNS_WITH_ASSIGNEES},clients(name,slug,disabled)`)
    .order("position")
    .order("created_at");
  if (error) fail(error);
  type JoinedClient = { name: string; slug: string; disabled: boolean };
  type Row = TaskRecord & TaskAssigneesJoin & { clients: JoinedClient | JoinedClient[] | null };
  return ((data as unknown as Row[] | null) ?? [])
    // A disabled client's cards disappear from the shared board entirely —
    // unassigned tasks (clients null) are never affected by this.
    .filter(({ clients, ...task }) => visibleOnTaskBoard(task) && !(Array.isArray(clients) ? clients[0] : clients)?.disabled)
    .map(mergeTaskAssigneeRow)
    .map(({ clients, ...task }) => {
      const c = Array.isArray(clients) ? clients[0] : clients;
      return { ...task, clientName: c?.name ?? "Outros", clientSlug: c?.slug ?? "" };
    });
}

// ---- Planos de Ação (admin) --------------------------------------------------
// A `plano_acao` card with its member activities (plan_id) grouped under it, each
// with its own workflow progress, plus the plan's rolled-up progress. Powers the
// /admin/plano accordion.

export type PlanActivity = TaskRecord & { progress: number };
export type ActionPlan = TaskRecord & { clientName: string; clientSlug: string; progress: number; activities: PlanActivity[] };

export async function listActionPlans(): Promise<ActionPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(`${TASK_COLUMNS_WITH_ASSIGNEES},clients(name,slug)`)
    .eq("kind", "plano_acao")
    .order("updated_at", { ascending: false });
  if (error) fail(error);
  type JoinedClient = { name: string; slug: string };
  type Row = TaskRecord & TaskAssigneesJoin & { clients: JoinedClient | JoinedClient[] | null };
  const rows = ((data as unknown as Row[] | null) ?? []).filter((task) => task.payload?.[RECURRENCE_GROUP_KEY] !== true);
  if (!rows.length) return [];
  const planIds = rows.map((plan) => plan.id);
  const { data: memberData, error: memberError } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS_WITH_ASSIGNEES)
    .or(`plan_id.in.(${planIds.join(",")}),payload->>action_plan_id.in.(${planIds.join(",")})`)
    .order("position")
    .order("created_at");
  if (memberError) fail(memberError);
  const membersByPlan = new Map<string, TaskRecord[]>();
  for (const r of ((memberData as unknown as (TaskRecord & TaskAssigneesJoin)[] | null) ?? []).map(mergeTaskAssigneeRow)) {
    const planId = actionPlanIdOf(r);
    if (!planId) continue;
    const list = membersByPlan.get(planId);
    if (list) list.push(r); else membersByPlan.set(planId, [r]);
  }
  return rows
    .map(mergeTaskAssigneeRow)
    .map(({ clients, ...task }) => {
      const c = Array.isArray(clients) ? clients[0] : clients;
      const members = membersByPlan.get(task.id) ?? [];
      return {
        ...task,
        clientName: c?.name ?? "—",
        clientSlug: c?.slug ?? "",
        progress: taskProgress(task, members),
        activities: members.map((member) => ({ ...member, progress: taskProgress(member) })),
      };
    });
}

/** Direct children are intentionally queried separately from board feeds: this
 * makes future recurrence cards immediate in their parent without materializing
 * them on the Tasks screen. */
export async function listRelatedTasks(parentId: string): Promise<TaskRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS_WITH_ASSIGNEES)
    .or(`plan_id.eq.${parentId},payload->>action_plan_id.eq.${parentId}`)
    .order("position")
    .order("due_date", { nullsFirst: false });
  if (error) fail(error);
  return ((data as unknown as (TaskRecord & TaskAssigneesJoin)[] | null) ?? []).map(mergeTaskAssigneeRow);
}

// Single task read through the caller's own RLS-bound session — for an admin
// this sees any task, for a client session this only resolves rows their
// "tasks client read visible" policy allows (client_visible=true, own
// client), so a non-visible/foreign task simply comes back as null.
export async function getTaskById(id: string): Promise<TaskRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").select(TASK_COLUMNS_WITH_ASSIGNEES).eq("id", id).limit(1);
  if (error) fail(error);
  const row = data?.[0] as unknown as (TaskRecord & TaskAssigneesJoin) | undefined;
  return row ? mergeTaskAssigneeRow(row) : null;
}

/** Autor da ação corrente, ou null quando não há sessão (cron, automação). */
async function currentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function createTask(clientId: string | null, input: Record<string, unknown>): Promise<TaskRecord> {
  const supabase = await createClient();
  // Autoria carimbada aqui, no único funil de criação, e não em cada rota: os
  // cards nascidos de recorrência, checkpoint, kickoff e automação passam todos
  // por aqui. Sem sessão (cron/automação) fica null = criado pelo sistema.
  const author = await currentUserId();
  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...input, client_id: clientId, created_by: author })
    .select(TASK_COLUMNS)
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as TaskRecord | undefined;
  if (!row) throw new HttpError(503, "Nao foi possivel criar a tarefa.");
  return row;
}

function inputActionPlanId(input: Record<string, unknown>): string | null {
  const value = input.plan_id;
  return typeof value === "string" && value ? value : null;
}

export async function createExplicitDateTaskGroup(clientId: string | null, input: Record<string, unknown>, rawDates: unknown): Promise<TaskRecord> {
  const dates = normalizeOccurrenceDates(rawDates, typeof input.due_date === "string" ? input.due_date : null);
  if (dates.length < 2) return createTask(clientId, input);
  const rule = inferDateGroupRule(dates);
  const actionPlanId = inputActionPlanId(input);
  const parent = await createTask(clientId, {
    ...input,
    plan_id: null,
    due_date: dates[0],
    start_date: dates[0],
    recurrence_cadence: rule.cadence,
    recurrence_weekdays: rule.weekdays,
    recurrence_day_of_month: rule.dayOfMonth,
    payload: { ...withActionPlanId((input.payload ?? {}) as Record<string, unknown>, null), explicit_occurrence_dates: dates },
  });
  try {
    const first = explicitDateExecutionFields(parent, recurringExecutionId(parent.id, dates[0]), dates[0]);
    first.payload = withActionPlanId(first.payload as Record<string, unknown>, actionPlanId);
    return await createTask(clientId, first);
  } catch (error) {
    await deleteTask(parent.id).catch(() => undefined);
    throw error;
  }
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

function payloadRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function replicateExplicitChildPayload(parentId: string, currentId: string, payload: Record<string, unknown> | null): Promise<void> {
  if (!payload) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("propagate_explicit_group_payload", { p_parent_id: parentId, p_current_id: currentId, p_payload: payload });
  if (error) fail(error);
}

export async function updateTaskPayloadPatch(id: string, payloadPatch: Record<string, unknown>): Promise<TaskRecord> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_task_payload_patch", { p_task_id: id, p_patch: payloadPatch });
  if (error) fail(error);
  const task = await getTaskById(id);
  if (!task) throw new HttpError(404, "Tarefa nao encontrada.");
  return task;
}

async function updateExplicitChildGroup(id: string, parent: TaskRecord, patch: Record<string, unknown>): Promise<TaskRecord> {
  const shared = replicaPatch(patch);
  const sharedPayload = payloadRecord(shared.payload);
  delete shared.payload;
  const local = Object.fromEntries(Object.entries(patch).filter(([key]) => !(key in shared)));
  const supabase = await createClient();
  if (Object.keys(shared).length) {
    const { error } = await supabase.from("tasks").update({ ...shared, updated_at: new Date().toISOString() }).eq("plan_id", parent.id);
    if (error) fail(error);
    const template = parentTemplatePatch(shared);
    if (Object.keys(template).length) await updateTask(parent.id, template);
  }
  const currentPatch = sharedPayload ? { ...local, payload: sharedPayload } : local;
  const currentUpdate = Object.keys(currentPatch).length ? updateTask(id, currentPatch) : null;
  const [, updatedCurrent] = await Promise.all([
    replicateExplicitChildPayload(parent.id, id, sharedPayload),
    currentUpdate,
  ]);
  if (updatedCurrent) return updatedCurrent;
  const updated = await getTaskById(id);
  if (!updated) throw new HttpError(404, "Tarefa nao encontrada.");
  return updated;
}

async function updateExplicitParent(id: string, patch: Record<string, unknown>): Promise<TaskRecord> {
  const updated = await updateTask(id, patch);
  if (isExplicitDateParent(updated)) {
    const shared = parentTemplatePatch(patch);
    if (Object.keys(shared).length) {
      const supabase = await createClient();
      const { error } = await supabase.from("tasks").update({ ...shared, updated_at: new Date().toISOString() }).eq("plan_id", updated.id);
      if (error) fail(error);
    }
    const dates = explicitDatesOf(updated);
    const related = await listRelatedTasks(updated.id);
    const removedIds = related
      .filter((task) => task.payload?.[EXPLICIT_GROUP_KEY] === updated.id && (!task.due_date || !dates.includes(task.due_date)))
      .map((task) => task.id);
    if (removedIds.length) {
      const supabase = await createClient();
      const { error } = await supabase.from("tasks").delete().in("id", removedIds);
      if (error) fail(error);
    }
  }
  return updated;
}

function recurringParentInput(current: TaskRecord, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current, ...patch } as TaskRecord;
  const startDate = next.start_date ?? next.due_date;
  return {
    kind: next.kind,
    subtype: next.subtype,
    title: next.title,
    status: next.status,
    priority: next.priority,
    assignee: next.assignee,
    reviewer_id: next.reviewer_id,
    approver_id: next.approver_id,
    plan_id: null,
    requires_review: next.requires_review,
    requires_approval: next.requires_approval,
    due_date: startDate,
    start_date: startDate,
    end_date: next.end_date && startDate && next.end_date >= startDate ? next.end_date : startDate,
    scheduled_start_at: next.scheduled_start_at,
    scheduled_end_at: next.scheduled_end_at,
    progress_weight: next.progress_weight,
    description: next.description,
    client_visible: next.client_visible,
    payload: recurrenceParentPayload(withActionPlanId(next.payload, null)),
    position: next.position,
    recurrence_cadence: next.recurrence_cadence,
    recurrence_weekdays: next.recurrence_weekdays,
    recurrence_day_of_month: next.recurrence_day_of_month,
  };
}

/** New recurring cards created outside Rotinas need the same parent/template
 * split as an existing card being converted. The returned row is the first
 * real execution, so Plan cards continue to appear on the Plan surface. */
export async function createRecurringTaskGroup(clientId: string | null, input: Record<string, unknown>): Promise<TaskRecord> {
  const startDate = typeof input.start_date === "string" ? input.start_date : typeof input.due_date === "string" ? input.due_date : null;
  if (!startDate || !input.recurrence_cadence) return createTask(clientId, input);
  const actionPlanId = inputActionPlanId(input);
  const parent = await createTask(clientId, {
    ...input,
    plan_id: null,
    due_date: startDate,
    start_date: startDate,
    end_date: typeof input.end_date === "string" && input.end_date >= startDate ? input.end_date : startDate,
    payload: recurrenceParentPayload(withActionPlanId((input.payload ?? {}) as Record<string, unknown>, null)),
  });
  try {
    const firstId = recurringExecutionId(parent.id, 0);
    const fields = currentRecurringExecutionFields(parent, firstId, startDate);
    fields.payload = withActionPlanId(fields.payload as Record<string, unknown>, actionPlanId);
    return await createTask(clientId, fields);
  } catch (error) {
    await deleteTask(parent.id).catch(() => undefined);
    throw error;
  }
}

async function convertTaskToRecurringGroup(current: TaskRecord, patch: Record<string, unknown>): Promise<TaskRecord> {
  const next = { ...current, ...patch } as TaskRecord;
  if (!next.recurrence_cadence || !next.due_date) return updateTask(current.id, patch);
  const actionPlanId = actionPlanIdOf(next);
  const clientId = patch.client_id === null || typeof patch.client_id === "string" ? patch.client_id : current.client_id;
  const parent = await createTask(clientId, recurringParentInput(current, patch));
  const fields = isExplicitDateParent(parent)
    ? explicitDateExecutionFields(parent, current.id, next.due_date)
    : currentRecurringExecutionFields(parent, current.id, next.due_date);
  const { id: _id, ...executionFields } = fields;
  void _id;
  executionFields.payload = withActionPlanId(executionFields.payload as Record<string, unknown>, actionPlanId);
  try {
    return await updateTask(current.id, {
      ...executionFields,
      status: next.status,
      position: next.position,
      scheduled_start_at: next.scheduled_start_at,
      scheduled_end_at: next.scheduled_end_at,
    });
  } catch (error) {
    await deleteTask(parent.id).catch(() => undefined);
    throw error;
  }
}

// The lowest `position` in use among the OTHER cards sharing `status`, minus a
// step — so the just-touched card sorts above every existing card in its
// column. Manual drag always sends `position` explicitly (see dropInColumn in
// KanbanBoard.tsx) and is never routed through this, so a card dragged after
// bumping to the top stays wherever the user drops it until the next edit.
async function topPositionFor(status: TaskStatus, excludeId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("position")
    .eq("status", status)
    .neq("id", excludeId)
    .order("position", { ascending: true })
    .limit(1);
  if (error) fail(error);
  const min = (data?.[0] as { position: number } | undefined)?.position ?? 0;
  return min - 10;
}

async function patchWithTopPosition(id: string, current: TaskRecord, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (patch.position === undefined) {
    const nextStatus = (patch.status as TaskStatus | undefined) ?? current.status;
    return { ...patch, position: await topPositionFor(nextStatus, id) };
  }
  return patch;
}

async function updateRecurringExecution(id: string, parent: TaskRecord, patch: Record<string, unknown>): Promise<TaskRecord> {
  const updated = await updateTask(id, patch);
  if (updated.due_date) {
    const bounds: Record<string, unknown> = {};
    if (!parent.start_date || updated.due_date < parent.start_date) bounds.start_date = updated.due_date;
    if (!parent.end_date || updated.due_date > parent.end_date) bounds.end_date = updated.due_date;
    if (Object.keys(bounds).length) await updateTask(parent.id, bounds);
  }
  return updated;
}

async function updateRecurrenceTemplate(current: TaskRecord, patch: Record<string, unknown>, nextRecurrence: unknown, retried = false): Promise<TaskRecord> {
  const originalPatch = { ...patch, payload: payloadRecord(patch.payload) ? { ...payloadRecord(patch.payload)! } : patch.payload };
  const related = await listRelatedTasks(current.id);
  const executions = related.filter((task) => recurrenceParentIdOf(task) === current.id);
  const scheduleKeys = ["recurrence_cadence", "recurrence_weekdays", "recurrence_day_of_month", "start_date"];
  const changedSchedule = scheduleKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key)
    && JSON.stringify(patch[key]) !== JSON.stringify((current as unknown as Record<string, unknown>)[key]));
  const nextPayload = { ...(payloadRecord(patch.payload) ?? current.payload ?? {}) };
  const currentCycle = recurrenceCycleOf(current);
  const revision = recurrenceRevisionOf(current) + (changedSchedule ? 1 : 0);
  if (nextRecurrence) {
    Object.assign(nextPayload, recurrenceParentPayload(nextPayload, executions.length ? currentCycle : 0, revision));
    const start = typeof patch.start_date === "string" ? patch.start_date : current.start_date ?? current.due_date;
    if (!executions.length && start) {
      patch.due_date = start;
      patch.start_date = start;
      delete nextPayload.completed_cycles;
      delete nextPayload.last_completed_at;
    } else if (executions.length) {
      delete patch.due_date;
    }
    const due = typeof patch.due_date === "string" ? patch.due_date : current.due_date;
    const end = typeof patch.end_date === "string" ? patch.end_date : current.end_date;
    if (due && (!end || end < due)) patch.end_date = due;
  } else if (executions.length) {
    if (current.recurrence_cadence) nextPayload.recurrence_last_cadence = current.recurrence_cadence;
    Object.assign(nextPayload, recurrenceParentPayload(nextPayload, currentCycle, revision));
  } else {
    delete nextPayload[RECURRENCE_GROUP_KEY];
    delete nextPayload[RECURRENCE_CYCLE_KEY];
    delete nextPayload[RECURRENCE_REVISION_KEY];
  }
  patch.payload = nextPayload;
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", current.id)
    .contains("payload", {
      [RECURRENCE_CYCLE_KEY]: currentCycle,
      [RECURRENCE_REVISION_KEY]: recurrenceRevisionOf(current),
    })
    .select(TASK_COLUMNS).limit(1);
  if (error) fail(error);
  const updated = data?.[0] as TaskRecord | undefined;
  if (updated) return updated;
  const refreshed = await getTaskById(current.id);
  if (!refreshed) throw new HttpError(404, "Tarefa não encontrada.");
  if (retried) throw new HttpError(409, "A agenda da recorrência mudou.", { code: "recurrence_schedule_changed", parent: refreshed });
  return updateRecurrenceTemplate(refreshed, originalPatch, nextRecurrence, true);
}

function shouldConvertToRecurringGroup(current: TaskRecord, recurrenceParentId: string | null, historical: boolean, nextRecurrence: unknown): boolean {
  return !current.recurrence_cadence && !recurrenceParentId && !historical && Boolean(nextRecurrence);
}

async function routeTaskGroupUpdate(
  id: string,
  current: TaskRecord,
  patch: Record<string, unknown>,
  parent: TaskRecord | null,
  recurrenceParentId: string | null,
  historical: boolean,
  nextRecurrence: unknown,
): Promise<TaskRecord> {
  if (parent && isExplicitDateParent(parent)) return updateExplicitChildGroup(id, parent, patch);
  if (shouldConvertToRecurringGroup(current, recurrenceParentId, historical, nextRecurrence)) {
    return convertTaskToRecurringGroup(current, patch);
  }
  if (parent) return updateRecurringExecution(id, parent, patch);
  if (current.recurrence_cadence || historical) return updateRecurrenceTemplate(current, patch, nextRecurrence);
  return updateTask(id, patch);
}

export async function updateTaskGroup(id: string, current: TaskRecord, rawPatch: Record<string, unknown>): Promise<TaskRecord> {
  const patch = await patchWithTopPosition(id, current, rawPatch);
  const historical = current.payload?.[RECURRENCE_GROUP_KEY] === true;
  // A recurrence template always owns its executions. Ignore any stale
  // child-only payload reference so saving the parent cannot route it through
  // the execution update path.
  const recurrenceParentId = current.recurrence_cadence || historical ? null : recurrenceParentIdOf(current);
  const parent = recurrenceParentId ? await getTaskById(recurrenceParentId) : null;
  const nextRecurrence = patch.recurrence_cadence !== undefined ? patch.recurrence_cadence : current.recurrence_cadence;
  return routeTaskGroupUpdate(id, current, patch, parent, recurrenceParentId, historical, nextRecurrence);
}

async function completeTaskCycleForRequest(
  id: string,
  expectedCycle: number | undefined,
  expectedRevision: number | undefined,
  expectedDueDate: string | null,
): Promise<{ parent: TaskRecord; task: TaskRecord; created: boolean }> {
  const supabase = await createClient();
  const parent = await getTaskById(id);
  if (!parent) throw new HttpError(404, "Tarefa recorrente não encontrada.");
  if (!parent.recurrence_cadence || !parent.due_date) throw new HttpError(409, "Esta tarefa não está recorrente.");
  const currentCycle = recurrenceCycleOf(parent);
  const currentRevision = recurrenceRevisionOf(parent);
  const requestedCycle = expectedCycle ?? (expectedDueDate === parent.due_date ? currentCycle : undefined);
  const requestedRevision = expectedRevision ?? currentRevision;
  if (requestedCycle === undefined || requestedRevision !== currentRevision || requestedCycle > currentCycle) {
    throw new HttpError(409, "A agenda da recorrência mudou.", { code: "recurrence_schedule_changed", parent });
  }
  if (requestedCycle < currentCycle) {
    const repeatedId = recurringExecutionId(id, requestedCycle + 1);
    let repeated = await getTaskById(repeatedId);
    if (!repeated && requestedCycle + 1 === currentCycle) {
      const { data, error } = await supabase.from("tasks")
        .insert(recurringExecutionFields(parent, repeatedId, parent.due_date, currentCycle))
        .select(TASK_COLUMNS).limit(1);
      if (error && error.code !== "23505") fail(error);
      repeated = (data?.[0] as TaskRecord | undefined) ?? await getTaskById(repeatedId);
    }
    if (!repeated) throw new HttpError(503, "Não foi possível localizar a execução já criada.");
    return { parent, task: repeated, created: false };
  }

  const nextCycle = currentCycle + 1;
  const nextDue = nextRecurringDueDate(parent.due_date, {
    cadence: parent.recurrence_cadence,
    weekdays: parent.recurrence_weekdays,
    dayOfMonth: parent.recurrence_day_of_month,
    startDate: parent.start_date ?? parent.due_date,
  });
  const nextPayload = recurrenceParentPayload({
    ...(parent.payload ?? {}),
    completed_cycles: nextCycle,
    last_completed_at: new Date().toISOString(),
  }, nextCycle, currentRevision);
  const { data: advanced, error: updateError } = await supabase.from("tasks").update({
    due_date: nextDue,
    end_date: !parent.end_date || nextDue > parent.end_date ? nextDue : parent.end_date,
    payload: nextPayload,
  }).eq("id", id).contains("payload", {
    [RECURRENCE_CYCLE_KEY]: currentCycle,
    [RECURRENCE_REVISION_KEY]: currentRevision,
  }).select(TASK_COLUMNS).limit(1);
  if (updateError) fail(updateError);
  let updatedParent = advanced?.[0] as TaskRecord | undefined;
  if (!updatedParent) {
    const refreshed = await getTaskById(id);
    if (!refreshed) throw new HttpError(404, "Tarefa recorrente não encontrada.");
    if (recurrenceRevisionOf(refreshed) !== currentRevision) {
      throw new HttpError(409, "A agenda da recorrência mudou.", { code: "recurrence_schedule_changed", parent: refreshed });
    }
    if (recurrenceCycleOf(refreshed) !== nextCycle) {
      throw new HttpError(409, "A agenda da recorrência mudou.", { code: "recurrence_schedule_changed", parent: refreshed });
    }
    updatedParent = refreshed;
  }

  const executionId = recurringExecutionId(id, nextCycle);
  const { data: inserted, error: insertError } = await supabase.from("tasks")
    .insert(recurringExecutionFields(parent, executionId, nextDue, nextCycle))
    .select(TASK_COLUMNS).limit(1);
  if (insertError && insertError.code !== "23505") fail(insertError);
  let task = inserted?.[0] as TaskRecord | undefined;
  if (!task) {
    const { data: existing, error } = await supabase.from("tasks").select(TASK_COLUMNS).eq("id", executionId).limit(1);
    if (error) fail(error);
    task = existing?.[0] as TaskRecord | undefined;
  }
  if (!task) throw new HttpError(503, "Não foi possível materializar a execução.");
  return { parent: updatedParent, task, created: Boolean(inserted?.length) };
}

export async function completeTaskCycle(
  id: string,
  expectedCycle: number | undefined,
  expectedRevision: number | undefined,
  expectedDueDate: string | null,
): Promise<{ parent: TaskRecord; task: TaskRecord; created: boolean }> {
  return completeTaskCycleForRequest(id, expectedCycle, expectedRevision, expectedDueDate);
}

export async function detachTaskRelation(taskId: string, parentId: string): Promise<TaskRecord> {
  const task = await getTaskById(taskId);
  if (!task) throw new HttpError(404, "Tarefa nao encontrada.");
  const patch = detachedTaskRelationPatch(task, parentId);
  if (!patch) throw new HttpError(409, "Esta ligacao nao existe mais.");
  return updateTask(taskId, patch);
}

async function detachChildrenBeforeDelete(parentId: string): Promise<void> {
  const children = await listRelatedTasks(parentId);
  await Promise.all(children.map(async (child) => {
    const patch = detachedTaskRelationPatch(child, parentId);
    if (patch) await updateTask(child.id, patch);
  }));
}

export async function deleteTask(id: string): Promise<void> {
  // The FK uses ON DELETE SET NULL, but relations also have metadata in
  // payload. Clear both representations so former children are standalone.
  await detachChildrenBeforeDelete(id);
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) fail(error);
}

// Replaces the full set of linked Responsável accounts for a task —
// delete-then-insert, no diffing, no history table (same "mutable, no audit
// trail" product decision already applied to reviewer_id/approver_id).
export async function setTaskAssigneeProfiles(taskId: string, profileIds: string[]): Promise<void> {
  const supabase = await createClient();
  const unique = Array.from(new Set(profileIds));
  const { error } = await supabase.rpc("replace_task_assignees", { p_task_id: taskId, p_profile_ids: unique });
  if (error) fail(error);
}

export async function appendTaskComment(taskId: string, authorId: string, text: string): Promise<TaskRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("append_task_comment", { p_task_id: taskId, p_author_id: authorId, p_text: text });
  if (error) fail(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new HttpError(404, "Tarefa não encontrada.");
  return row as TaskRecord;
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
type ApprovalRow = TaskRecord & TaskAssigneesJoin & {
  updated_at: string | null;
  clients: JoinedClient | JoinedClient[] | null;
  reviewer: JoinedReviewer | JoinedReviewer[] | null;
  approver: JoinedReviewer | JoinedReviewer[] | null;
};

function toApprovalRecords(rows: ApprovalRow[] | null): ApprovalRecord[] {
  return (rows ?? []).map(mergeTaskAssigneeRow).map(({ clients, reviewer, approver, ...task }) => {
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
    .select(
      `${TASK_COLUMNS_WITH_ASSIGNEES},clients(name,slug),reviewer:profiles!tasks_reviewer_id_fkey(full_name),approver:profiles!tasks_approver_id_fkey(full_name)`,
    )
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
    .select(`${TASK_COLUMNS_WITH_ASSIGNEES},clients(name,slug),task_metrics(metrics,source,updated_at)`)
    .eq("status", "concluido")
    .order("updated_at", { ascending: false });
  if (error) fail(error);
  type JoinedClient = { name: string; slug: string };
  type JoinedMetrics = { metrics: Record<string, string> | null; source: string; updated_at: string | null };
  type Row = TaskRecord & TaskAssigneesJoin & {
    updated_at: string | null;
    clients: JoinedClient | JoinedClient[] | null;
    task_metrics: JoinedMetrics | JoinedMetrics[] | null;
  };
  return ((data as unknown as Row[] | null) ?? []).map(mergeTaskAssigneeRow).map(({ clients, task_metrics, ...task }) => {
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

export async function getTaskMetrics(taskId: string): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("task_metrics").select("metrics").eq("task_id", taskId).limit(1);
  if (error) fail(error);
  return ((data?.[0] as { metrics: Record<string, string> } | undefined)?.metrics) ?? {};
}

export async function upsertTaskMetrics(
  taskId: string,
  clientId: string,
  metrics: Record<string, unknown>,
  source: "manual" | "windsor" | "meta" = "manual",
): Promise<{ metrics: Record<string, string>; source: string; updated_at: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_metrics")
    .upsert({ task_id: taskId, client_id: clientId, metrics, source }, { onConflict: "task_id" })
    .select("metrics,source,updated_at")
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as { metrics: Record<string, string>; source: string; updated_at: string | null } | undefined;
  if (!row) throw new HttpError(503, "Nao foi possivel salvar as metricas.");
  return row;
}

// ---- Documents (admin) ------------------------------------------------------

const DOC_COLUMNS = "id,client_id,task_id,name,doc_type,status,file_url,storage_path,original_file_name,mime_type,size_bytes,doc_date,read_at";

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
  const { data, error: readError } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", id)
    .limit(1);
  if (readError) fail(readError);
  const row = data?.[0] as { storage_path: string | null } | undefined;
  if (!row) throw new HttpError(404, "Documento nao encontrado.");
  if (row.storage_path) {
    const { error: storageError } = await supabase.storage.from("documents").remove([row.storage_path]);
    if (storageError) fail(storageError);
  }
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) fail(error);
}

// ---- Acessos & Pastas (platform credentials) -----------------------------------

type CredentialRow = { platform: string; username: string; vault_secret_id: string | null; notes: string; updated_at: string };

export async function listClientCredentials(clientId: string): Promise<CredentialSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_platform_credentials")
    .select("platform,username,vault_secret_id,notes,updated_at")
    .eq("client_id", clientId);
  if (error) fail(error);
  const byPlatform = new Map((data as CredentialRow[] | null ?? []).map((r) => [r.platform, r]));
  return ACCESS_PLATFORMS.map((p): CredentialSummary => {
    const row = byPlatform.get(p.key);
    return {
      platform: p.key,
      username: row?.username ?? "",
      hasPassword: Boolean(row?.vault_secret_id),
      notes: row?.notes ?? "",
      updatedAt: row?.updated_at ?? "",
    };
  });
}

// Upsert-by-(client,platform). A blank password keeps whatever was already
// stored — password fields never round-trip plaintext to the client, so
// "leave blank to keep the current password" is the only way to edit
// everything else without forcing a re-entry of the secret. The password
// itself lives only in the vault (vault_secret_id points at it); this table
// never stores it directly.
export async function upsertClientCredential(
  clientId: string,
  input: { platform: AccessPlatformKey; username: string; password?: string; notes?: string },
): Promise<CredentialSummary> {
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("client_platform_credentials")
    .select("vault_secret_id")
    .eq("client_id", clientId)
    .eq("platform", input.platform)
    .limit(1);
  if (readError) fail(readError);
  let vaultSecretId = (existing?.[0] as { vault_secret_id: string | null } | undefined)?.vault_secret_id ?? null;

  const newPassword = input.password?.trim();
  if (newPassword) {
    if (vaultSecretId) await vaultUpdate(vaultSecretId, newPassword);
    else vaultSecretId = await vaultSet(newPassword, `platform_credential_${clientId}_${input.platform}`);
  }

  const { data, error } = await supabase
    .from("client_platform_credentials")
    .upsert(
      {
        client_id: clientId,
        platform: input.platform,
        username: input.username,
        vault_secret_id: vaultSecretId,
        notes: input.notes ?? "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,platform" },
    )
    .select("platform,username,vault_secret_id,notes,updated_at")
    .limit(1);
  if (error) fail(error);
  const row = data?.[0] as CredentialRow | undefined;
  if (!row) throw new HttpError(503, "Nao foi possivel salvar o acesso.");
  return { platform: row.platform as AccessPlatformKey, username: row.username, hasPassword: Boolean(row.vault_secret_id), notes: row.notes, updatedAt: row.updated_at };
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
  // Required templates are instantiated for every client and can't be unchecked
  // in the cadastro form; today only "Kickoff e onboarding" is optional.
  required: boolean;
};

const CHECKPOINT_TEMPLATE_COLUMNS = "id,title,description,order_index,active,required";

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
//
// `selectedIds` comes from the checkpoint chips in the cadastro form. Required
// templates are always included regardless of what the client sent: the chips
// for them render fixed, and the rule is enforced here rather than trusting the
// payload.
export async function provisionCheckpointsForClient(
  clientId: string,
  selectedIds?: string[],
): Promise<void> {
  const supabase = await createClient();
  const templates = await listCheckpointTemplates();
  let active = templates.filter((t) => t.active);
  if (selectedIds) {
    const picked = new Set(selectedIds);
    active = active.filter((t) => t.required || picked.has(t.id));
  }
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

// ---- Windsor.ai integration (Performance × Meta) --------------------------------
// One integration_credentials row (provider='windsor', scope='agency') holds
// the whole config. The raw apiKey lives ONLY in the vault, referenced by
// vault_secret_id — every GET response goes through maskWindsorSettings so
// the key never reaches the browser.

type WindsorMeta = { datasources?: Partial<WindsorSettings["datasources"]>; accountMap?: WindsorSettings["accountMap"] };
type IntegrationCredentialRow = { id: string; vault_secret_id: string; meta: WindsorMeta | null };

async function getWindsorRow(): Promise<IntegrationCredentialRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integration_credentials")
    .select("id,vault_secret_id,meta")
    .eq("provider", "windsor")
    .eq("scope", "agency")
    .limit(1);
  if (error) fail(error);
  return (data?.[0] as IntegrationCredentialRow | undefined) ?? null;
}

export async function getWindsorSettings(): Promise<WindsorSettings> {
  const row = await getWindsorRow();
  if (!row) return { ...WINDSOR_SETTINGS_DEFAULT };
  const apiKey = await vaultRead(row.vault_secret_id);
  const meta = row.meta ?? {};
  return {
    apiKey,
    datasources: { ...WINDSOR_SETTINGS_DEFAULT.datasources, ...(meta.datasources ?? {}) },
    accountMap: meta.accountMap ?? {},
  };
}

export async function saveWindsorSettings(patch: {
  apiKey?: string;
  clearApiKey?: boolean;
  datasources?: Partial<WindsorSettings["datasources"]>;
  accountMap?: WindsorSettings["accountMap"];
}): Promise<WindsorSettings> {
  const supabase = await createClient();
  const row = await getWindsorRow();
  const currentApiKey = row ? await vaultRead(row.vault_secret_id) : "";
  const currentMeta = row?.meta ?? {};
  const nextApiKey = patch.clearApiKey ? "" : patch.apiKey ?? currentApiKey;
  const nextDatasources = { ...WINDSOR_SETTINGS_DEFAULT.datasources, ...currentMeta.datasources, ...(patch.datasources ?? {}) };
  const nextAccountMap = patch.accountMap ?? currentMeta.accountMap ?? {};
  const nextMeta: WindsorMeta = { datasources: nextDatasources, accountMap: nextAccountMap };
  const nextStatus = nextApiKey ? "connected" : "disconnected";

  if (!row) {
    const vaultSecretId = await vaultSet(nextApiKey, "windsor_integration_api_key");
    const { error } = await supabase.from("integration_credentials").insert({
      provider: "windsor",
      scope: "agency",
      label: "Windsor.ai",
      vault_secret_id: vaultSecretId,
      meta: nextMeta,
      status: nextStatus,
    });
    if (error) fail(error);
  } else {
    if (patch.apiKey || patch.clearApiKey) await vaultUpdate(row.vault_secret_id, nextApiKey);
    const { error } = await supabase
      .from("integration_credentials")
      .update({ meta: nextMeta, status: nextStatus })
      .eq("id", row.id);
    if (error) fail(error);
  }

  return { apiKey: nextApiKey, datasources: nextDatasources, accountMap: nextAccountMap };
}

// ---- AI provider integration (Configurações → Integrações) ----------------------
// One integration_credentials row (provider='ai', scope='agency') holds the
// whole config, same shape as Windsor above. The raw apiKey lives ONLY in the
// vault; every GET response goes through maskAiProviderSettings so the key
// never reaches the browser. Only one AI vendor is ever active at a time —
// which one is stored in `meta.vendor`, not as a separate provider row.

type AiProviderMeta = { vendor?: AiVendor | null };
type AiProviderCredentialRow = { id: string; vault_secret_id: string; meta: AiProviderMeta | null };

async function getAiProviderRow(): Promise<AiProviderCredentialRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integration_credentials")
    .select("id,vault_secret_id,meta")
    .eq("provider", "ai")
    .eq("scope", "agency")
    .limit(1);
  if (error) fail(error);
  return (data?.[0] as AiProviderCredentialRow | undefined) ?? null;
}

export async function getAiProviderSettings(): Promise<AiProviderSettings> {
  const row = await getAiProviderRow();
  if (!row) return { ...AI_PROVIDER_SETTINGS_DEFAULT };
  const apiKey = await vaultRead(row.vault_secret_id);
  return { apiKey, vendor: row.meta?.vendor ?? null };
}

export async function saveAiProviderSettings(patch: {
  apiKey?: string;
  clearApiKey?: boolean;
  vendor?: AiVendor | null;
}): Promise<AiProviderSettings> {
  const supabase = await createClient();
  const row = await getAiProviderRow();
  const currentApiKey = row ? await vaultRead(row.vault_secret_id) : "";
  const nextApiKey = patch.clearApiKey ? "" : patch.apiKey ?? currentApiKey;
  const nextVendor = patch.vendor !== undefined ? patch.vendor : row?.meta?.vendor ?? null;
  const nextMeta: AiProviderMeta = { vendor: nextVendor };
  const nextStatus = nextApiKey ? "connected" : "disconnected";

  if (!row) {
    const vaultSecretId = await vaultSet(nextApiKey, "ai_provider_api_key");
    const { error } = await supabase.from("integration_credentials").insert({
      provider: "ai",
      scope: "agency",
      label: "Provedor de IA",
      vault_secret_id: vaultSecretId,
      meta: nextMeta,
      status: nextStatus,
    });
    if (error) fail(error);
  } else {
    if (patch.apiKey || patch.clearApiKey) await vaultUpdate(row.vault_secret_id, nextApiKey);
    const { error } = await supabase
      .from("integration_credentials")
      .update({ meta: nextMeta, status: nextStatus })
      .eq("id", row.id);
    if (error) fail(error);
  }

  return { apiKey: nextApiKey, vendor: nextVendor };
}

export type MaskedAiProviderSettings = {
  configured: boolean;
  apiKeyLast4: string;
  vendor: AiVendor | null;
};

export function maskAiProviderSettings(s: AiProviderSettings): MaskedAiProviderSettings {
  return {
    configured: s.apiKey.length > 0,
    apiKeyLast4: s.apiKey.slice(-4),
    vendor: s.vendor,
  };
}

// ---- Meta (Facebook) OAuth integration -----------------------------------------
// One integration_credentials row (provider='meta', scope='agency') holds the
// connection. The long-lived access token lives ONLY in the vault; GET
// responses (getMetaSettings) never include it. Written only by the OAuth
// callback route (saveMetaConnection) — never by a browser-supplied PATCH.

type MetaMeta = {
  businessName?: string;
  adAccounts?: MetaAdAccount[];
  accountMap?: Record<string, MetaAdAccount | null>;
  expiresAt?: string | null;
};
type MetaCredentialRow = { id: string; vault_secret_id: string; meta: MetaMeta | null; status: string };

export type MaskedMetaSettings = {
  configured: boolean;
  status: string;
  businessName: string;
  adAccounts: MetaAdAccount[];
  accountMap: Record<string, MetaAdAccount | null>;
  expiresAt: string | null;
};

async function getMetaRow(): Promise<MetaCredentialRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integration_credentials")
    .select("id,vault_secret_id,meta,status")
    .eq("provider", "meta")
    .eq("scope", "agency")
    .limit(1);
  if (error) fail(error);
  return (data?.[0] as MetaCredentialRow | undefined) ?? null;
}

// Server-only: the token itself, for routes that call the Graph API directly
// (app/api/admin/performance/insights). Never exposed via getMetaSettings().
export async function getMetaAccessToken(): Promise<string | null> {
  const row = await getMetaRow();
  if (!row || row.status !== "connected") return null;
  return (await vaultRead(row.vault_secret_id)) || null;
}

export async function getMetaSettings(): Promise<MaskedMetaSettings> {
  const row = await getMetaRow();
  if (!row) return { configured: false, status: "disconnected", businessName: "", adAccounts: [], accountMap: {}, expiresAt: null };
  const meta = row.meta ?? {};
  return {
    configured: row.status === "connected",
    status: row.status,
    businessName: meta.businessName ?? "",
    adAccounts: meta.adAccounts ?? [],
    accountMap: meta.accountMap ?? {},
    expiresAt: meta.expiresAt ?? null,
  };
}

// Called only by the OAuth callback route (app/api/admin/integrations/meta/callback) —
// this is the sole writer of the token itself.
export async function saveMetaConnection(input: {
  token: string;
  businessName: string;
  adAccounts: MetaAdAccount[];
  expiresAt: string | null;
  connectedBy: string;
}): Promise<void> {
  const supabase = await createClient();
  const row = await getMetaRow();
  const meta: MetaMeta = {
    businessName: input.businessName,
    adAccounts: input.adAccounts,
    accountMap: row?.meta?.accountMap ?? {},
    expiresAt: input.expiresAt,
  };
  const now = new Date().toISOString();
  if (!row) {
    const vaultSecretId = await vaultSet(input.token, "meta_oauth_token");
    const { error } = await supabase.from("integration_credentials").insert({
      provider: "meta",
      scope: "agency",
      label: "Meta Ads",
      vault_secret_id: vaultSecretId,
      meta,
      status: "connected",
      connected_by: input.connectedBy,
      connected_at: now,
      last_verified_at: now,
    });
    if (error) fail(error);
  } else {
    await vaultUpdate(row.vault_secret_id, input.token);
    const { error } = await supabase
      .from("integration_credentials")
      .update({ meta, status: "connected", connected_by: input.connectedBy, connected_at: now, last_verified_at: now })
      .eq("id", row.id);
    if (error) fail(error);
  }
}

export async function updateMetaAccountMap(accountMap: Record<string, MetaAdAccount | null>): Promise<MaskedMetaSettings> {
  const row = await getMetaRow();
  if (!row) throw new HttpError(400, "Conecte a Meta antes de mapear contas.");
  const supabase = await createClient();
  const meta: MetaMeta = { ...(row.meta ?? {}), accountMap };
  const { error } = await supabase.from("integration_credentials").update({ meta }).eq("id", row.id);
  if (error) fail(error);
  return getMetaSettings();
}

// ---- Vínculo de conta de anúncios (usado no cadastro/edição de cliente) -----
// The full Windsor account discovery lives in Configurações › Integrações,
// behind a live "testar conexão" call. Here we only offer what is already
// persisted: every Meta ad account the OAuth grant returned, plus any Windsor
// account already mapped to some client. Empty list = the form shows the
// "nenhuma conta conectada" state instead of a picker.
export type AdAccountOption = {
  provider: "meta" | "windsor";
  accountId: string;
  accountName: string;
};

export async function listAdAccountOptions(): Promise<AdAccountOption[]> {
  const [meta, windsor] = await Promise.all([getMetaSettings(), getWindsorSettings()]);
  const out: AdAccountOption[] = meta.adAccounts.map((a) => ({
    provider: "meta" as const,
    accountId: a.accountId,
    accountName: a.accountName,
  }));
  const seen = new Set(out.map((a) => a.accountId));
  for (const ref of Object.values(windsor.accountMap)) {
    if (ref && !seen.has(ref.accountId)) {
      seen.add(ref.accountId);
      out.push({ provider: "windsor", accountId: ref.accountId, accountName: ref.accountName });
    }
  }
  return out;
}

/** Points a client's slug at an ad account (or clears it with null). */
export async function linkClientAdAccount(slug: string, accountId: string | null): Promise<void> {
  if (!accountId) {
    const meta = await getMetaSettings();
    if (meta.accountMap[slug]) await updateMetaAccountMap({ ...meta.accountMap, [slug]: null });
    const windsor = await getWindsorSettings();
    if (windsor.accountMap[slug]) await saveWindsorSettings({ accountMap: { ...windsor.accountMap, [slug]: null } });
    return;
  }
  const options = await listAdAccountOptions();
  const picked = options.find((a) => a.accountId === accountId);
  if (!picked) throw new HttpError(400, "Conta de anuncios nao encontrada.");
  const ref = { accountId: picked.accountId, accountName: picked.accountName };
  if (picked.provider === "meta") {
    const meta = await getMetaSettings();
    await updateMetaAccountMap({ ...meta.accountMap, [slug]: ref });
  } else {
    const windsor = await getWindsorSettings();
    await saveWindsorSettings({ accountMap: { ...windsor.accountMap, [slug]: ref } });
  }
}

export async function disconnectMeta(): Promise<void> {
  const row = await getMetaRow();
  if (!row) return;
  await vaultDelete(row.vault_secret_id);
  const supabase = await createClient();
  const { error } = await supabase.from("integration_credentials").delete().eq("id", row.id);
  if (error) fail(error);
}

export type MaskedWindsorSettings = {
  configured: boolean;
  apiKeyLast4: string;
  datasources: WindsorSettings["datasources"];
  accountMap: WindsorSettings["accountMap"];
};

export function maskWindsorSettings(s: WindsorSettings): MaskedWindsorSettings {
  return {
    configured: Boolean(s.apiKey),
    apiKeyLast4: s.apiKey.slice(-4),
    datasources: s.datasources,
    accountMap: s.accountMap,
  };
}

// Cached Windsor payloads — one row per (account, datasource), always covering
// a ~90-day window so the dashboard slices periods in memory.
export type InsightsCacheRow = {
  client_id: string | null;
  account_id: string;
  datasource: WindsorDatasource | typeof META_ADS_DATASOURCE | typeof META_ADS_CREATIVE_DATASOURCE | typeof META_ADS_ADSET_DATASOURCE;
  date_from: string;
  date_to: string;
  payload: MetaPost[];
  fetched_at: string;
};

export async function getCachedInsights(): Promise<InsightsCacheRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meta_insights_cache")
    .select("client_id,account_id,datasource,date_from,date_to,payload,fetched_at")
    // Ad-level drill-down rows are fetched/cached on demand per campaign
    // (see getCachedAdCreativeInsights) — excluded here so every full
    // dashboard load doesn't also pull every expanded campaign's payload.
    .not("datasource", "in", `(${META_ADS_CREATIVE_DATASOURCE},${META_ADS_ADSET_DATASOURCE})`);
  // An un-migrated cache table should degrade to "no cache yet", not take the
  // whole performance dashboard down with a 503.
  if (isMissingOptionalTable(error, "meta_insights_cache")) return [];
  if (error) fail(error);
  return (data as InsightsCacheRow[] | null) ?? [];
}

export async function upsertInsightsCache(row: Omit<InsightsCacheRow, "fetched_at">): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("meta_insights_cache")
    .upsert({ ...row, fetched_at: new Date().toISOString() }, { onConflict: "account_id,datasource" });
  if (isMissingOptionalTable(error, "meta_insights_cache")) return;
  if (error) fail(error);
}

// One (account, campaign) pair's ad-level cache row — looked up directly by
// key instead of via getCachedInsights() (which excludes this datasource) so
// expanding a campaign row costs one indexed lookup, not a full-table scan.
export async function getCachedAdCreativeInsights(accountId: string, campaignId: string): Promise<InsightsCacheRow | null> {
  return getCachedMetaEntityInsights(accountId, campaignId, META_ADS_CREATIVE_DATASOURCE);
}

export async function getCachedMetaEntityInsights(
  accountId: string,
  campaignId: string,
  datasource: typeof META_ADS_CREATIVE_DATASOURCE | typeof META_ADS_ADSET_DATASOURCE,
): Promise<InsightsCacheRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meta_insights_cache")
    .select("client_id,account_id,datasource,date_from,date_to,payload,fetched_at")
    .eq("account_id", `${accountId}:${campaignId}`)
    .eq("datasource", datasource)
    .limit(1);
  if (isMissingOptionalTable(error, "meta_insights_cache")) return null;
  if (error) fail(error);
  return (data?.[0] as InsightsCacheRow | undefined) ?? null;
}

// ---- Performance dashboard view prefs (shared, site_settings-backed) ----------
// Which "Campanhas" table columns show, sort order and default period —
// agency-wide (any gerente can change it, everyone viewing Performance sees
// the same config), so it lives in site_settings like admin_tabs_visibility.
export async function getPerformanceViewPrefs(): Promise<PerformanceViewPrefs> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("site_settings").select("value").eq("key", "performance_view_prefs").limit(1);
  if (error) fail(error);
  return sanitizePerformanceViewPrefs((data?.[0] as { value: unknown } | undefined)?.value);
}

export async function savePerformanceViewPrefs(patch: Partial<PerformanceViewPrefs>): Promise<PerformanceViewPrefs> {
  const current = await getPerformanceViewPrefs();
  const next = sanitizePerformanceViewPrefs({ ...current, ...patch });
  const supabase = await createClient();
  const { error } = await supabase
    .from("site_settings")
    .upsert({ key: "performance_view_prefs", value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) fail(error);
  return next;
}

type PerformanceTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  owner_profile_id: string | null;
  scope: "personal" | "agency";
  config: unknown;
  updated_at: string | null;
};

function mapPerformanceTemplate(row: PerformanceTemplateRow): PerformanceTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    scope: row.scope,
    ownerProfileId: row.owner_profile_id,
    config: sanitizePerformanceTemplateConfig(row.config),
    updatedAt: row.updated_at,
  };
}

export async function listPerformanceTemplates(): Promise<PerformanceTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("performance_templates")
    .select("id,name,description,owner_profile_id,scope,config,updated_at")
    .order("updated_at", { ascending: false });
  if (error) fail(error);
  return ((data as PerformanceTemplateRow[] | null) ?? []).map(mapPerformanceTemplate);
}

export async function createPerformanceTemplate(input: {
  name: string;
  description: string;
  scope: "personal" | "agency";
  ownerProfileId: string;
  config: unknown;
}): Promise<PerformanceTemplate> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("performance_templates")
    .insert({
      name: input.name.trim(),
      description: input.description.trim(),
      scope: input.scope,
      owner_profile_id: input.scope === "personal" ? input.ownerProfileId : null,
      config: sanitizePerformanceTemplateConfig(input.config),
      schema_version: 1,
    })
    .select("id,name,description,owner_profile_id,scope,config,updated_at")
    .single();
  if (error) fail(error);
  return mapPerformanceTemplate(data as PerformanceTemplateRow);
}

export async function updatePerformanceTemplate(id: string, patch: {
  name?: string;
  description?: string;
  scope?: "personal" | "agency";
  ownerProfileId: string;
  config?: unknown;
}): Promise<PerformanceTemplate> {
  const supabase = await createClient();
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.description !== undefined) values.description = patch.description.trim();
  if (patch.scope !== undefined) {
    values.scope = patch.scope;
    values.owner_profile_id = patch.scope === "personal" ? patch.ownerProfileId : null;
  }
  if (patch.config !== undefined) values.config = sanitizePerformanceTemplateConfig(patch.config);
  const { data, error } = await supabase
    .from("performance_templates")
    .update(values)
    .eq("id", id)
    .select("id,name,description,owner_profile_id,scope,config,updated_at")
    .single();
  if (error) fail(error);
  return mapPerformanceTemplate(data as PerformanceTemplateRow);
}

export async function deletePerformanceTemplate(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("performance_templates").delete().eq("id", id);
  if (error) fail(error);
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

export async function updateProfileName(userId: string, fullName: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", userId);
  if (error) fail(error);
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
  return p.full_name?.trim() || (p.role === "admin" ? "Administrador" : "Cliente");
}

// Responsável options are the registered admin accounts only. Historical
// free-text assignee names remain readable on old cards, but are no longer
// offered as loose options now that the whole team has accounts.
export async function listAssigneeOptions(): Promise<string[]> {
  const supabase = await createClient();
  const { data: profileRows, error: profileErr } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("role", "admin")
    .order("full_name");
  if (profileErr) fail(profileErr);
  return (profileRows ?? [])
    .map((row) => (row as { full_name: string | null }).full_name?.trim() ?? "")
    .filter(Boolean);
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

/** Candidates for the Aprovação stage — the client's own accounts, union the
 * whole North team (admin). Aprovação is now decidable either by the client
 * OR by a North teammate designated as approver (product decision: North
 * team members can also be approvers, not just the client). */
export async function listApproverCandidates(clientId: string): Promise<ReviewerCandidate[]> {
  if (!uuidPattern.test(clientId)) throw new HttpError(400, "Cliente invalido.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,role,client_id,level")
    .or(`client_id.eq.${clientId},role.eq.admin`)
    .order("role", { ascending: false })
    .order("full_name");
  if (error) fail(error);
  return ((data as TeamMember[] | null) ?? []).map((p) => ({ id: p.id, role: p.role, label: reviewerLabel(p) }));
}

// ---- Automations (Configurações → Automações) ------------------------------------
// v2: one row per registered automation instance, always bound to a target
// card — cadence/execution date come from that card, not from this table.
// See plan/AUTOMACOES-RELATORIO-TRAFEGO.md. Vocabulary lives in
// lib/automationCatalog.ts; this is only the instance CRUD.
export type AutomationTargetTaskSummary = {
  id: string;
  title: string;
  kind: string;
  clientName: string | null;
  dueDate: string | null;
  recurrenceCadence: RecurringCadence | null;
};

export type AutomationConfig = {
  id: string;
  automationKey: string;
  targetTaskId: string;
  performanceTemplateId: string | null;
  active: boolean;
  lastRunDate: string | null;
  // Resolved directly here (not left to the frontend to cross-reference
  // against GET /api/admin/tasks) because a recurring target card that has
  // already advanced past its first cycle gets payload.recurrence_group=true
  // and disappears from that list (visibleOnTaskBoard, lib/taskRelations.ts)
  // — exactly the common case for an automation that has already fired once.
  targetTask: AutomationTargetTaskSummary | null;
};

type AutomationConfigJoinRow = Record<string, unknown> & {
  tasks?: { title: string; kind: string; due_date: string | null; recurrence_cadence: string | null; clients: { name: string } | { name: string }[] | null } | null;
};

function mapAutomationConfigRow(row: AutomationConfigJoinRow): AutomationConfig {
  const task = row.tasks ?? null;
  const client = task ? (Array.isArray(task.clients) ? task.clients[0] : task.clients) : null;
  return {
    id: row.id as string,
    automationKey: row.automation_key as string,
    targetTaskId: row.target_task_id as string,
    performanceTemplateId: (row.performance_template_id as string | null) ?? null,
    active: Boolean(row.active),
    lastRunDate: (row.last_run_date as string | null) ?? null,
    targetTask: task ? {
      id: row.target_task_id as string,
      title: task.title,
      kind: task.kind,
      clientName: client?.name ?? null,
      dueDate: task.due_date,
      recurrenceCadence: (task.recurrence_cadence as RecurringCadence | null) ?? null,
    } : null,
  };
}

export async function listAutomationConfigs(): Promise<AutomationConfig[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_configs")
    .select("*,tasks!automation_configs_target_task_id_fkey(title,kind,due_date,recurrence_cadence,clients(name))")
    .order("created_at");
  if (error) fail(error);
  return ((data ?? []) as AutomationConfigJoinRow[]).map(mapAutomationConfigRow);
}

export async function createAutomationConfig(
  input: { automationKey: string; targetTaskId: string; performanceTemplateId?: string | null; active?: boolean },
  createdBy: string,
): Promise<AutomationConfig> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_configs")
    .insert({
      automation_key: input.automationKey,
      target_task_id: input.targetTaskId,
      performance_template_id: input.performanceTemplateId ?? null,
      active: input.active ?? true,
      created_by: createdBy,
    })
    .select("*")
    .limit(1);
  if (error) fail(error);
  return mapAutomationConfigRow(data![0]);
}

export async function updateAutomationConfig(
  id: string,
  patch: { targetTaskId?: string; performanceTemplateId?: string | null; active?: boolean },
): Promise<AutomationConfig> {
  const supabase = await createClient();
  const fields: Record<string, unknown> = {};
  if (patch.targetTaskId !== undefined) fields.target_task_id = patch.targetTaskId;
  if (patch.performanceTemplateId !== undefined) fields.performance_template_id = patch.performanceTemplateId;
  if (patch.active !== undefined) fields.active = patch.active;
  const { data, error } = await supabase.from("automation_configs").update(fields).eq("id", id).select("*").limit(1);
  if (error) fail(error);
  const row = data?.[0] as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, "Automação não encontrada.");
  return mapAutomationConfigRow(row);
}

export async function deleteAutomationConfig(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("automation_configs").delete().eq("id", id);
  if (error) fail(error);
}
