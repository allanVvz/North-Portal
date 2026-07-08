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
export const TASK_STATUSES = ["backlog", "em_producao", "revisao", "aprovacao", "aprovado", "concluido"] as const;
export const TASK_PRIORITIES = ["baixa", "media", "alta"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

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
    legenda: z.string().max(400).optional(),
    // Atividade (comentários do card, mais recente por último)
    comments: z.array(taskCommentSchema).max(200).optional(),
  })
  .passthrough();
export type TaskComment = z.infer<typeof taskCommentSchema>;

export const taskCreateSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1).max(MAX_TEXT_BYTES),
  kind: kindSchema.optional(),
  subtype: subtypeSchema.nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignee: z.string().max(120).nullable().optional(),
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
});
export const taskPatchSchema = taskCreateSchema.partial().omit({ slug: true });

// Performance metrics attached to a published card — flexible map so the
// catalog (app/admin/metricDefs.ts) can grow without a schema change.
export const taskMetricsPatchSchema = z.object({
  metrics: z.record(z.string().max(200)),
});

export type TaskRecord = {
  id: string;
  client_id: string;
  kind: string;
  subtype: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
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
};

export type ReviewerCandidate = { id: string; label: string; role: "admin" | "client" };

// ---- Documents ----------------------------------------------------------------
export const DOCUMENT_TYPES = ["contrato", "proposta", "relatorio", "material"] as const;
export const DOCUMENT_STATUSES = ["enviada", "assinado", "aguardando_assinatura", "publicado", "compartilhado"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const documentCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(MAX_TEXT_BYTES),
  doc_type: z.enum(DOCUMENT_TYPES).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  file_url: z.string().max(MAX_TEXT_BYTES).nullable().optional(),
  doc_date: z.string().max(40).nullable().optional(),
});
export const documentPatchSchema = documentCreateSchema.partial().omit({ slug: true });

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
  name: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  file_url: string | null;
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
  constructor(public status: number, message: string) {
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
