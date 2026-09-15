// Em qual cliente um pedido vai acontecer — uma regra só, usada pelo Estúdio
// inteiro (e pelo harness com IA depois).
//
//   menção estruturada (@cliente, com id)
//     ?? cliente citado no texto (compatibilidade: "…Tock Fatal")
//     ?? cliente da conversa aberta
//     ?? cliente ativo do workspace
//
// A menção estruturada sempre ganha. Se o texto citar OUTRO cliente, isso é um
// conflito explícito: o pedido não segue sozinho para nenhum dos dois — a tela
// pergunta. Nunca executar num cliente inesperado.

export type ContextSource = "mention" | "text" | "thread" | "workspace";

export type ResolvedContext = {
  clientId: string | null;
  source: ContextSource | null;
  /** Menção e texto apontam para clientes diferentes. */
  conflict: { mentionClientId: string; textClientId: string } | null;
};

export function resolveNorthAiContext(input: {
  mentionClientId?: string | null;
  textClientId?: string | null;
  threadClientId?: string | null;
  workspaceClientId?: string | null;
}): ResolvedContext {
  const mention = input.mentionClientId ?? null;
  const text = input.textClientId ?? null;
  if (mention) {
    return { clientId: mention, source: "mention", conflict: text && text !== mention ? { mentionClientId: mention, textClientId: text } : null };
  }
  if (text) return { clientId: text, source: "text", conflict: null };
  if (input.threadClientId) return { clientId: input.threadClientId, source: "thread", conflict: null };
  if (input.workspaceClientId) return { clientId: input.workspaceClientId, source: "workspace", conflict: null };
  return { clientId: null, source: null, conflict: null };
}
