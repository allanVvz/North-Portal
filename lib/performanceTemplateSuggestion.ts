import type { MetaPost } from "./windsor";

export type TemplateSuggestion = { id: string; reason: string };

/** Uses observed outcomes and campaign goals from the selected operation.
 * A mixed account keeps the goal-specific report rather than forcing a funnel. */
export function suggestPerformanceTemplate(posts: readonly Pick<MetaPost, "source" | "metrics" | "objective" | "optimizationGoal">[]): TemplateSuggestion | null {
  const paid = posts.filter((post) => post.source === "paid");
  if (!paid.length) return null;
  let purchases = 0;
  let conversations = 0;
  for (const post of paid) {
    const goal = `${post.objective ?? ""} ${post.optimizationGoal ?? ""}`.toUpperCase();
    purchases += (post.metrics.compras ?? 0) > 0 || /PURCHASE|SALES|OFFSITE_CONVERSIONS/.test(goal) ? 1 : 0;
    conversations += (post.metrics.mensagens ?? 0) > 0 || (post.metrics.contatos ?? 0) > 0 ||
      /MESSAGE|CONVERS|REPLIES|WHATS|LEAD/.test(goal) ? 1 : 0;
  }
  if (purchases && conversations) return { id: "builtin-por-resultado", reason: "Há campanhas com compras e conversas no período." };
  if (purchases) return { id: "builtin-funil-compras", reason: "Compras ou objetivos de venda aparecem nos dados." };
  if (conversations) return { id: "builtin-funil-mensagens", reason: "Mensagens, contatos ou objetivos de conversa aparecem nos dados." };
  return { id: "builtin-por-resultado", reason: "Os objetivos variam; o resultado de cada campanha orienta a leitura." };
}
