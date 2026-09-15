import type { RecipeKey } from "@/lib/northai/commandParser";

// Textos das seis entradas do Estúdio — linguagem da operação, sem termos
// internos e sem repetir o nome do cliente (ele já está no contexto e no avatar).
export const RECIPE_META: Record<RecipeKey, { title: string; blurb: string; ask: string; intro: string; done: string }> = {
  diaria: {
    title: "Diária de gravação",
    blurb: "Uma gravação, várias publicações",
    ask: "Quero montar uma diária de gravação",
    intro: "Vamos montar a diária. Informe a data e as peças — nada é criado antes de você confirmar.",
    done: "Diária criada",
  },
  plano: {
    title: "Plano de ação",
    blurb: "Volume de conteúdo e atividades com prazo",
    ask: "Quero criar um plano de ação",
    intro: "Vamos montar o plano de ação.",
    done: "Plano criado",
  },
  rotina: {
    title: "Rotina",
    blurb: "Assessoria, reunião e checks que se repetem",
    ask: "Quero criar uma rotina",
    intro: "Qual rotina vamos criar?",
    done: "Rotina criada",
  },
  fluxo: {
    title: "Fluxo",
    blurb: "Entregas em etapas, com formato",
    ask: "Quero criar entregas",
    intro: "Vamos montar as entregas.",
    done: "Entregas criadas",
  },
  automacao: {
    title: "Automação",
    blurb: "Relatório semanal e coleta de métricas",
    ask: "Quero ligar uma automação",
    intro: "Qual automação vamos ligar?",
    done: "Automação ligada",
  },
  analise: {
    title: "Analisar operação",
    blurb: "Atrasos, paradas e o que falta amarrar",
    ask: "Analise a operação",
    intro: "Olhei a operação.",
    done: "",
  },
};

export const RECIPE_ORDER: RecipeKey[] = ["diaria", "plano", "rotina", "fluxo", "automacao", "analise"];
