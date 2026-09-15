import type { BlueprintResult, PreviewLine } from "@/lib/northai/blueprint";
import type { RecipeKey } from "@/lib/northai/commandParser";
import type { NorthAiClientOption } from "@/lib/northai/clients";

export type ClientLite = NorthAiClientOption;
export type TypeLite = { key: string; label: string; behavior: string; shootReady: boolean };

/** Estados visíveis de um pedido — um vocabulário só na tela. */
export type RecipeStatus = "rascunho" | "revisar" | "criando" | "criado" | "erro" | "cancelado";

export const STATUS_LABEL: Record<RecipeStatus, string> = {
  rascunho: "Rascunho",
  revisar: "Pronto para revisar",
  criando: "Criando",
  criado: "Criado",
  erro: "Erro",
  cancelado: "Cancelado",
};

export type StudioMessage =
  | {
      id: string;
      at: string;
      role: "user";
      text: string;
      /** Cliente em que o pedido foi feito (id, não nome). */
      clientId: string;
      /** Rótulo da @menção explícita, quando houve. */
      mentionLabel?: string;
    }
  | { id: string; at: string; role: "assistant"; kind: "text"; text: string; tone?: "info" | "warn" | "error" }
  | {
      id: string;
      at: string;
      role: "assistant";
      kind: "recipe";
      recipe: Exclude<RecipeKey, "analise">;
      title: string;
      status: RecipeStatus;
      /** Retrato da prévia confirmada (o rascunho vivo não é guardado). */
      preview: PreviewLine[];
      result: BlueprintResult | null;
      note?: string;
    }
  | {
      id: string;
      at: string;
      role: "assistant";
      kind: "analysis";
      percent: number;
      summary: string;
      gaps: { title: string; detail: string; severity: string }[];
    }
  | {
      id: string;
      at: string;
      role: "assistant";
      kind: "choice";
      text: string;
      options: { clientId: string; label: string }[];
      pendingText: string;
      chosenClientId: string | null;
    };

export type RecipeMessage = Extract<StudioMessage, { kind: "recipe" }>;
export type ChoiceMessage = Extract<StudioMessage, { kind: "choice" }>;
