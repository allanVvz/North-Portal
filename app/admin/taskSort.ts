// Ordenação compartilhada pelas telas Tarefas e Clientes.
//
// Puro e sem React de propósito: o mesmo comparador roda no board (BoardRow),
// nas rotinas (RecurringTask) e nos testes, sem que nenhum deles precise
// conhecer o formato do outro — quem chama fornece um `pick` que traduz o item
// para os quatro campos que a ordenação realmente usa.

export const SORT_KEYS = ["manual", "alfabetico", "edicao", "data", "conclusao"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export const SORT_KEY_LABEL: Record<SortKey, string> = {
  manual: "Manual (arrastar)",
  alfabetico: "Alfabético",
  edicao: "Última edição",
  data: "Data (prazo)",
  conclusao: "Ordem de conclusão",
};

// Explica o que cada ordem significa no dropdown — "Data" sozinho não diz se
// o mais próximo sobe ou desce.
export const SORT_KEY_HINT: Record<SortKey, string> = {
  manual: "A ordem em que os cards foram arrastados",
  alfabetico: "Pelo título do card",
  edicao: "Pela última vez que o card mudou",
  data: "Pelo prazo do card",
  conclusao: "Pela data em que o card foi concluído",
};

export const SORT_DIR_LABEL: Record<SortDir, string> = {
  asc: "Ascendente",
  desc: "Descendente",
};

export type SortFields = {
  title: string;
  updatedAt: string;
  /** `due_date` em Tarefas, `next_due_date` em Rotinas. Nulo = sem prazo. */
  dueDate: string | null;
  /** `completed_at`. Nulo enquanto o card não estiver em estado terminal. */
  completedAt: string | null;
  position: number;
};

/**
 * Compara o título como ele é LIDO, não como está gravado.
 *
 * Títulos reais de produção têm espaço duplo ("KARPINSKI -  GRAVAÇÃO"). O
 * navegador colapsa isso ao renderizar, mas na string crua o espaço extra vem
 * antes de qualquer letra — o card saltava para o topo da lista por um motivo
 * que ninguém consegue ver na tela.
 */
const readableTitle = (title: string) => title.trim().replace(/\s+/g, " ");

function compareBy(key: SortKey, a: SortFields, b: SortFields): number {
  if (key === "alfabetico") return readableTitle(a.title).localeCompare(readableTitle(b.title), "pt-BR");
  if (key === "edicao") return a.updatedAt.localeCompare(b.updatedAt);
  if (key === "manual") return a.position - b.position;
  // "conclusao": nulos (card ainda aberto) nunca competem por posição — ver sortItems.
  if (key === "conclusao") return (a.completedAt ?? "").localeCompare(b.completedAt ?? "");
  // "data": nulos nunca competem por posição — ver sortItems.
  return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
}

/**
 * Ordena preservando duas invariantes que o board depende:
 *
 * 1. **Sem prazo (ou sem conclusão) vai sempre para o fim**, nas duas direções. Inverter a
 *    direção não pode empurrar os cards sem data para o topo — é a mesma regra
 *    já escrita em recurringGrouping.ts:compareByUrgency ("a routine with no
 *    date is never the most urgent thing on the board").
 * 2. **Empate mantém a ordem de entrada** (que é a do banco: position,
 *    created_at). Sem isso o board reembaralha cards equivalentes a cada
 *    re-render, e um card que você acabou de olhar pula de lugar sozinho.
 *    `Array.prototype.sort` é estável na spec desde ES2019, mas o desempate
 *    explícito por índice deixa a garantia legível e imune ao `dir` invertido
 *    abaixo — negar o comparador inteiro também inverteria os empates.
 */
export function sortItems<T>(
  items: readonly T[],
  key: SortKey,
  dir: SortDir,
  pick: (item: T) => SortFields,
): T[] {
  const decorated = items.map((item, index) => ({ item, index, fields: pick(item) }));
  const sign = dir === "asc" ? 1 : -1;

  decorated.sort((a, b) => {
    if (key === "data" || key === "conclusao") {
      // Mesma invariante nas duas: "sem valor" vai para o fim nas duas direções.
      // Em "conclusao" isso significa que o card ainda aberto nunca sobe ao
      // topo por não ter data — ele simplesmente não participa da ordem.
      const aMissing = key === "data" ? !a.fields.dueDate : !a.fields.completedAt;
      const bMissing = key === "data" ? !b.fields.dueDate : !b.fields.completedAt;
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
    }
    const diff = compareBy(key, a.fields, b.fields);
    if (diff !== 0) return diff * sign;
    return a.index - b.index;
  });

  return decorated.map((entry) => entry.item);
}
