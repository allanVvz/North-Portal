import { createHash } from "node:crypto";
import type { Period } from "@/app/admin/performance/insights";
import type { AdaptiveInterpretation } from "@/lib/ai/adaptiveFeedback";
import type { ConversionRow } from "@/lib/ai/extractMetrics";
import type { MetaPost } from "@/lib/windsor";
import { generateLayoutPlan, generateNarrative } from "@/lib/northai/aiPrompts";
import { northAIContextSchema, type NorthAIContext } from "@/lib/northai/aiContracts";

export type ReportContext = {
  period: Period;
  metrics: { vendas: number | null; agendamentos: number | null; receita: number | null; seguidores: number | null; seguidoresNovos: number | null };
  conversions: ConversionRow[];
  media: { campaigns: MetaPost[]; ads: MetaPost[] };
  interpretation: AdaptiveInterpretation;
  parser: "llm" | "parser" | "fallback";
  sourceFingerprint: string;
  narrative?: Array<{ kind: string; text: string }>;
};

export type ConversionLayoutPlan = {
  sections: { result: true; indicators: true; funnel: true; technicalReading: true; adContribution: true; conversionHistory: boolean; commercial: boolean };
  hideTrendCharts: true;
  creativeCards: { columns: 1 | 2; maxLines: number; minWidth: number };
  narrative: { placement: "first_page" | "next_page"; maxParagraphs: number; maxChars: number };
  fingerprint: string;
};

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildReportContext(input: {
  period: Period; metrics: ReportContext["metrics"]; conversions: ConversionRow[];
  campaigns: MetaPost[]; ads: MetaPost[]; interpretation: AdaptiveInterpretation;
  parser: string; sourceFingerprint: string;
}): ReportContext {
  const parser: ReportContext["parser"] = input.parser === "llm" ? "llm" : input.parser === "parser" ? "parser" : "fallback";
  return { period: input.period, metrics: input.metrics, conversions: input.conversions, media: { campaigns: input.campaigns, ads: input.ads }, interpretation: input.interpretation, parser, sourceFingerprint: input.sourceFingerprint };
}

function metricSum(posts: MetaPost[], key: "alcance" | "profileVisits") {
  const values = posts.map((post) => post.metrics[key]).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

/** Converts the internal report context into the bounded input of the two AI roles. */
export function buildNorthAIContext(input: {
  client: { id: string; slug: string; name: string };
  context: ReportContext;
  adsFinal: boolean;
  adsRevision?: number | null;
  editorialInstruction?: string | null;
}): NorthAIContext {
  const { context } = input;
  const metricValues = context.metrics;
  const metrics = Object.entries(metricValues).map(([key, value]) => ({
    key,
    label: key === "seguidoresNovos" ? "Seguidores adquiridos" : key,
    value,
    previous: null,
    difference: null,
    percent: null,
    source: key === "seguidoresNovos" ? "Feedback" : "Feedback",
  }));
  const ads = context.media.ads.map((post) => ({
    id: post.adId ?? post.id,
    name: (post.adName ?? post.caption) || "Anúncio",
    campaign: post.campaignName ?? null,
    objective: post.objective ?? null,
    spend: post.metrics.custo ?? null,
    result: post.metrics.resultado ?? post.metrics.conversoes ?? null,
    cost: post.metrics.cpc ?? post.metrics.cpm ?? null,
    variation: null,
    contribution: null,
  }));
  return northAIContextSchema.parse({
    client: input.client,
    period: context.period,
    objective: null,
    metrics,
    funnel: [
      { key: "reach", label: "Alcance", value: metricSum(context.media.campaigns, "alcance"), source: "Meta" },
      { key: "profile_visits", label: "Visitas ao perfil", value: metricSum(context.media.campaigns, "profileVisits"), source: "Meta" },
      { key: "followers_gained", label: "Seguidores adquiridos", value: metricValues.seguidoresNovos, source: "Feedback" },
      { key: "followers_total", label: "Base total de seguidores", value: metricValues.seguidores, source: "Feedback" },
    ],
    media: { reach: metricSum(context.media.campaigns, "alcance"), profileVisits: metricSum(context.media.campaigns, "profileVisits"), ads },
    comments: context.interpretation.context.map((comment) => ({ at: comment.sourceCommentAt, author: comment.author, text: comment.text })),
    reports: { adsFinal: input.adsFinal, adsRevision: input.adsRevision ?? null, hiddenFields: [], editorialInstruction: input.editorialInstruction ?? null },
  });
}

export function buildLayoutPlan(context: ReportContext): ConversionLayoutPlan {
  const commercial = context.metrics.vendas !== null || context.metrics.receita !== null || context.metrics.agendamentos !== null || context.conversions.length > 0;
  const shape = { sections: { result: true, indicators: true, funnel: true, technicalReading: true, adContribution: true, conversionHistory: context.metrics.seguidoresNovos !== null || commercial, commercial }, hideTrendCharts: true, creativeCards: { columns: 1 as const, maxLines: 3, minWidth: 0 }, narrative: { placement: "next_page" as const, maxParagraphs: 1, maxChars: 720 }, sourceFingerprint: context.sourceFingerprint } as const;
  return { ...shape, fingerprint: fingerprint(shape) };
}

/** Optional NorthAI/Dashboard Architect pass. It is opt-in for jobs so a
 * missing provider never blocks a deterministic report regeneration. */
export async function planWithNorthAI(input: {
  context: ReportContext;
  northAIContext: NorthAIContext;
}): Promise<{ layout: ConversionLayoutPlan; narrative: Array<{ kind: string; text: string }>; aiUsed: boolean; aiError: string | null }> {
  const fallback = buildLayoutPlan(input.context);
  if (process.env.NORTHAI_REPORT_PLANNER === "0" || process.env.NODE_ENV === "test") return { layout: fallback, narrative: [], aiUsed: false, aiError: null };
  try {
    const [remoteLayout, narrative] = await Promise.all([
      generateLayoutPlan(input.northAIContext, "conversion"),
      generateNarrative(input.northAIContext, "conversion"),
    ]);
    return {
      layout: {
        ...fallback,
        creativeCards: {
          columns: remoteLayout.creativeCards.columns,
          maxLines: remoteLayout.creativeCards.maxLines,
          minWidth: remoteLayout.creativeCards.minWidth,
        },
        narrative: {
          // A long narrative is never allowed to compete with the KPI block
          // on page one, even if a model chooses first_page.
          placement: remoteLayout.narrativeLayout.placement === "first_page" && remoteLayout.narrativeLayout.maxChars <= 560
            ? "first_page"
            : "next_page",
          maxParagraphs: remoteLayout.narrativeLayout.maxParagraphs,
          maxChars: remoteLayout.narrativeLayout.maxChars,
        },
        fingerprint: fingerprint({ fallback, remoteLayout }),
      },
      narrative,
      aiUsed: true,
      aiError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "falha desconhecida";
    console.error("northai report planning failed", { message });
    return { layout: fallback, narrative: [], aiUsed: false, aiError: message };
  }
}
