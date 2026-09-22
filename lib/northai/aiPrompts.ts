import { aiComplete } from "@/lib/ai/complete";
import {
  layoutNarrativeSchema,
  layoutPlanSchema,
  northAIContextSchema,
  visualRequestSchema,
  type LayoutPlan,
  type NorthAIContext,
  type VisualRequest,
} from "./aiContracts";

export type StructuredPrompt = { system: string; user: string; maxTokens: number; model?: string };
export const DEFAULT_NORTHAI_MODEL = "gpt-4o-mini";

export type ReportPlanningEvidence = {
  history?: Array<{ service: string | null; value: number | null; source: string | null; status: string | null }>;
  campaigns?: Array<{
    id: string;
    name: string;
    objective: string | null;
    optimizationGoal: string | null;
    metrics: Record<string, number | null>;
  }>;
};

const JSON_RULE = "Responda somente JSON valido, sem markdown, comentarios ou texto fora do objeto.";

function roleModel(role: "northai" | "dashboard"): string {
  const configured = role === "northai" ? process.env.NORTHAI_MODEL : process.env.DASHBOARD_ARCHITECT_MODEL;
  return configured?.trim() || DEFAULT_NORTHAI_MODEL;
}

/** Deliberately excludes client identity, raw comments, URLs and attachments.
 * The model receives only bounded structured facts needed for report planning. */
function planningEvidence(context: NorthAIContext, supplemental?: ReportPlanningEvidence) {
  return {
    period: context.period,
    objective: context.objective,
    metrics: context.metrics,
    history: supplemental?.history ?? [],
    funnel: context.funnel,
    campaigns: supplemental?.campaigns ?? [],
    ads: context.media.ads,
    mediaTotals: { reach: context.media.reach, profileVisits: context.media.profileVisits },
    visualRequest: context.visualRequest,
    layoutConstraints: context.reports,
  };
}

export function buildLayoutPlanPrompt(input: NorthAIContext, document: "ads" | "conversion", options?: {
  evidence?: ReportPlanningEvidence;
  northAIHandoff?: LayoutPlan["narrative"];
}): StructuredPrompt {
  const context = northAIContextSchema.parse(input);
  return {
    system: [
      "Voce e o Dashboard Architect da Northia, responsavel pela estrutura visual declarativa do relatorio.",
      "NorthAI ja forneceu os fatos; escolha hierarquia, ordem e densidade, sem alterar valores.",
      "Use o handoff editorial validado do NorthAI como orientacao, mas mantenha todos os numeros ancorados nas evidencias.",
      "Nao repita o mesmo fato em varias secoes: cada mensagem principal deve ter um unico ponto de destaque e as tabelas funcionam como evidencia, nao como uma segunda narrativa.",
      "Use apenas fatos presentes no contexto; null significa nao informado e nao pode virar zero.",
      "Nao invente causalidade, taxas ou metricas. Respeite layoutConstraints.hiddenFields.",
      "Na conversao, priorize ganhos de audiencia na abertura, preserve comparacoes desfavoraveis e deixe a tabela compacta de crescimento junto do historico/comercial, nao como tabela generica na primeira pagina.",
      "Para criativos, use 1 largo; 2 equivalentes; 3 com o melhor maior e dois empilhados; 4 em grade 2x2. O renderer continua soberano sobre limites e paginacao.",
      "Para o funil, prefira largura moderada, labels abaixo do bloco e nunca estique o ultimo nivel ate a largura da pagina.",
      `${JSON_RULE} O objeto deve conter document, title, period, sections, narrative, hiddenFields, creativeCards, funnel e narrativeLayout.`,
    ].join(" "),
    user: JSON.stringify({
      document,
      evidence: planningEvidence(context, options?.evidence),
      northAIHandoff: options?.northAIHandoff ?? [],
    }),
    maxTokens: 3000,
    model: roleModel("dashboard"),
  };
}

export function buildVisualRequestPrompt(input: NorthAIContext): StructuredPrompt {
  const context = northAIContextSchema.parse(input);
  return {
    system: [
      "Voce e o NorthAI, classificador de pedidos de melhoria de relatorio.",
      "Leia somente o pedido textual e o contexto factual fornecidos; nao leia PDF, imagem, URL ou anexo.",
      "Classifique o ultimo pedido visual. Se faltarem local ou tipo de correcao, marque needsClarification=true e escolha uma pergunta curta.",
      `${JSON_RULE} Retorne {"target":"funnel|narrative|table|first_page|ads|unknown","problem":"overlap|too_wide|too_narrow|too_much_padding|wrong_order|repetition|other","instruction":"...","sourceCommentAt":"... ou null","needsClarification":true|false,"clarification":"where_overlap|what_to_improve|more_changes ou null"}.`,
    ].join(" "),
    user: JSON.stringify({
      requestEvidence: {
        visualRequest: context.visualRequest,
        comments: context.comments.map(({ at, text }) => ({ at, text })),
      },
    }),
    maxTokens: 900,
    model: roleModel("northai"),
  };
}

export function buildNarrativePrompt(input: NorthAIContext, document: "ads" | "conversion", evidence?: ReportPlanningEvidence): StructuredPrompt {
  const context = northAIContextSchema.parse(input);
  return {
    system: [
      "Voce e o NorthAI e escreve narrativa para cliente em portugues do Brasil.",
      "Separe explicitamente fato, comparacao, contexto estrategico e limite de atribuicao.",
      "Comece pelo ganho confirmado, contextualize a referencia anterior sem a esconder e destaque a evolucao da base total.",
      "Nao atribua crescimento de seguidores diretamente a midia; trate essa relacao como limite de atribuicao.",
      "Nunca mencione nomes de responsaveis/revisores, processamento interno ou comentarios literalmente.",
      `${JSON_RULE} Retorne {"narrative":[{"kind":"fact|comparison|context|limitation","text":"..."}]}.`,
    ].join(" "),
    user: JSON.stringify({ document, evidence: planningEvidence(context, evidence) }),
    maxTokens: 1800,
    model: roleModel("northai"),
  };
}

function jsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("NorthAI retornou JSON invalido.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("NorthAI retornou JSON invalido.");
  }
}

export async function generateLayoutPlan(input: NorthAIContext, document: "ads" | "conversion", options?: {
  evidence?: ReportPlanningEvidence;
  northAIHandoff?: LayoutPlan["narrative"];
}): Promise<LayoutPlan> {
  const result = await aiComplete(buildLayoutPlanPrompt(input, document, options));
  return layoutPlanSchema.parse(jsonObject(result));
}

export async function classifyVisualRequest(input: NorthAIContext): Promise<VisualRequest> {
  const result = await aiComplete(buildVisualRequestPrompt(input));
  return visualRequestSchema.parse(jsonObject(result));
}

export async function generateNarrative(input: NorthAIContext, document: "ads" | "conversion", evidence?: ReportPlanningEvidence): Promise<LayoutPlan["narrative"]> {
  const result = await aiComplete(buildNarrativePrompt(input, document, evidence));
  const parsed = jsonObject(result) as { narrative?: unknown };
  return layoutNarrativeSchema.array().parse(parsed.narrative ?? []);
}
