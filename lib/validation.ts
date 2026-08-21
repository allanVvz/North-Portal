import { z } from "zod";
import type { PortalContent } from "@/app/[slug]/portalData";

const MAX_ANSWERS_BYTES = 50000;
const MAX_TEXT_BYTES = 5000;

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugSchema = z.string().regex(slugPattern);
export const answersSchema = z.record(z.unknown()).refine((value) => jsonSize(value) <= MAX_ANSWERS_BYTES, {
  message: "Respostas excedem o limite permitido.",
});
export const briefingPatchSchema = z.object({
  answers: answersSchema,
  submitted: z.boolean().optional(),
});
export const metricSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  variation: z.string().optional(),
  description: z.string().optional(),
});
export const insightSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().optional(),
  date: z.string().optional(),
});
export const adminCreateClientSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(MAX_TEXT_BYTES),
  email: z.string().email().max(200),
  is_active: z.boolean().optional(),
});
const MAX_CONTENT_BYTES = 200000;
export const contentSchema = z
  .record(z.unknown())
  .refine((value) => jsonSize(value) <= MAX_CONTENT_BYTES, { message: "Conteúdo excede o limite permitido." });

export const adminPatchSchema = z.object({
  name: z.string().min(1).max(MAX_TEXT_BYTES).optional(),
  is_active: z.boolean().optional(),
  disabled: z.boolean().optional(),
  brandUrl: z.string().max(MAX_TEXT_BYTES).nullable().optional(),
  productsUrl: z.string().max(MAX_TEXT_BYTES).nullable().optional(),
  uploadsUrl: z.string().max(MAX_TEXT_BYTES).nullable().optional(),
  insights: z.array(insightSchema).optional(),
  topMetrics: z.array(metricSchema).max(4).optional(),
  reportUrl: z.string().max(MAX_TEXT_BYTES).nullable().optional(),
  feedbackUrl: z.string().max(MAX_TEXT_BYTES).nullable().optional(),
  content: contentSchema.optional(),
});

// ---- Tasks / Kanban -----------------------------------------------------------
// "parada" is a lateral halt state (automation error needing human
// attention), reachable from any status — not a funnel step. Kept last so it
// never gets mistaken for "further along" by ordinal comparisons elsewhere.
export const TASK_STATUSES = ["backlog", "em_producao", "revisao", "aprovacao", "aprovado", "concluido", "parada"] as const;
export const TASK_PRIORITIES = ["baixa", "media", "alta"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

// A status transition into "aprovado" (approving) or back out of it to
// "aprovacao" (reopening) is a manager-only decision, enforced in
// PATCH /api/admin/tasks/[id] regardless of surface (Kanban drag, TaskModal,
// Aprovações). Extracted as a pure function so the gate itself — and, just as
// important, that it does NOT fire for ordinary moves between any other two
// columns — can be unit-tested without a live session/DB.
export function requiresManagerApproval(currentStatus: TaskStatus | undefined, nextStatus: TaskStatus | undefined): boolean {
  return nextStatus === "aprovado" || (currentStatus === "aprovado" && nextStatus === "aprovacao");
}

// The gate for approving (→ aprovado) or reopening (aprovado → aprovacao) a
// card: a gerente always decides, and now that the North team can also be an
// approver (not just gerentes/clients), the specific approver_id assigned to
// the card decides too, so an editor-level approver isn't locked out of their
// own assigned cards.
export function canDecideApproval(
  currentStatus: TaskStatus | undefined,
  nextStatus: TaskStatus | undefined,
  approverId: string | null | undefined,
  actingUserId: string,
  actingLevel: string | null | undefined,
): boolean {
  if (!requiresManagerApproval(currentStatus, nextStatus)) return true;
  if (actingLevel === "gerente") return true;
  return Boolean(approverId) && approverId === actingUserId;
}

// `kind`/`subtype` are free TEXT validated only for length here — the real
// vocabulary lives in the in-code catalog (lib/taskCatalog.ts), which is a
// one-way consumer of this file. Adding a kind is a code change there, not a
// schema or validation change, so a stray kind string is harmless.
const kindSchema = z.string().min(1).max(40);
const subtypeSchema = z.string().max(40);
const isoDate = z.string().max(40); // 'YYYY-MM-DD' or ISO timestamp
const taskTone = z.enum(["green", "gold", "blue", "purple", "neutral"]);
const taskCommentSchema = z.object({
  author: z.string().max(80),
  text: z.string().max(2000),
  at: z.string(),
});
export const taskPayloadSchema = z
  .object({
    barTone: taskTone.optional(),
    statusLabel: z.string().max(80).optional(),
    statusTone: taskTone.optional(),
    // Criativo
    formato: z.string().max(80).optional(),
    plataforma: z.string().max(80).optional(),
    // Agendamento (plataforma is shared with Criativo)
    hora: z.string().max(20).optional(),
    // Atividade (comentários do card, mais recente por último)
    comments: z.array(taskCommentSchema).max(200).optional(),
  })
  .passthrough();
export type TaskComment = z.infer<typeof taskCommentSchema>;

export const taskCreateSchema = z.object({
  // Omitted/empty = "sem cliente" (unassigned) — the "Outros" filter.
  slug: slugSchema.optional(),
  title: z.string().min(1).max(MAX_TEXT_BYTES),
  kind: kindSchema.optional(),
  subtype: subtypeSchema.nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignee: z.string().max(120).nullable().optional(),
  // Not a tasks column — resolved into task_assignees rows by the route
  // handler (setTaskAssigneeProfiles), same treatment as `slug`/`client_id`.
  assignee_profile_ids: z.array(z.string().uuid()).max(20).optional(),
  reviewer_id: z.string().uuid().nullable().optional(),
  approver_id: z.string().uuid().nullable().optional(),
  plan_id: z.string().uuid().nullable().optional(),
  requires_review: z.boolean().optional(),
  requires_approval: z.boolean().optional(),
  due_date: isoDate.nullable().optional(),
  start_date: isoDate.nullable().optional(),
  end_date: isoDate.nullable().optional(),
  scheduled_start_at: isoDate.nullable().optional(),
  scheduled_end_at: isoDate.nullable().optional(),
  progress_weight: z.number().min(0).max(100).optional(),
  description: z.string().max(MAX_TEXT_BYTES).nullable().optional(),
  client_visible: z.boolean().optional(),
  position: z.number().int().optional(),
  payload: taskPayloadSchema.optional(),
  recurrence_cadence: z.enum(["semanal", "quinzenal", "mensal"]).nullable().optional(),
  recurrence_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  recurrence_day_of_month: z.number().int().min(1).max(31).nullable().optional(),
});
// slug is nullable here (unlike taskCreateSchema): null explicitly means
// "unassign the client", undefined means "leave the client unchanged" — the
// route resolves it to client_id since tasks has no slug column of its own.
export const taskPatchSchema = taskCreateSchema.partial().omit({ slug: true }).extend({
  slug: slugSchema.nullable().optional(),
  payload_patch: z.object({
    barTone: taskTone.nullable().optional(),
    statusLabel: z.string().max(80).nullable().optional(),
    statusTone: taskTone.nullable().optional(),
    formato: z.string().max(80).nullable().optional(),
    plataforma: z.string().max(80).nullable().optional(),
    hora: z.string().max(20).nullable().optional(),
  }).strict().optional(),
});

export const taskCommentCreateSchema = z.object({ text: z.string().trim().min(1).max(2000) });

/** Blocks only a *new* invalid Publicado combination. Historical rows that
 * already are non-Criativo + Publicado remain editable, so an unrelated save
 * does not brick the card. Moving another card into that combination (or
 * changing a published Criativo into another type) is still rejected. */
export function introducesInvalidPublishedState(
  current: Pick<TaskRecord, "status" | "kind">,
  patch: { status?: TaskStatus; kind?: string },
): boolean {
  const currentIsInvalid = current.status === "concluido" && current.kind !== "criativo";
  const nextStatus = patch.status ?? current.status;
  const nextKind = patch.kind ?? current.kind;
  return nextStatus === "concluido" && nextKind !== "criativo" && !currentIsInvalid;
}

// Performance metrics attached to a published card — flexible map so the
// catalog (app/admin/metricDefs.ts) can grow without a schema change.
export const taskMetricsPatchSchema = z.object({
  metrics: z.record(z.string().max(200)),
});

// ---- Windsor.ai integration (Performance × Meta) --------------------------------
export const windsorDatasourceSchema = z.enum(["instagram_organic", "facebook_organic", "facebook"]);
const windsorAccountRefSchema = z.object({
  accountId: z.string().min(1).max(120),
  accountName: z.string().max(200),
});
// PATCH semantics: apiKey omitted = keep the stored key; clearApiKey wipes it.
export const windsorSettingsPatchSchema = z.object({
  apiKey: z.string().trim().min(8).max(200).optional(),
  clearApiKey: z.boolean().optional(),
  datasources: z.record(windsorDatasourceSchema, z.boolean()).optional(),
  accountMap: z.record(slugSchema, windsorAccountRefSchema.nullable()).optional(),
});
// Test route: explicit key tests a pre-save value; omitted tests the stored one.
export const windsorTestSchema = z.object({
  apiKey: z.string().trim().min(8).max(200).optional(),
});
// PATCH semantics: apiKey omitted = keep the stored key; clearApiKey wipes it
// (mirrors windsorSettingsPatchSchema above). vendor null clears the choice.
export const aiProviderSettingsPatchSchema = z.object({
  apiKey: z.string().trim().min(8).max(200).optional(),
  clearApiKey: z.boolean().optional(),
  vendor: z.enum(["anthropic", "chatgpt", "deepseek"]).nullable().optional(),
});
// PATCH semantics for the Meta integration: only the ad-account-per-client
// mapping is ever written from the browser — the OAuth token itself is only
// ever set by the server-side callback route, never via this schema.
const metaAccountRefSchema = z.object({
  accountId: z.string().min(1).max(120),
  accountName: z.string().max(200),
});
export const metaAccountMapSchema = z.object({
  accountMap: z.record(slugSchema, metaAccountRefSchema.nullable()),
});
export const performanceInsightsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  client: slugSchema.optional(),
  refresh: z.coerce.boolean().optional(),
});
// Ad-level drill-down (one campaign at a time, fetched on demand).
export const performanceAdInsightsQuerySchema = z.object({
  account: z.string().min(1).max(120),
  campaign: z.string().min(1).max(200),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  refresh: z.coerce.boolean().optional(),
  level: z.enum(["adset", "ad"]).default("ad"),
});
// Shape-only validation — sanitizePerformanceViewPrefs (lib/performancePrefs)
// does the actual whitelisting against known metric keys/periods.
const metricRefSchema = z.string().max(80);
const customMetricSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(60),
  a: z.string().max(40),
  b: z.string().max(40),
  op: z.enum(["+", "-", "×", "÷"]),
});
export const performanceViewPrefsSchema = z.object({
  visibleColumns: z.array(z.string().max(40)).max(30).optional(),
  sortKey: z.string().max(40).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  defaultPeriod: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  kpiSlots: z.array(z.object({ visible: z.boolean(), metric: metricRefSchema })).max(20).optional(),
  trendMetric: metricRefSchema.optional(),
  topCampaignsMetric: metricRefSchema.optional(),
  mixMetric: z.array(metricRefSchema).max(4).optional(),
  customMetrics: z.array(customMetricSchema).max(30).optional(),
});
export const performanceTemplateCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(240).default(""),
  config: z.record(z.string(), z.unknown()),
});
export const performanceTemplatePatchSchema = performanceTemplateCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos uma alteração." });
export const performanceSyncSchema = z.object({
  links: z.array(z.object({ taskId: z.string().uuid(), postId: z.string().min(1).max(200) })).min(1).max(100),
});

export type TaskRecord = {
  id: string;
  // null = unassigned ("Outros") — a task with no client.
  client_id: string | null;
  kind: string;
  subtype: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  // Legacy free text, merged at read time with linked accounts (see
  // mergeAssigneeDisplay) — always the combined display string.
  assignee: string | null;
  // Linked task_assignees accounts (uuids), for pre-selecting real-account
  // chips in the picker. Always present on read; never written directly —
  // writes go through assignee_profile_ids on the patch schema instead.
  assignee_profile_ids: string[];
  reviewer_id: string | null;
  approver_id: string | null;
  plan_id: string | null;
  requires_review: boolean;
  requires_approval: boolean;
  due_date: string | null;
  start_date: string | null;
  end_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  progress_weight: number;
  description: string | null;
  client_visible: boolean;
  payload: Record<string, unknown>;
  position: number;
  recurrence_cadence: RecurringCadence | null;
  recurrence_weekdays: number[];
  recurrence_day_of_month: number | null;
  updated_at: string;
};

// ---- Tarefas recorrentes dos clientes ----------------------------------------
// Recorrência é um atributo de qualquer tarefa que não seja `plano_acao`.
// Cada execução é outra task e usa `plan_id` para apontar para o pai recorrente.
// Se a execução também pertencer a um Plano de Ação, essa relação secundária
// fica em `payload.action_plan_id` para não sobrescrever o pai da recorrência.
export const RECURRING_CADENCES = ["semanal", "quinzenal", "mensal"] as const;
export type RecurringCadence = (typeof RECURRING_CADENCES)[number];

const recurringBaseSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().max(MAX_TEXT_BYTES).nullable().optional(),
  kind: kindSchema.default("operacional"),
  cadence: z.enum(RECURRING_CADENCES).default("semanal"),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  next_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, "Data de execução inválida.").nullable().optional(),
  time_of_day: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, "Horário inválido.").nullable().optional(),
  timezone: z.string().min(1).max(80).refine((value) => {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Fuso horário inválido.").default("America/Sao_Paulo"),
  priority: z.enum(TASK_PRIORITIES).default("media"),
  assignee: z.string().max(120).nullable().optional(),
  active: z.boolean().default(true),
  client_visible: z.boolean().default(false),
  position: z.number().int().min(0).optional(),
  template_payload: z.record(z.unknown()).optional(),
});

export const recurringTaskCreateSchema = recurringBaseSchema.extend({ slug: slugSchema });
export const recurringTaskPatchSchema = recurringBaseSchema.partial().extend({ slug: slugSchema.optional() });

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

// Cycle + revision are the canonical concurrency identity. expectedDueDate is
// accepted temporarily for clients deployed before this contract.
export const recurringCompleteSchema = z.object({
  expectedCycle: z.number().int().min(0).optional(),
  expectedRevision: z.number().int().min(1).optional(),
  expectedDueDate: isoDateSchema.nullable().optional(),
});
export const recurringGenerateSchema = z.object({
  occurrenceDate: isoDateSchema.optional(),
});

// ---- Automations (Configurações → Automações) ----------------------------------
// v2: one row per registered automation instance, always bound to a target
// card (cadence/execution date come from that card — see
// plan/AUTOMACOES-RELATORIO-TRAFEGO.md). No more agency/client scope.
const automationKeySchema = z.enum(["relatorio_trafego_semanal", "provisionar_card_metricas"]);
export const automationConfigCreateSchema = z.object({
  automationKey: automationKeySchema,
  targetTaskId: z.string().uuid(),
  // Only meaningful for relatorio_trafego_semanal — either a real template
  // uuid or a builtin's string id (e.g. "builtin-full-funnel"), see
  // supabase/migrations/20260821030010_automations_v2.sql.
  performanceTemplateId: z.string().min(1).max(80).nullable().optional(),
  active: z.boolean().optional(),
});
export const automationConfigPatchSchema = z.object({
  targetTaskId: z.string().uuid().optional(),
  performanceTemplateId: z.string().min(1).max(80).nullable().optional(),
  active: z.boolean().optional(),
});
export const automationProvisionSchema = z.object({
  templateTaskId: z.string().uuid(),
});

export type RecurringTaskRecord = {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  kind: string;
  cadence: RecurringCadence;
  weekdays: number[];
  day_of_month: number | null;
  next_due_date: string | null;
  time_of_day: string | null;
  timezone: string;
  priority: TaskPriority;
  assignee: string | null;
  active: boolean;
  client_visible: boolean;
  completed_cycles: number;
  last_completed_at: string | null;
  position: number;
  template_payload: Record<string, unknown>;
  source?: string | null;
  external_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewerCandidate = { id: string; label: string; role: "admin" | "client" };

// ---- Documents ----------------------------------------------------------------
export const DOCUMENT_TYPES = ["contrato", "proposta", "relatorio", "material"] as const;
export const DOCUMENT_STATUSES = ["enviada", "assinado", "aguardando_assinatura", "publicado", "compartilhado"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024;
const storagePathSchema = z.string().min(1).max(MAX_TEXT_BYTES).refine(
  (value) => !value.startsWith("/") && !value.split("/").includes("..") && value.split("/").length >= 3,
  "Caminho de armazenamento inválido.",
);
const documentFieldsSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(MAX_TEXT_BYTES),
  doc_type: z.enum(DOCUMENT_TYPES).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  file_url: z.string().url().max(MAX_TEXT_BYTES).nullable().optional(),
  storage_path: storagePathSchema.nullable().optional(),
  original_file_name: z.string().min(1).max(MAX_TEXT_BYTES).nullable().optional(),
  mime_type: z.string().min(1).max(255).nullable().optional(),
  size_bytes: z.number().int().min(0).max(MAX_DOCUMENT_SIZE_BYTES).nullable().optional(),
  doc_date: z.string().max(40).nullable().optional(),
});
export const documentCreateSchema = documentFieldsSchema;
export const documentPatchSchema = documentFieldsSchema.partial().omit({ slug: true });

// ---- Commercial checkpoint templates -------------------------------------------
export const checkpointTemplateCreateSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(MAX_TEXT_BYTES).nullable().optional(),
  order_index: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
});
export const checkpointTemplatePatchSchema = checkpointTemplateCreateSchema.partial();

export type DocumentRecord = {
  id: string;
  client_id: string;
  // The Kanban card that produced this document (e.g. an automation's PDF
  // report), if any — null for documents uploaded independently of a card.
  task_id: string | null;
  name: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  file_url: string | null;
  storage_path: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  doc_date: string | null;
  read_at: string | null;
};

// ---- Acessos & Pastas (platform credentials) -----------------------------------
// In-code catalog (same pattern as lib/taskCatalog.ts) — the 4 platforms the
// agency needs a login for. Not a DB enum so a new one can ship without a migration.
export const ACCESS_PLATFORMS = [
  { key: "meta_business", label: "Meta Business", desc: "Gerenciador de anúncios — incluir e-mail da North" },
  { key: "instagram", label: "Instagram", desc: "Login para publicação" },
  { key: "google_drive", label: "Google Drive", desc: "Pasta compartilhada de materiais" },
  { key: "google_ads", label: "Google Ads", desc: "Conta para campanhas de busca" },
] as const;
export type AccessPlatformKey = (typeof ACCESS_PLATFORMS)[number]["key"];
const ACCESS_PLATFORM_KEYS = ACCESS_PLATFORMS.map((p) => p.key) as [AccessPlatformKey, ...AccessPlatformKey[]];

// Basic, offline validation only (per explicit product decision) — no live
// check against the platform itself, just non-empty credentials.
export const credentialPatchSchema = z.object({
  platform: z.enum(ACCESS_PLATFORM_KEYS),
  username: z.string().min(1).max(200),
  // Blank password on an update means "keep the current one" — enforced by
  // the API layer, not here (this schema only validates shape).
  password: z.string().max(200).optional(),
  notes: z.string().max(MAX_TEXT_BYTES).optional(),
});

// Never carries the plaintext password back to the client — only whether one
// is set, so the UI can show "Concedido" without round-tripping the secret.
export type CredentialSummary = {
  platform: AccessPlatformKey;
  username: string;
  hasPassword: boolean;
  notes: string;
  updatedAt: string;
};

// ---- Configurações -------------------------------------------------------------
export const legalDocPatchSchema = z.object({
  title: z.string().min(1).max(MAX_TEXT_BYTES).optional(),
  body: z.string().max(MAX_CONTENT_BYTES).optional(),
  status: z.enum(["rascunho", "publicada"]).optional(),
});
export const agencyProfileSchema = z.object({
  name: z.string().max(MAX_TEXT_BYTES),
  email: z.string().max(MAX_TEXT_BYTES),
  site: z.string().max(MAX_TEXT_BYTES),
  note: z.string().max(MAX_TEXT_BYTES),
});
export const meProfileSchema = z.object({
  full_name: z.string().trim().min(1).max(MAX_TEXT_BYTES),
});

// PATCH /api/admin/notifications — mark either an explicit id list, or the
// whole unread inbox ("all"), read.
export const notificationsMarkReadSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(200).optional(),
    all: z.literal(true).optional(),
  })
  .refine((v) => v.all === true || (v.ids !== undefined && v.ids.length > 0), {
    message: "Informe ids ou all.",
  });

// ---- Client flow flags (Revisão/Aprovação safe-hide) ---------------------------
// admin/cliente gate the reviewer/approver assignment + client-facing
// visibility. The Kanban column itself is driven by "Ativo para Admin" too
// (see visibleColumnsFor in app/admin/kanbanShared.ts) — ON shows the column
// for every client sharing the board even with zero cards in it, OFF hides it
// once the cascade below has moved any of that client's cards out.
export type ClientFlowFlags = {
  revisaoAdmin: boolean;
  revisaoCliente: boolean;
  aprovacaoAdmin: boolean;
  aprovacaoCliente: boolean;
};
export const clientFlowFlagsPatchSchema = z.object({
  revisaoAdmin: z.boolean().optional(),
  revisaoCliente: z.boolean().optional(),
  aprovacaoAdmin: z.boolean().optional(),
  aprovacaoCliente: z.boolean().optional(),
});

// Cross-client summary of whether ANY client currently has each stage
// admin-enabled — drives the Kanban column visibility described above.
export function anyClientHasFlowEnabled(flags: Iterable<ClientFlowFlags>): {
  anyRevisaoAdmin: boolean;
  anyAprovacaoAdmin: boolean;
} {
  let anyRevisaoAdmin = false;
  let anyAprovacaoAdmin = false;
  for (const f of flags) {
    if (f.revisaoAdmin) anyRevisaoAdmin = true;
    if (f.aprovacaoAdmin) anyAprovacaoAdmin = true;
  }
  return { anyRevisaoAdmin, anyAprovacaoAdmin };
}

// Pure decision for what saveClientFlowFlags must do when a client's flags
// change — separated from the actual Supabase calls so this critical
// cascade (turning a stage off must ALWAYS flush its cards back to
// "em_producao" and strip the reviewer/approver) can be unit-tested without
// a database. Turning a stage ON never produces an effect — there's no
// history of which cards used to live there, so existing cards stay wherever
// they already are.
export type FlowFlagsCascadeEffect =
  | "clear_reviewer_and_move_revisao_to_em_producao"
  | "clear_approver_and_move_aprovacao_to_em_producao";

export function flowFlagsCascadeEffects(current: ClientFlowFlags, next: ClientFlowFlags): FlowFlagsCascadeEffect[] {
  const effects: FlowFlagsCascadeEffect[] = [];
  if (current.revisaoAdmin && !next.revisaoAdmin) effects.push("clear_reviewer_and_move_revisao_to_em_producao");
  if (current.aprovacaoAdmin && !next.aprovacaoAdmin) effects.push("clear_approver_and_move_aprovacao_to_em_producao");
  return effects;
}

// ---- Plano de Ação visibility master switch -------------------------------------
export const planoVisibilitySchema = z.object({ enabled: z.boolean() });

// ---- Admin nav tabs visibility (Revisões / Aprovações, global) -----------------
// publicadoColumnVisible lives in this same site_settings row — it's a
// bespoke global toggle (not a Revisão/Aprovação-style flow pair), gating
// the Kanban "Publicado" column while that feature (mock metrics, manual
// post-linking) is still in development.
export type AdminTabsVisibility = {
  revisoesTabVisible: boolean;
  aprovacoesTabVisible: boolean;
  publicadoColumnVisible: boolean;
};
export const adminTabsVisibilitySchema = z.object({
  revisoesTabVisible: z.boolean().optional(),
  aprovacoesTabVisible: z.boolean().optional(),
  publicadoColumnVisible: z.boolean().optional(),
});

export type Metric = {
  label: string;
  value: string;
  variation?: string;
  description?: string;
};

export type Insight = {
  title: string;
  description: string;
  category?: string;
  date?: string;
};

export type PortalPrefs = {
  theme: "light" | "dark";
  avatarStyle: number;
  displayName: string | null;
  username: string | null;
  // Real, server-tracked completion of the Manual do Cliente deck — replaces
  // the old localStorage-only flag so Jornada/Home/Onboarding all agree.
  manualSeen: boolean;
};

export const prefsPatchSchema = z.object({
  theme: z.enum(["light", "dark"]).optional(),
  avatarStyle: z.number().int().min(0).max(4).optional(),
  displayName: z.string().max(200).nullable().optional(),
  username: z.string().max(80).nullable().optional(),
  manualSeen: z.boolean().optional(),
});

// A task row as seen by the client portal — same TaskRecord plus updated_at,
// used to sort/label the Feedbacks queue and history.
export type ClientTask = TaskRecord & { updated_at: string | null };

export type PortalPayload = {
  client: { slug: string; name: string };
  briefing: { answers: Record<string, unknown>; submitted: boolean; updatedAt: string | null };
  driveLinks: { brandUrl: string | null; productsUrl: string | null; uploadsUrl: string | null };
  results: {
    insights: Insight[];
    topMetrics: Metric[];
    reportUrl: string | null;
    feedbackUrl: string | null;
  };
  content: PortalContent;
  prefs: PortalPrefs;
  documents: DocumentRecord[];
  credentials: CredentialSummary[];
  // Kanban status "aprovacao": the client's pending approval queue (Feedbacks page).
  pendingApprovals: ClientTask[];
  // Kanban status "aprovado" (Concluído) or "concluido" (Publicado): resolved
  // history shown at the bottom of the Feedbacks page.
  resolvedApprovals: ClientTask[];
  // kind='checkpoint_comercial' cards, ordered by position — powers the real
  // "Checkpoints comerciais" list on Central Comercial and the onboarding %.
  checkpoints: ClientTask[];
  // Only set by /api/client/[slug] (not by other getPortalPayload callers) —
  // the viewer's own auth id + access level, so the UI can tell whether
  // they're the specific reviewer for a card (or a 'gerente' who can act on
  // any card of this client, not just their own).
  sessionUserId?: string | null;
  sessionLevel?: "editor" | "gerente" | "usuario" | null;
  // Client-facing half of client_flow_flags — gates the "Feedbacks" nav page.
  // revisaoCliente is currently unused by the UI (no client-facing Revisão
  // page exists), kept for schema symmetry / future-proofing.
  flowFlags: { revisaoCliente: boolean; aprovacaoCliente: boolean };
};

export const clientApprovalActionSchema = z
  .object({
    action: z.enum(["aprovar", "ajustes"]),
    comment: z.string().max(2000).optional(),
  })
  .refine((v) => v.action !== "ajustes" || Boolean(v.comment?.trim()), {
    message: "Descreva o ajuste necessário antes de enviar.",
    path: ["comment"],
  });

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

export function validateSlug(slug: string): string {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) throw new HttpError(400, "Slug invalido.");
  return parsed.data;
}

export function jsonSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function validateAnswers(value: unknown): Record<string, unknown> {
  const parsed = answersSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, "Respostas invalidas.");
  }
  return parsed.data;
}

export function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "Campo de texto invalido.");
  if (jsonSize(value) > MAX_TEXT_BYTES) throw new HttpError(413, "Campo de texto muito longo.");
  return value;
}

export function asOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return asStringOrNull(value) ?? undefined;
}

export function normalizeMetrics(value: unknown): Metric[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.label !== "string" || typeof record.value !== "string") return [];
    return [{
      label: record.label,
      value: record.value,
      variation: typeof record.variation === "string" ? record.variation : undefined,
      description: typeof record.description === "string" ? record.description : undefined,
    }];
  });
}

export function normalizeInsights(value: unknown): Insight[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.title !== "string" || typeof record.description !== "string") return [];
    return [{
      title: record.title,
      description: record.description,
      category: typeof record.category === "string" ? record.category : undefined,
      date: typeof record.date === "string" ? record.date : undefined,
    }];
  });
}

export function mergeAnswers(current: Record<string, unknown>, next: Record<string, unknown>) {
  return { ...current, ...next };
}
