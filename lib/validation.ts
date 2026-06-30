import { z } from "zod";

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
};

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
