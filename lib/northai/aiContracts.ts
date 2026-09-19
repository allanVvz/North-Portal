import { z } from "zod";

export const visualRequestSchema = z.object({
  target: z.enum(["funnel", "narrative", "table", "first_page", "ads", "unknown"]),
  problem: z.enum(["overlap", "too_wide", "too_narrow", "too_much_padding", "wrong_order", "repetition", "other"]),
  instruction: z.string().trim().max(2000),
  sourceCommentAt: z.string().nullable().default(null),
  needsClarification: z.boolean().default(false),
  clarification: z.enum(["where_overlap", "what_to_improve", "more_changes"]).nullable().default(null),
});

export type VisualRequest = z.infer<typeof visualRequestSchema>;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

/** Contexto factual entregue ao NorthAI. Valores desconhecidos são null, nunca
 * zero: isso impede o modelo de transformar ausência de dado em resultado. */
export const northAIContextSchema = z.object({
  client: z.object({ id: z.string().min(1), slug: z.string().min(1), name: z.string().min(1) }),
  period: z.object({ from: isoDay, to: isoDay }),
  objective: z.string().trim().max(2000).nullable().default(null),
  metrics: z.array(z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    value: z.number().finite().nullable(),
    previous: z.number().finite().nullable().default(null),
    difference: z.number().finite().nullable().default(null),
    percent: z.number().finite().nullable().default(null),
    source: z.string().min(1).max(200),
  })).max(100).default([]),
  funnel: z.array(z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    value: z.number().finite().nullable(),
    source: z.string().min(1).max(200),
  })).max(30).default([]),
  media: z.object({
    reach: z.number().finite().nonnegative().nullable().default(null),
    profileVisits: z.number().finite().nonnegative().nullable().default(null),
    ads: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      campaign: z.string().nullable().default(null),
      objective: z.string().nullable().default(null),
      spend: z.number().finite().nonnegative().nullable().default(null),
      result: z.number().finite().nullable().default(null),
      cost: z.number().finite().nonnegative().nullable().default(null),
      variation: z.number().finite().nullable().default(null),
      contribution: z.string().max(500).nullable().default(null),
    })).max(500).default([]),
  }).default({}),
  comments: z.array(z.object({
    at: z.string().min(1),
    author: z.string().max(160).nullable().default(null),
    text: z.string().max(10000),
  })).max(500).default([]),
  visualRequest: visualRequestSchema.nullable().default(null),
  reports: z.object({
    adsFinal: z.boolean().default(false),
    adsRevision: z.number().int().nonnegative().nullable().default(null),
    hiddenFields: z.array(z.string().max(100)).max(100).default([]),
    editorialInstruction: z.string().max(2000).nullable().default(null),
  }).default({}),
});

export type NorthAIContext = z.infer<typeof northAIContextSchema>;

export const layoutSectionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{1,60}$/),
  title: z.string().trim().min(1).max(160),
  kind: z.enum(["kpi", "narrative", "funnel", "table", "chart", "footer"]),
  order: z.number().int().nonnegative(),
  visible: z.boolean().default(true),
  dataKeys: z.array(z.string().max(100)).max(50).default([]),
});

export const layoutNarrativeSchema = z.object({
  kind: z.enum(["fact", "comparison", "context", "limitation"]),
  text: z.string().trim().min(1).max(3000),
});

/** Plano declarativo. O renderer decide tipografia e paginação; o modelo só
 * decide hierarquia, conteúdo autorizado e ordem. */
export const layoutPlanSchema = z.object({
  document: z.enum(["ads", "conversion"]),
  title: z.string().trim().min(1).max(180),
  period: z.object({ from: isoDay, to: isoDay }),
  sections: z.array(layoutSectionSchema).min(1).max(30),
  narrative: z.array(layoutNarrativeSchema).max(30).default([]),
  hiddenFields: z.array(z.string().max(100)).max(100).default([]),
  creativeCards: z.object({
    columns: z.union([z.literal(1), z.literal(2)]).default(1),
    maxLines: z.number().int().min(1).max(4).default(3),
    minWidth: z.number().finite().min(0).max(531).default(0),
  }).default({}),
  funnel: z.object({
    width: z.number().int().min(240).max(420).default(360),
    maxWidth: z.number().int().min(280).max(480).default(420),
    nodeWidth: z.number().int().min(160).max(280).default(220),
    labelMode: z.enum(["inside", "below", "outside"]).default("below"),
    lastLevelWidth: z.number().int().min(160).max(280).default(220),
    gap: z.number().int().min(8).max(32).default(12),
    maxLabelLines: z.number().int().min(1).max(3).default(2),
  }).default({}),
  narrativeLayout: z.object({
    placement: z.enum(["first_page", "next_page"]).default("first_page"),
    maxParagraphs: z.number().int().min(1).max(3).default(1),
    maxChars: z.number().int().min(240).max(1200).default(560),
  }).default({}),
}).superRefine((plan, ctx) => {
  const keys = new Set<string>();
  for (const section of plan.sections) {
    if (keys.has(section.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sections"], message: `Seção duplicada: ${section.key}` });
    keys.add(section.key);
  }
});

export type LayoutPlan = z.infer<typeof layoutPlanSchema>;
