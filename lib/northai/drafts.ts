// Os rascunhos das receitas do Estúdio e a passagem pedido → rascunho → plano.
//
// Puro de propósito: o componente só guarda estado e desenha. Tudo o que decide
// "o que o Estúdio entendeu" e "o que vai ser criado" mora aqui e é testável —
// inclusive a garantia de que nada disso chama a rede. Criar só acontece em
// lib/northai/execute.ts, depois da confirmação.

import type { BuiltBlueprint } from "./blueprint";
import type { Cadence, ParsedCommand, RecipeKey } from "./commandParser";
import { NORTH_FORMATS, type NorthFormatKey } from "./formats";
import {
  automationBlueprint,
  flowBlueprint,
  planBlueprint,
  routineBlueprint,
  shootDayBlueprint,
  shortDate,
  type ShootDayDraftPiece,
} from "./recipes";
import type { ParsedScript } from "./scriptParser";

export type FormRecipe = Exclude<RecipeKey, "analise">;

export type ShootDraft = { shootDate: string; typeKey: string; assignee: string; withPlan: boolean; docUrl: string | null; scriptsText: string; pieces: ShootDayDraftPiece[] };
export type PlanDraftState = { title: string; startDate: string; assignee: string; counts: Partial<Record<NorthFormatKey, number>>; extra: string };
export type RoutineDraftState = { title: string; description: string; cadence: Cadence | ""; startDate: string; weekdays: number[]; assignee: string; routineKey: string | null };
export type FlowDraftState = { typeKey: string; title: string; count: number; format: NorthFormatKey; dueDate: string; assignee: string; planId: string };
export type AutomationDraftState = { automationKey: string; mode: "existing" | "new"; targetTaskId: string; newTitle: string; cadence: Cadence; startDate: string; assignee: string };

export type StudioDrafts = {
  diaria: ShootDraft;
  plano: PlanDraftState;
  rotina: RoutineDraftState;
  fluxo: FlowDraftState;
  automacao: AutomationDraftState;
};

export function initialDrafts(today: string, defaults: { shootTypeKey: string; deliveryTypeKey: string }): StudioDrafts {
  return {
    diaria: { shootDate: "", typeKey: defaults.shootTypeKey, assignee: "", withPlan: true, docUrl: null, scriptsText: "", pieces: [] },
    plano: { title: "", startDate: today, assignee: "", counts: {}, extra: "" },
    rotina: { title: "", description: "", cadence: "semanal", startDate: today, weekdays: [], assignee: "", routineKey: null },
    fluxo: { typeKey: defaults.deliveryTypeKey, title: "", count: 1, format: "reels", dueDate: "", assignee: "", planId: "" },
    automacao: { automationKey: "relatorio_trafego_semanal", mode: "new", targetTaskId: "", newTitle: "Relatório semanal de anúncios", cadence: "semanal", startDate: today, assignee: "" },
  };
}

export function piecesFromCounts(counts: Partial<Record<NorthFormatKey, number>>): ShootDayDraftPiece[] {
  return NORTH_FORMATS.flatMap((format) =>
    Array.from({ length: Math.min(20, counts[format.key] ?? 0) }, (_, index) => ({ title: `${format.label} ${index + 1}`, format: format.key, publishDate: null, body: "" })),
  );
}

export function piecesFromScripts(scripts: readonly ParsedScript[]): ShootDayDraftPiece[] {
  return scripts.map((script) => ({ title: script.title, format: script.format, publishDate: null, body: script.body }));
}

function countsText(counts: Partial<Record<NorthFormatKey, number>>): string {
  const parts = NORTH_FORMATS.filter((format) => (counts[format.key] ?? 0) > 0).map((format) => {
    const n = counts[format.key] ?? 0;
    return `${n} ${n === 1 ? format.label : format.plural}`;
  });
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

const CADENCE_TEXT: Record<Cadence, string> = { semanal: "semanal", quinzenal: "quinzenal", mensal: "mensal" };

/** Um pedido digitado vira rascunho — e a frase que diz o que foi entendido. Nunca cria nada. */
export function applyCommand(drafts: StudioDrafts, parsed: ParsedCommand, text: string): { drafts: StudioDrafts; intent: RecipeKey | null; understood: string | null } {
  const date = parsed.dates[0] ?? "";
  const counts = countsText(parsed.counts);
  switch (parsed.intent) {
    case "diaria": {
      const pieces = piecesFromCounts(parsed.counts);
      return {
        intent: "diaria",
        drafts: { ...drafts, diaria: { ...drafts.diaria, shootDate: date || drafts.diaria.shootDate, pieces: pieces.length ? pieces : drafts.diaria.pieces } },
        understood: `Entendi: diária de gravação${date ? ` em ${shortDate(date)}` : ""}${counts ? ` com ${counts}` : ""}. Confira as peças e as datas.`,
      };
    }
    case "plano":
      return {
        intent: "plano",
        drafts: { ...drafts, plano: { ...drafts.plano, counts: Object.keys(parsed.counts).length ? parsed.counts : drafts.plano.counts, startDate: date || drafts.plano.startDate } },
        understood: `Entendi: plano de ação${counts ? ` com ${counts}` : ""}${date ? ` a partir de ${shortDate(date)}` : ""}.`,
      };
    case "rotina":
      return {
        intent: "rotina",
        drafts: {
          ...drafts,
          rotina: {
            ...drafts.rotina,
            title: drafts.rotina.title || text.trim().replace(/^./, (letter) => letter.toUpperCase()).slice(0, 80),
            cadence: parsed.cadence ?? drafts.rotina.cadence,
            weekdays: parsed.weekdays.length ? parsed.weekdays : drafts.rotina.weekdays,
            startDate: date || drafts.rotina.startDate,
          },
        },
        understood: `Entendi: rotina${parsed.cadence ? ` ${CADENCE_TEXT[parsed.cadence]}` : ""}${date ? ` começando em ${shortDate(date)}` : ""}.`,
      };
    case "fluxo": {
      const first = (Object.keys(parsed.counts)[0] as NorthFormatKey | undefined) ?? drafts.fluxo.format;
      const count = Object.values(parsed.counts).reduce<number>((sum, value) => sum + (value ?? 0), 0);
      return {
        intent: "fluxo",
        drafts: { ...drafts, fluxo: { ...drafts.fluxo, format: first, count: count || drafts.fluxo.count, dueDate: date || drafts.fluxo.dueDate, title: drafts.fluxo.title || text.trim().slice(0, 80) } },
        understood: `Entendi: ${counts ? counts : "entregas"} em etapas${date ? ` com prazo ${shortDate(date)}` : ""}.`,
      };
    }
    case "automacao":
      return { intent: "automacao", drafts, understood: "Entendi: ligar uma automação." };
    case "analise":
      return { intent: "analise", drafts, understood: null };
    default:
      return { intent: null, drafts, understood: null };
  }
}

/** Preenche o rascunho a partir de uma lacuna ("Resolver"). */
export function applyPrefill(drafts: StudioDrafts, recipe: RecipeKey, prefill: Record<string, unknown> | undefined): StudioDrafts {
  if (!prefill) return drafts;
  if (recipe === "rotina") {
    const cadence = prefill.cadence === "semanal" || prefill.cadence === "quinzenal" || prefill.cadence === "mensal" ? prefill.cadence : "";
    return {
      ...drafts,
      rotina: {
        ...drafts.rotina,
        title: typeof prefill.title === "string" ? prefill.title : drafts.rotina.title,
        description: typeof prefill.description === "string" ? prefill.description : drafts.rotina.description,
        cadence,
        routineKey: typeof prefill.routineKey === "string" ? prefill.routineKey : null,
      },
    };
  }
  if (recipe === "automacao" && typeof prefill.automationKey === "string") {
    return { ...drafts, automacao: { ...drafts.automacao, automationKey: prefill.automationKey } };
  }
  return drafts;
}

export type BuildEnv = {
  client: { slug: string; name: string } | null;
  deliveryTypes: readonly { key: string; label: string }[];
  routines: readonly { id: string; title: string }[];
  today: string;
};

/** O que a receita vai criar, ou o que ainda falta preencher. */
export function buildRecipe(recipe: FormRecipe, drafts: StudioDrafts, env: BuildEnv): { value: BuiltBlueprint | null; problem: string | null } {
  if (!env.client) return { value: null, problem: "Escolha o cliente." };
  const client = env.client;
  try {
    if (recipe === "diaria") {
      const d = drafts.diaria;
      if (!d.typeKey) return { value: null, problem: "Nenhum tipo de entrega tem roteiro e captação." };
      if (!d.shootDate) return { value: null, problem: "Informe a data da gravação." };
      if (!d.pieces.length) return { value: null, problem: "Adicione pelo menos uma publicação." };
      return {
        value: shootDayBlueprint({
          clientSlug: client.slug,
          clientName: client.name,
          shootDate: d.shootDate,
          typeKey: d.typeKey,
          assignee: d.assignee || null,
          docUrl: d.docUrl,
          withPlan: d.withPlan,
          pieces: d.pieces.map((piece) => ({ ...piece, title: piece.title.trim() || "Publicação" })),
        }),
        problem: null,
      };
    }
    if (recipe === "plano") {
      const d = drafts.plano;
      if (!d.title.trim()) return { value: null, problem: "Dê um nome ao plano." };
      return { value: planBlueprint({ clientSlug: client.slug, title: d.title.trim(), startDate: d.startDate || env.today, assignee: d.assignee || null, counts: d.counts, extraTasks: d.extra.split("\n") }), problem: null };
    }
    if (recipe === "rotina") {
      const d = drafts.rotina;
      if (!d.title.trim()) return { value: null, problem: "Dê um nome à rotina." };
      return {
        value: routineBlueprint({ clientSlug: client.slug, title: d.title.trim(), description: d.description.trim() || null, cadence: d.cadence || null, startDate: d.startDate || env.today, weekdays: d.weekdays, assignee: d.assignee || null, routineKey: d.routineKey }),
        problem: null,
      };
    }
    if (recipe === "fluxo") {
      const d = drafts.fluxo;
      const type = env.deliveryTypes.find((entry) => entry.key === d.typeKey);
      if (!type) return { value: null, problem: "Escolha o tipo de entrega." };
      if (!d.title.trim()) return { value: null, problem: "Dê um título às entregas." };
      return { value: flowBlueprint({ clientSlug: client.slug, typeKey: type.key, typeLabel: type.label, title: d.title.trim(), count: d.count, format: d.format, dueDate: d.dueDate || null, assignee: d.assignee || null, planId: d.planId || null }), problem: null };
    }
    const d = drafts.automacao;
    const target = env.routines.find((entry) => entry.id === d.targetTaskId) ?? null;
    return {
      value: automationBlueprint({
        clientSlug: client.slug,
        automationKey: d.automationKey,
        targetTaskId: d.mode === "existing" ? d.targetTaskId || null : null,
        targetTitle: target?.title ?? null,
        newTarget: d.mode === "new" ? { title: d.newTitle.trim() || "Rotina da automação", cadence: d.cadence, startDate: d.startDate || env.today, assignee: d.assignee || null } : null,
        performanceTemplateId: null,
      }),
      problem: null,
    };
  } catch (error) {
    return { value: null, problem: error instanceof Error ? error.message : "Faltam informações." };
  }
}
