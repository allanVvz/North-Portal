// O Blueprint é o contrato entre o Estúdio e o servidor: a lista ordenada do que
// uma receita vai criar. A receita (lib/northai/recipes.ts) monta; a pessoa vê a
// prévia; POST /api/admin/northai/execute valida com este schema e executa.
//
// É também a fronteira que o harness completo vai usar (roadmap, VPS): um LLM
// com tool-calling produz as MESMAS operações — o executor não muda.

import { z } from "zod";
import { isAutomationKey } from "@/lib/automationCatalog";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const ref = z.string().min(1).max(40);
const uuid = z.string().uuid();

export const blueprintTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: z.string().min(1).max(60).optional(),
  subtype: z.string().max(60).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
  assignee: z.string().max(120).nullable().optional(),
  due_date: isoDate.nullable().optional(),
  start_date: isoDate.nullable().optional(),
  recurrence_cadence: z.enum(["semanal", "quinzenal", "mensal"]).nullable().optional(),
  recurrence_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  formato: z.string().max(80).nullable().optional(),
  /** Rotina padrão do cadastro (lib/clientRoutines.ts) que este card cumpre. */
  routineKey: z.string().max(60).nullable().optional(),
});

export const shootDayPieceSchema = z.object({
  title: z.string().trim().min(1).max(300),
  formato: z.string().min(1).max(80),
  publishDate: isoDate.nullable(),
  description: z.string().max(20000).nullable().optional(),
});

export const blueprintOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("createTask"),
    ref,
    scope: z.enum(["task", "plan", "routine"]),
    task: blueprintTaskSchema,
    /** Liga ao plano criado antes neste mesmo Blueprint… */
    planRef: ref.optional(),
    /** …ou a um plano que já existe. */
    planId: uuid.optional(),
  }),
  z.object({
    op: z.literal("createShootDay"),
    ref,
    planRef: ref.optional(),
    planId: uuid.optional(),
    typeKey: z.string().min(1).max(60),
    shootDate: isoDate,
    scriptTitle: z.string().trim().min(1).max(300),
    scriptDescription: z.string().max(20000).nullable(),
    captureTitle: z.string().trim().min(1).max(300),
    assignee: z.string().max(120).nullable(),
    pieces: z.array(shootDayPieceSchema).min(1).max(40),
  }),
  z.object({
    op: z.literal("createAutomation"),
    ref,
    automationKey: z.string().refine(isAutomationKey, "Automação desconhecida."),
    targetRef: ref.optional(),
    targetTaskId: uuid.optional(),
    performanceTemplateId: z.string().min(1).max(80).nullable().optional(),
  }),
]);

// A regra "exatamente um card-alvo" fica aqui fora: discriminatedUnion não
// aceita um membro com .refine.
export const blueprintSchema = z.object({
  recipe: z.enum(["diaria", "plano", "rotina", "fluxo", "automacao"]),
  title: z.string().min(1).max(300),
  clientSlug: z.string().min(1).max(80).nullable(),
  /** Identidade estruturada do cliente (da @menção/workspace). Quando vem, precisa bater com o slug. */
  clientId: z.string().uuid().nullable().optional(),
  ops: z.array(blueprintOpSchema).min(1).max(80),
}).superRefine((blueprint, ctx) => {
  blueprint.ops.forEach((op, index) => {
    if (op.op === "createAutomation" && Boolean(op.targetRef) === Boolean(op.targetTaskId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ops", index], message: "A automação precisa de exatamente um card-alvo." });
    }
  });
});

export type BlueprintTask = z.infer<typeof blueprintTaskSchema>;
export type BlueprintOp = z.infer<typeof blueprintOpSchema>;
export type Blueprint = z.infer<typeof blueprintSchema>;

/** Uma linha da prévia "o que será criado". `group` agrupa na tela (ex.: Compartilhado, Peças). */
export type PreviewLine = { icon: string; text: string; detail?: string; indent?: boolean; group?: string };

export type BuiltBlueprint = { blueprint: Blueprint; preview: PreviewLine[] };

/** O que o executor devolve: cada card criado, na ordem, para a conversa linkar. */
export type BlueprintCreated = { ref: string; kind: "task" | "plan" | "routine" | "delivery" | "step" | "automation"; id: string; title: string };
export type BlueprintResult = { created: BlueprintCreated[]; error: string | null };
