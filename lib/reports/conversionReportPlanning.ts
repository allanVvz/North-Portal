import { createHash } from "node:crypto";
import type { Period } from "@/app/admin/performance/insights";
import type { AdaptiveInterpretation } from "@/lib/ai/adaptiveFeedback";
import type { ConversionRow } from "@/lib/ai/extractMetrics";
import type { MetaPost } from "@/lib/windsor";
import { generateLayoutPlan, generateNarrative, type ReportPlanningEvidence } from "@/lib/northai/aiPrompts";
import { northAIContextSchema, type NorthAIContext, type VisualRequest } from "@/lib/northai/aiContracts";

export type ReportContext = {
  period: Period;
  metrics: { vendas: number | null; agendamentos: number | null; receita: number | null; seguidores: number | null; seguidoresNovos: number | null };
  previousMetrics?: { vendas: number | null; agendamentos: number | null; receita: number | null; seguidores: number | null; seguidoresNovos: number | null };
  conversions: ConversionRow[];
  media: { campaigns: MetaPost[]; ads: MetaPost[] };
  interpretation: AdaptiveInterpretation;
  parser: "llm" | "parser" | "fallback";
  sourceFingerprint: string;
  narrative?: Array<{ kind: string; text: string }>;
  visualRequest?: VisualRequest | null;
};

export type ConversionLayoutPlan = {
  sections: { result: true; indicators: true; funnel: true; technicalReading: true; adContribution: true; conversionHistory: boolean; commercial: boolean };
  hideTrendCharts: true;
  creativeCards: { columns: 1 | 2; maxLines: number; minWidth: number };
  funnel: { width: number; maxWidth: number; nodeWidth: number; labelMode: "inside" | "below" | "outside"; lastLevelWidth: number; gap: number; maxLabelLines: number };
  narrative: { placement: "first_page" | "next_page"; maxParagraphs: number; maxChars: number };
  fingerprint: string;
  visualRequest?: VisualRequest | null;
};

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildReportContext(input: {
  period: Period; metrics: ReportContext["metrics"]; conversions: ConversionRow[];
  previousMetrics?: ReportContext["previousMetrics"];
  campaigns: MetaPost[]; ads: MetaPost[]; interpretation: AdaptiveInterpretation;
  parser: string; sourceFingerprint: string; visualRequest?: VisualRequest | null;
}): ReportContext {
  const parser: ReportContext["parser"] = input.parser === "llm" ? "llm" : input.parser === "parser" ? "parser" : "fallback";
  return { period: input.period, metrics: input.metrics, previousMetrics: input.previousMetrics, conversions: input.conversions, media: { campaigns: input.campaigns, ads: input.ads }, interpretation: input.interpretation, parser, sourceFingerprint: input.sourceFingerprint, visualRequest: input.visualRequest ?? null };
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
  visualRequest?: VisualRequest | null;
}): NorthAIContext {
  const { context } = input;
  const metricValues = context.metrics;
  const metrics = Object.entries(metricValues).map(([key, value]) => {
    const metricKey = key as keyof ReportContext["metrics"];
    const previous = context.previousMetrics?.[metricKey] ?? null;
    const difference = value !== null && previous !== null ? value - previous : null;
    const percent = difference !== null && previous !== null && previous !== 0 ? (difference / Math.abs(previous)) * 100 : null;
    return {
      key,
      label: key === "seguidoresNovos" ? "Seguidores adquiridos" : key,
      value,
      previous,
      difference,
      percent,
      source: "Feedback",
    };
  });
  const ads = context.media.ads.map((post) => ({
    id: post.adId ?? post.id,
    name: (post.adName ?? post.caption) || "Anúncio",
    campaign: post.campaignName ?? null,
    objective: post.objective ?? null,
    optimizationGoal: post.optimizationGoal ?? null,
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
    visualRequest: input.visualRequest ?? null,
    reports: { adsFinal: input.adsFinal, adsRevision: input.adsRevision ?? null, hiddenFields: [], editorialInstruction: input.editorialInstruction ?? null },
  });
}

export function buildLayoutPlan(context: ReportContext): ConversionLayoutPlan {
  const commercial = context.metrics.vendas !== null || context.metrics.receita !== null || context.metrics.agendamentos !== null || context.conversions.length > 0;
  const shape = { sections: { result: true, indicators: true, funnel: true, technicalReading: true, adContribution: true, conversionHistory: context.metrics.seguidoresNovos !== null || commercial, commercial }, hideTrendCharts: true, creativeCards: { columns: 1 as const, maxLines: 3, minWidth: 0 }, funnel: { width: 360, maxWidth: 420, nodeWidth: 220, labelMode: "below" as const, lastLevelWidth: 220, gap: 12, maxLabelLines: 2 }, narrative: { placement: "first_page" as const, maxParagraphs: 1, maxChars: 560 }, sourceFingerprint: context.sourceFingerprint, visualRequest: context.visualRequest ?? null } as const;
  return { ...shape, fingerprint: fingerprint(shape) };
}

function planningEvidence(context: ReportContext): ReportPlanningEvidence {
  return {
    history: context.conversions.map((row) => ({
      service: row.servico,
      value: row.valor,
      source: row.fonte,
      status: row.status,
    })),
    campaigns: context.media.campaigns.map((campaign) => ({
      id: campaign.campaignId ?? campaign.id,
      name: (campaign.campaignName ?? campaign.caption) || "Campanha",
      objective: campaign.objective ?? null,
      optimizationGoal: campaign.optimizationGoal ?? null,
      metrics: {
        reach: campaign.metrics.alcance ?? null,
        profileVisits: campaign.metrics.profileVisits ?? null,
        linkClicks: campaign.metrics.cliquesLink ?? null,
        landingPageViews: campaign.metrics.landingPageViews ?? null,
        contacts: campaign.metrics.contatos ?? campaign.metrics.mensagens ?? null,
        spend: campaign.metrics.custo ?? null,
      },
    })),
  };
}

/** Optional NorthAI/Dashboard Architect pass. It is opt-in for jobs so a
 * missing provider never blocks a deterministic report regeneration. */
export async function planWithNorthAI(input: {
  context: ReportContext;
  northAIContext: NorthAIContext;
}): Promise<{ layout: ConversionLayoutPlan; narrative: Array<{ kind: string; text: string }>; aiUsed: boolean; aiError: string | null }> {
  const fallback = buildLayoutPlan(input.context);
  const plannerFlag = process.env.NORTHAI_REPORT_PLANNER;
  if (plannerFlag === "0" || (process.env.NODE_ENV === "test" && plannerFlag !== "1")) {
    return { layout: fallback, narrative: [], aiUsed: false, aiError: null };
  }
  try {
    // A classificacao acontece no hook do comentario, onde o comentario mais
    // recente e conhecido. O planner recebe somente o pedido normalizado;
    // nunca tenta inferir um pedido antigo a cada regeneracao.
    const visualRequest = input.northAIContext.visualRequest ?? null;
    const enrichedContext = northAIContextSchema.parse({ ...input.northAIContext, visualRequest });
    const evidence = planningEvidence(input.context);
    // NorthAI first establishes the validated editorial reading. Dashboard
    // Architect then receives that typed handoff and converts it into hierarchy.
    const narrative = await generateNarrative(enrichedContext, "conversion", evidence);
    const remoteLayout = await generateLayoutPlan(enrichedContext, "conversion", { evidence, northAIHandoff: narrative });
    return {
      layout: {
        ...fallback,
        creativeCards: {
          columns: remoteLayout.creativeCards.columns,
          maxLines: remoteLayout.creativeCards.maxLines,
          minWidth: remoteLayout.creativeCards.minWidth,
        },
        funnel: {
          width: remoteLayout.funnel.width,
          maxWidth: remoteLayout.funnel.maxWidth,
          nodeWidth: remoteLayout.funnel.nodeWidth,
          labelMode: remoteLayout.funnel.labelMode,
          lastLevelWidth: remoteLayout.funnel.lastLevelWidth,
          gap: remoteLayout.funnel.gap,
          maxLabelLines: remoteLayout.funnel.maxLabelLines,
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
        fingerprint: fingerprint({ fallback, remoteLayout, visualRequest }),
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
