// O vocabulário de tipos e subtipos, vindo de `task_types`.
//
// Uma tabela só, auto-referenciada: linha sem pai é um Tipo, linha com pai é um
// Subtipo. Um fluxo É um tipo (behavior='entrega') e suas etapas SÃO os
// subtipos dele, na ordem de order_index — não existe uma segunda lista de
// "etapas" para manter em sincronia com a de subtipos.
//
// Divisão de responsabilidade com lib/taskCatalog.ts: esta tabela é a fonte do
// VOCABULÁRIO (o que existe, em que ordem, com que comportamento); o catálogo
// em código segue sendo a fonte do VISUAL (tom, ícone) e do PROGRESSO
// (workflow, percentuais). Os campos do catálogo são lidos de forma síncrona em
// dezenas de componentes de tela; trazê-los para o banco obrigaria a tornar
// assíncrono o Kanban, o Calendário, a Performance e o portal inteiro.

import type { AdminClient } from "@/lib/automations/taskAccess";
import { HttpError } from "@/lib/validation";

export type TaskBehavior = "entrega" | "plano" | "simples";

export type TaskSubtypeDef = {
  key: string;
  label: string;
  order_index: number;
  lead_days: number;
  progress_weight: number;
  default_assignee: string | null;
  client_visible: boolean;
};

export type TaskTypeDef = {
  id: string;
  key: string;
  label: string;
  order_index: number;
  behavior: TaskBehavior;
  creatable: boolean;
  active: boolean;
  subtypes: TaskSubtypeDef[];
};

/** Só a capacidade de ler tabelas. O vocabulário é lido tanto pelo client de
 * serviço (motor da cascata, sem sessão) quanto pelo client da requisição
 * (telas de admin, onde a RLS é a guarda real). */
export type TypeReader = Pick<AdminClient, "from">;

const COLUMNS =
  "id,parent_id,key,label,order_index,behavior,creatable,active,lead_days,progress_weight,default_assignee,client_visible";

type Row = {
  id: string;
  parent_id: string | null;
  key: string;
  label: string;
  order_index: number;
  behavior: TaskBehavior;
  creatable: boolean;
  active: boolean;
  lead_days: number;
  progress_weight: number;
  default_assignee: string | null;
  client_visible: boolean;
};

/** Monta a árvore a partir das linhas cruas. Separado da consulta porque o
 * editor de fluxos precisa da MESMA montagem sobre um conjunto maior de linhas
 * (as inativas inclusas) — duas montagens divergentes seriam duas verdades
 * sobre o que é a ordem de uma cascata. */
function groupRows(rows: Row[]): TaskTypeEditorNode[] {
  const subtypesByParent = new Map<string, TaskTypeEditorSubtype[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = subtypesByParent.get(row.parent_id) ?? [];
    list.push({
      id: row.id,
      key: row.key,
      label: row.label,
      order_index: row.order_index,
      lead_days: row.lead_days,
      progress_weight: Number(row.progress_weight) || 1,
      default_assignee: row.default_assignee,
      client_visible: row.client_visible,
      active: row.active,
    });
    subtypesByParent.set(row.parent_id, list);
  }

  return rows
    .filter((row) => !row.parent_id)
    .map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      order_index: row.order_index,
      behavior: row.behavior,
      creatable: row.creatable,
      active: row.active,
      // A ordem É a cascata. Empate cai na key para a sequência nunca depender
      // da ordem em que o Postgres devolveu as linhas.
      subtypes: (subtypesByParent.get(row.id) ?? []).sort(
        (a, b) => a.order_index - b.order_index || a.key.localeCompare(b.key),
      ),
    }))
    .sort((a, b) => a.order_index - b.order_index || a.key.localeCompare(b.key));
}

/** Todo o vocabulário em UMA consulta — tipos e subtipos moram na mesma
 * tabela, então buscar os dois é uma leitura só. */
export async function listTaskTypes(db: TypeReader): Promise<TaskTypeDef[]> {
  const { data, error } = await db.from("task_types").select(COLUMNS).eq("active", true);
  if (error) throw error;
  return groupRows((data ?? []) as Row[]);
}

export function findType(types: readonly TaskTypeDef[], key: string): TaskTypeDef | null {
  return types.find((t) => t.key === key) ?? null;
}

export function isDeliveryType(type: TaskTypeDef | null): boolean {
  return type?.behavior === "entrega";
}

export function stepIndexOf(type: TaskTypeDef, subtype: string | null): number {
  if (!subtype) return -1;
  return type.subtypes.findIndex((s) => s.key === subtype);
}

/** A etapa seguinte a `subtype` dentro deste tipo, ou null se for a última. */
export function nextSubtypeAfter(type: TaskTypeDef, subtype: string | null): TaskSubtypeDef | null {
  const index = stepIndexOf(type, subtype);
  if (index < 0) return null;
  return type.subtypes[index + 1] ?? null;
}

/** Peso total do molde — o denominador do progresso de uma entrega. Etapas que
 * ainda não nasceram contam aqui: é isso que impede uma entrega com só o
 * roteiro pronto de marcar 100%. */
export function typeTotalWeight(type: TaskTypeDef): number {
  return type.subtypes.reduce((sum, s) => sum + (s.progress_weight || 1), 0);
}

/** Um molde que produziria uma cascata quebrada. */
export function deliveryTypeProblem(type: TaskTypeDef): string | null {
  if (type.behavior !== "entrega") return null;
  if (type.subtypes.length === 0) return `O tipo "${type.label}" precisa de pelo menos uma etapa.`;
  return null;
}

// ---------------------------------------------------------------------------
// Editor de fluxos — Configurações › Tipos e fluxos
// ---------------------------------------------------------------------------
//
// Até aqui o molde de uma Entrega (quais etapas, em que ordem, com que prazo,
// peso e visibilidade) só mudava por SQL. O que segue é a camada de escrita
// dessa mesma tabela, com as travas que o SQL cru não tinha.
//
// O que este editor NÃO faz, deliberadamente: criar um TIPO de topo novo. O
// tipo existe em dois lugares — `task_types` (vocabulário) e `lib/taskCatalog.ts`
// (tom, ícone, blurb, e a união `TaskKind`). Uma linha criada só no banco
// renderiza com o visual de fallback ("Tarefa", cinza) em todo card, então
// tipo novo continua sendo mudança de código; aqui se editam os tipos que
// existem e, com CRUD completo, as etapas de cada um.

export type TaskTypeEditorSubtype = TaskSubtypeDef & { id: string; active: boolean };
export type TaskTypeEditorNode = Omit<TaskTypeDef, "subtypes"> & { subtypes: TaskTypeEditorSubtype[] };

/** Quantos cards usam uma linha do vocabulário. `total` inclui os terminais
 * (histórico); `open` são os que ainda podem se mexer — é ele que decide se
 * desativar quebraria algo em andamento. */
export type VocabUsage = { total: number; open: number };
export type VocabUsageMap = Record<string, VocabUsage>;

/** `concluido` não está mais em TASK_STATUSES (o CHECK o bloqueia), mas linhas
 * antigas podem carregá-lo; contá-lo como terminal evita que um card morto
 * segure a desativação de uma etapa. */
const TERMINAL_STATUSES = new Set(["aprovado", "concluido"]);

/** A key de um subtipo repete entre pais (`publicacao` existe sob dois tipos),
 * então uso de subtipo só é endereçável com o pai junto. */
export function usageKey(typeKey: string, subtypeKey?: string | null): string {
  return subtypeKey ? `${typeKey}/${subtypeKey}` : typeKey;
}

export function tallyVocabUsage(
  rows: readonly { kind: string; subtype: string | null; status: string }[],
): VocabUsageMap {
  const map: VocabUsageMap = {};
  const bump = (key: string, open: boolean) => {
    const entry = map[key] ?? (map[key] = { total: 0, open: 0 });
    entry.total += 1;
    if (open) entry.open += 1;
  };
  for (const row of rows) {
    const open = !TERMINAL_STATUSES.has(row.status);
    bump(usageKey(row.kind), open);
    if (row.subtype) bump(usageKey(row.kind, row.subtype), open);
  }
  return map;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Desativar tira a linha de `listTaskTypes` — e é dela que o motor da cascata
 * lê a etapa seguinte. Com um card em aberto no meio do caminho,
 * `nextSubtypeAfter` deixaria de encontrar a etapa e a corrente pararia em
 * silêncio, sem erro nenhum. Por isso a trava olha `open`, não `total`. */
export function deactivationProblem(label: string, usage: VocabUsage | undefined): string | null {
  const open = usage?.open ?? 0;
  if (open === 0) return null;
  return `"${label}" está em ${plural(open, "card em aberto", "cards em aberto")}. Conclua ou reclassifique antes de desativar.`;
}

/** Excluir é irreversível e deixaria cards apontando para um vocabulário que
 * não existe mais (o trigger `tasks_valida_vocabulario` só olha na escrita, não
 * impede a linha de sumir por baixo). Histórico manda desativar. */
export function deletionProblem(label: string, usage: VocabUsage | undefined): string | null {
  const total = usage?.total ?? 0;
  if (total === 0) return null;
  return `"${label}" já foi usada em ${plural(total, "card", "cards")}. Desative em vez de excluir — assim o histórico continua legível.`;
}

/** Uma Entrega sem etapa ativa é um molde que não cascateia: o card-pai nasce
 * e nada é materializado. Mesma regra de `deliveryTypeProblem`, aplicada antes
 * do estrago. */
export function lastStepProblem(type: TaskTypeEditorNode, subtypeId: string): string | null {
  if (type.behavior !== "entrega") return null;
  const remaining = type.subtypes.filter((s) => s.active && s.id !== subtypeId);
  if (remaining.length > 0) return null;
  return `"${type.label}" é uma Entrega e precisa de pelo menos uma etapa ativa.`;
}

/** Deriva a key a partir do rótulo: minúscula, sem acento, `_` no lugar do
 * resto. A key é a identidade da linha para `tasks.subtype` e nunca muda depois
 * — renomear o rótulo é seguro, renomear a key órfanaria todo card existente. */
export function slugifyTypeKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Próxima posição no fim da fila, com folga de 10 para caber uma inserção
 * manual entre duas etapas sem renumerar tudo. */
export function nextOrderIndex(siblings: readonly { order_index: number }[]): number {
  return siblings.length ? Math.max(...siblings.map((s) => s.order_index)) + 10 : 10;
}

export type TypeWriter = TypeReader;

/** O vocabulário INTEIRO (inativos inclusos) mais quantos cards usam cada
 * linha — é o que a tela de edição precisa ver, e o que as travas consultam. */
export async function listTaskTypesForEditor(
  db: TypeReader,
): Promise<{ types: TaskTypeEditorNode[]; usage: VocabUsageMap }> {
  const { data, error } = await db.from("task_types").select(COLUMNS);
  if (error) throw error;

  return {
    types: groupRows((data ?? []) as Row[]),
    usage: tallyVocabUsage(await readClassifications(db)),
  };
}

/** Duas colunas de todo card, contadas em memória: uma leitura, em vez de um
 * count por linha do vocabulário (~23 idas ao banco só para desenhar uma tela
 * de configuração).
 *
 * Paginado porque o PostgREST corta a resposta no `max-rows` do servidor (1000
 * por padrão) SEM avisar — e aqui uma contagem truncada não é um número feio na
 * tela, é a trava de exclusão liberando uma etapa que está em uso. Ordenado por
 * `id` para que as páginas não se sobreponham. */
async function readClassifications(db: TypeReader) {
  const PAGE = 1000;
  const rows: { kind: string; subtype: string | null; status: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("tasks")
      .select("kind,subtype,status")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as typeof rows;
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** Carrega a árvore + o uso e localiza uma linha por id. Toda escrita passa
 * por aqui: as travas precisam do TIPO inteiro (para saber se sobra etapa) e
 * do uso (para saber se há card no caminho), não só da linha alvo. */
async function locate(db: TypeReader, id: string) {
  const { types, usage } = await listTaskTypesForEditor(db);
  for (const type of types) {
    if (type.id === id) return { types, usage, type, subtype: null as TaskTypeEditorSubtype | null };
    const subtype = type.subtypes.find((s) => s.id === id);
    if (subtype) return { types, usage, type, subtype };
  }
  throw new HttpError(404, "Tipo ou etapa nao encontrado.");
}

export type SubtypeInput = {
  label: string;
  key?: string;
  lead_days?: number;
  progress_weight?: number;
  default_assignee?: string | null;
  client_visible?: boolean;
};

/** Cria uma etapa no fim da fila do tipo. Só tipo de topo aceita filho —
 * o vocabulário tem dois níveis, e um subtipo de subtipo não teria como ser
 * validado pelo trigger (que procura o filho direto do `kind`). */
export async function createTaskSubtype(
  db: TypeWriter,
  parentId: string,
  input: SubtypeInput,
): Promise<TaskTypeEditorSubtype> {
  const { type, subtype } = await locate(db, parentId);
  if (subtype) throw new HttpError(400, "Uma etapa nao pode ter etapas dentro dela.");

  const key = slugifyTypeKey(input.key ?? input.label);
  if (!key) throw new HttpError(400, "O nome da etapa precisa ter ao menos uma letra ou numero.");
  if (type.subtypes.some((s) => s.key === key)) {
    throw new HttpError(409, `O tipo "${type.label}" ja tem uma etapa com a chave "${key}".`);
  }

  const { data, error } = await db
    .from("task_types")
    .insert({
      parent_id: type.id,
      key,
      label: input.label.trim(),
      order_index: nextOrderIndex(type.subtypes),
      lead_days: input.lead_days ?? 0,
      progress_weight: input.progress_weight ?? 1,
      default_assignee: input.default_assignee ?? null,
      client_visible: input.client_visible ?? false,
    })
    .select(COLUMNS)
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as Row | undefined;
  if (!row) throw new HttpError(503, "Nao foi possivel criar a etapa.");
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    order_index: row.order_index,
    lead_days: row.lead_days,
    progress_weight: Number(row.progress_weight) || 1,
    default_assignee: row.default_assignee,
    client_visible: row.client_visible,
    active: row.active,
  };
}

export type TypePatch = Partial<{
  label: string;
  order_index: number;
  lead_days: number;
  progress_weight: number;
  default_assignee: string | null;
  client_visible: boolean;
  active: boolean;
  creatable: boolean;
}>;

/** `key` não está no patch de propósito: ela é a identidade que `tasks.kind` /
 * `tasks.subtype` guardam em texto. Trocar a key renomearia o vocabulário sem
 * renomear os cards, e o trigger `tasks_valida_vocabulario` passaria a rejeitar
 * todo UPDATE deles. Rótulo se renomeia à vontade; key, não. */
export async function updateTaskType(db: TypeWriter, id: string, patch: TypePatch): Promise<void> {
  const { usage, type, subtype } = await locate(db, id);
  const target = subtype ?? type;

  if (patch.active === false && target.active) {
    const key = subtype ? usageKey(type.key, subtype.key) : usageKey(type.key);
    const problem = deactivationProblem(target.label, usage[key]) ?? (subtype ? lastStepProblem(type, subtype.id) : null);
    if (problem) throw new HttpError(409, problem);
  }

  const { error } = await db.from("task_types").update(patch).eq("id", id);
  if (error) throw error;
}

/** Excluir vale só para etapa, e só enquanto ninguém a usou. Tipo de topo não
 * se exclui por aqui: ele tem contraparte em `lib/taskCatalog.ts`, e apagar a
 * linha deixaria o catálogo em código apontando para um vocabulário vazio. */
export async function deleteTaskType(db: TypeWriter, id: string): Promise<void> {
  const { usage, type, subtype } = await locate(db, id);
  if (!subtype) {
    throw new HttpError(400, "Tipos nao sao excluidos por aqui — desative o tipo.");
  }

  const problem =
    deletionProblem(subtype.label, usage[usageKey(type.key, subtype.key)]) ?? lastStepProblem(type, subtype.id);
  if (problem) throw new HttpError(409, problem);

  const { error } = await db.from("task_types").delete().eq("id", id);
  if (error) throw error;
}
