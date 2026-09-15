// Menções estruturadas do composer do NorthAi.
//
// "@Tock Fatal" é o que a pessoa vê; o que viaja é `{ kind: "client", clientId }`.
// A identidade do cliente nunca é reextraída do texto na hora de executar — o
// nome pode mudar amanhã sem quebrar histórico nem pedidos.
//
// `ComposerInput` é o pacote que o composer entrega. Hoje só @cliente; o mesmo
// formato recebe depois "/operação" e "+arquivo" (R4.11) sem reescrever a tela.

import { normalizeText } from "./formats";

export type MentionClient = { id: string; slug: string; name: string; segment?: string | null; city?: string | null };

export type ComposerMention = { kind: "client"; clientId: string; label: string };

export type ComposerInput = { text: string; mentions: ComposerMention[] };

/** O trecho "@consulta" que está sendo digitado, entre `start` (o @) e o cursor. */
export type MentionQuery = { start: number; end: number; query: string };

/** Detecta um "@consulta" terminando no cursor. E-mail ("a@b") e quebra de linha não contam. */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/[\n@]/.test(query) || query.length > 40 || query.split(/\s+/).length > 3) return null;
  return { start: at, end: caret, query };
}

/** Clientes que casam com a consulta: começo do nome, começo de uma palavra, slug, depois contém. */
export function filterClients<T extends MentionClient>(clients: readonly T[], query: string, limit = 8): T[] {
  const needle = normalizeText(query.trim());
  if (!needle) return [...clients].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  const slugNeedle = needle.replace(/\s+/g, "-");
  return clients
    .map((client) => {
      const name = normalizeText(client.name);
      const score = name.startsWith(needle)
        ? 0
        : name.split(/\s+/).some((word) => word.startsWith(needle))
          ? 1
          : client.slug.startsWith(slugNeedle)
            ? 2
            : name.includes(needle)
              ? 3
              : -1;
      return { client, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.client.name.localeCompare(b.client.name))
    .slice(0, limit)
    .map((entry) => entry.client);
}

/** Tira o "@consulta" do texto quando a menção vira token. */
export function removeMentionQuery(text: string, range: MentionQuery): { text: string; caret: number } {
  const head = text.slice(0, range.start);
  const tail = text.slice(range.end).replace(/^\s+/, "");
  const next = head.length ? `${head.replace(/\s+$/, "")}${tail ? " " : ""}${tail}` : tail;
  return { text: next, caret: head.length ? head.replace(/\s+$/, "").length + (tail ? 1 : 0) : 0 };
}

export type PickerState = { open: boolean; index: number };

/**
 * Teclado do picker: setas navegam (com volta), Enter e Tab escolhem, Escape
 * fecha. Com o picker fechado nada é tratado — Enter continua enviando e
 * Shift+Enter continua quebrando linha (quem chama não passa Shift+Enter aqui).
 */
export function pickerKey(state: PickerState, key: string, count: number): { state: PickerState; select: number | null; handled: boolean } {
  if (!state.open) return { state, select: null, handled: false };
  if (key === "Escape") return { state: { open: false, index: 0 }, select: null, handled: true };
  if (!count) return { state, select: null, handled: key === "Enter" || key === "Tab" };
  if (key === "ArrowDown") return { state: { open: true, index: (state.index + 1) % count }, select: null, handled: true };
  if (key === "ArrowUp") return { state: { open: true, index: (state.index - 1 + count) % count }, select: null, handled: true };
  if (key === "Enter" || key === "Tab") return { state: { open: false, index: 0 }, select: Math.min(state.index, count - 1), handled: true };
  return { state, select: null, handled: false };
}
