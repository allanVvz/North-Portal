import type { RecipeKey } from "@/lib/northai/commandParser";

// Textos das seis entradas do Estúdio — linguagem da operação, sem termos internos.
export const RECIPE_META: Record<RecipeKey, { title: string; blurb: string; ask: string; intro: (client: string) => string; done: string }> = {
  diaria: {
    title: "Diária de gravação",
    blurb: "Uma gravação, várias publicações",
    ask: "Quero montar uma diária de gravação",
    intro: (client) => `Vamos montar a diária de ${client}. Informe a data e as peças — nada é criado antes de você confirmar.`,
    done: "Diária criada",
  },
  plano: {
    title: "Plano de ação",
    blurb: "Volume de conteúdo e atividades com prazo",
    ask: "Quero criar um plano de ação",
    intro: (client) => `Vamos montar o plano de ação de ${client}.`,
    done: "Plano criado",
  },
  rotina: {
    title: "Rotina",
    blurb: "Assessoria, reunião e checks que se repetem",
    ask: "Quero criar uma rotina",
    intro: (client) => `Qual rotina de ${client} vamos criar?`,
    done: "Rotina criada",
  },
  fluxo: {
    title: "Fluxo",
    blurb: "Entregas em etapas, com formato",
    ask: "Quero criar entregas",
    intro: (client) => `Quantas entregas de ${client} e em qual formato?`,
    done: "Entregas criadas",
  },
  automacao: {
    title: "Automação",
    blurb: "Relatório semanal e coleta de métricas",
    ask: "Quero ligar uma automação",
    intro: (client) => `Qual automação vamos ligar para ${client}?`,
    done: "Automação ligada",
  },
  analise: {
    title: "Analisar operação",
    blurb: "Atrasos, paradas e o que falta amarrar",
    ask: "Analise a operação",
    intro: (client) => `Olhei a operação de ${client}.`,
    done: "",
  },
};

export const RECIPE_ORDER: RecipeKey[] = ["diaria", "plano", "rotina", "fluxo", "automacao", "analise"];
