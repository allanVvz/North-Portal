import { aiComplete } from "@/lib/ai/complete";
import { layoutNarrativeSchema, layoutPlanSchema, northAIContextSchema, visualRequestSchema, type LayoutPlan, type NorthAIContext, type VisualRequest } from "./aiContracts";

export type StructuredPrompt = { system: string; user: string; maxTokens: number; model?: string };

const JSON_RULE = "Responda somente JSON válido, sem markdown, comentários ou texto fora do objeto.";

export function buildLayoutPlanPrompt(input: NorthAIContext, document: "ads" | "conversion"): StructuredPrompt {
  const context = northAIContextSchema.parse(input);
  return {
    system: [
      "Você é o Dashboard Architect da Northia, responsável pela estrutura visual declarativa do relatório.",
      "NorthAI já forneceu os fatos; escolha hierarquia, ordem e densidade, sem alterar valores.",
      "Use apenas fatos presentes no contexto; null significa não informado e não pode virar zero.",
      "Não invente causalidade, taxas ou métricas. Respeite reports.hiddenFields.",
      "Para o funil, prefira largura moderada, labels abaixo do bloco e nunca estique o último nível até a largura da página.",
      `${JSON_RULE} O objeto deve conter document, title, period, sections, narrative, hiddenFields, creativeCards, funnel e narrativeLayout.`,
    ].join(" "),
    user: JSON.stringify({ document, context }),
    maxTokens: 3000,
    model: process.env.DASHBOARD_ARCHITECT_MODEL ?? undefined,
  };
}

export function buildVisualRequestPrompt(input: NorthAIContext): StructuredPrompt {
  const context = northAIContextSchema.parse(input);
  return {
    system: [
      "Você é o NorthAI, classificador de pedidos de melhoria de relatório.",
      "Leia somente os comentários e o contexto factual fornecidos; não leia PDF nem imagem.",
      "Classifique o último pedido visual. Se faltarem local ou tipo de correção, marque needsClarification=true e escolha uma pergunta curta.",
      `${JSON_RULE} Retorne {"target":"funnel|narrative|table|first_page|ads|unknown","problem":"overlap|too_wide|too_narrow|too_much_padding|wrong_order|repetition|other","instruction":"...","sourceCommentAt":"... ou null","needsClarification":true|false,"clarification":"where_overlap|what_to_improve|more_changes ou null"}.`,
    ].join(" "),
    user: JSON.stringify({ context }),
    maxTokens: 900,
    model: process.env.NORTHAI_MODEL ?? undefined,
  };
}

export function buildNarrativePrompt(input: NorthAIContext, document: "ads" | "conversion"): StructuredPrompt {
  const context = northAIContextSchema.parse(input);
  return {
    system: [
      "Você escreve narrativa para cliente em português do Brasil.",
      "Separe explicitamente fato, comparação, contexto estratégico e limite de atribuição.",
      "Nunca mencione nomes de responsáveis/revisores, processamento interno ou comentários literalmente.",
      `${JSON_RULE} Retorne {"narrative":[{"kind":"fact|comparison|context|limitation","text":"..."}]}.`,
    ].join(" "),
    user: JSON.stringify({ document, context }),
    maxTokens: 1800,
    model: process.env.NORTHAI_MODEL ?? undefined,
  };
}

function jsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("NorthAI retornou JSON inválido.");
  try { return JSON.parse(text.slice(start, end + 1)); } catch { throw new Error("NorthAI retornou JSON inválido."); }
}

export async function generateLayoutPlan(input: NorthAIContext, document: "ads" | "conversion"): Promise<LayoutPlan> {
  const result = await aiComplete(buildLayoutPlanPrompt(input, document));
  return layoutPlanSchema.parse(jsonObject(result));
}

export async function classifyVisualRequest(input: NorthAIContext): Promise<VisualRequest> {
  const result = await aiComplete(buildVisualRequestPrompt(input));
  return visualRequestSchema.parse(jsonObject(result));
}

export async function generateNarrative(input: NorthAIContext, document: "ads" | "conversion"): Promise<LayoutPlan["narrative"]> {
  const result = await aiComplete(buildNarrativePrompt(input, document));
  const parsed = jsonObject(result) as { narrative?: unknown };
  return layoutNarrativeSchema.array().parse(parsed.narrative ?? []);
}
