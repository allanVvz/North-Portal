// O vocabulário de tipos e subtipos, vindo de `task_types`.
//
// Uma tabela só, auto-referenciada: as raízes canônicas são Tarefa, Entrega,
// Plano e Checkpoint. Tarefa possui subtipos executáveis; Entrega possui as
// variantes Criativo/Automação. A sequência pertence à versão do workflow.
//
// Divisão de responsabilidade com lib/taskCatalog.ts: esta tabela é a fonte do
// VOCABULÁRIO (o que existe, em que ordem, com que comportamento) E do ícone/
// tom de um tipo de TOPO (colunas `icon`/`tone`, 2026-09-13) — o catálogo em
// código (`TASK_KINDS`) continua sendo o dono dos 5 tipos embutidos e do
// PROGRESSO (workflow, percentuais), mas passa a consultar aqui como segundo
// critério (lib/taskCatalog/liveKinds.ts) para um tipo criado só pela tela.
// Isso evita o custo que fazia essa unificação ficar de fora antes: virar
// assíncrono o Kanban, o Calendário, a Performance e o portal inteiro — o
// catálogo em código continua síncrono, só ganha um cache alimentado uma vez.

import type { AdminClient } from "@/lib/automations/taskAccess";
import { HttpError } from "@/lib/validation";

export type TaskBehavior = "entrega" | "plano" | "simples";

/** Um subtipo físico, filho direto da raiz `Tarefa`. */
export type TaskSubtypeDef = {
  /** FK to the executable Task subtype. */
  task_type_id?: string;
  /** FK to the immutable step in a persisted workflow version. */
  workflow_step_id?: string;
  key: string;
  label: string;
  order_index: number;
  lead_days: number;
  progress_weight: number;
  default_assignee: string | null;
  client_visible: boolean;
  creation_trigger?: "delivery_created" | "ads_report_approved" | "feedback_approved" | "previous_step_approved";
};

/** Uma etapa declarada numa versão imutável de workflow.
 *
 * Não é subtipo da Entrega: referencia um `TaskSubtypeDef` por FK e acrescenta
 * as regras que pertencem exclusivamente à versão (ordem, gatilho e prazo).
 */
export type WorkflowStepDef = TaskSubtypeDef & {
  task_type_id: string;
  workflow_step_id: string;
  creation_trigger: NonNullable<TaskSubtypeDef["creation_trigger"]>;
};

/** As 5 tonalidades que já existem no design system (app/globals.css) — sem
 * token de cor novo. `null` num tipo de topo é o fallback genérico
 * (lib/taskCatalog.ts). Etapas não têm tom próprio, herdam o do tipo. */
export type TaskKindTone = "green" | "gold" | "blue" | "purple" | "neutral";

export type TaskTypeDef = {
  id: string;
  key: string;
  label: string;
  order_index: number;
  behavior: TaskBehavior;
  creatable: boolean;
  active: boolean;
  /** Só relevante em linha de topo — `null` numa etapa. */
  icon: string | null;
  tone: TaskKindTone | null;
  show_in_performance: boolean;
  workflow_version_id?: string;
  /** Filhos físicos no catálogo. Em Entrega é sempre vazio. */
  subtypes: TaskSubtypeDef[];
  /** Etapas da versão publicada. Só existe em variantes de Entrega. */
  workflowSteps: WorkflowStepDef[];
};

/** Só a capacidade de ler tabelas. O vocabulário é lido tanto pelo client de
 * serviço (motor da cascata, sem sessão) quanto pelo client da requisição
 * (telas de admin, onde a RLS é a guarda real). */
export type TypeReader = Pick<AdminClient, "from">;

const COLUMNS =
  "id,parent_id,key,label,order_index,behavior,creatable,active,lead_days,progress_weight,default_assignee,client_visible,icon,tone,show_in_performance";

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
  icon: string | null;
  tone: TaskKindTone | null;
  show_in_performance: boolean;
};

/** Uma Entrega não possui mais linhas-filhas de vocabulário. Esta associação
 * declara quais subtipos de Tarefa podem ocupar seus slots, e em qual ordem. */
type WorkflowStepRow = {
  delivery_type_id: string;
  workflow_version_id: string;
  task_subtype_id: string;
  workflow_step_id: string;
  order_index: number;
  label: string;
  lead_days: number;
  progress_weight: number;
  default_assignee: string | null;
  client_visible: boolean;
  creation_trigger: TaskSubtypeDef["creation_trigger"];
};

/** Monta a árvore a partir das linhas cruas. Separado da consulta porque o
 * editor de fluxos precisa da MESMA montagem sobre um conjunto maior de linhas
 * (as inativas inclusas) — duas montagens divergentes seriam duas verdades
 * sobre o que é a ordem de uma cascata. */
function subtypeRows(rows: Row[]): Map<string, TaskTypeEditorSubtype[]> {
  const subtypesByParent = new Map<string, TaskTypeEditorSubtype[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = subtypesByParent.get(row.parent_id) ?? [];
    list.push({
      id: row.id,
      task_type_id: row.id,
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
  for (const list of subtypesByParent.values()) {
    list.sort((a, b) => a.order_index - b.order_index || a.key.localeCompare(b.key));
  }
  return subtypesByParent;
}

function editorNode(row: Row, key: string, subtypes: TaskTypeEditorSubtype[]): TaskTypeEditorNode {
  return {
    id: row.id,
    key,
    label: row.label,
    order_index: row.order_index,
    behavior: row.behavior,
    creatable: row.creatable,
    active: row.active,
    icon: row.icon,
    tone: row.tone,
    show_in_performance: row.show_in_performance,
    subtypes,
    workflowSteps: [],
  };
}

function groupRows(rows: Row[]): TaskTypeEditorNode[] {
  const subtypesByParent = subtypeRows(rows);
  const deliveryRoot = rows.find((row) => !row.parent_id && row.key === "entrega");

  if (deliveryRoot) {
    const structuralKeyProjection: Record<string, string> = {
      tarefa: "operacional",
      plano: "plano_acao",
      checkpoint: "checkpoint_comercial",
    };
    const nodes: TaskTypeEditorNode[] = [];
    for (const row of rows) {
      if (!row.parent_id && row.id !== deliveryRoot.id) {
        nodes.push(editorNode(row, structuralKeyProjection[row.key] ?? row.key, subtypesByParent.get(row.id) ?? []));
      }
      if (row.parent_id === deliveryRoot.id) {
        nodes.push(editorNode(row, row.key, []));
      }
    }
    return nodes.sort((a, b) => a.order_index - b.order_index || a.key.localeCompare(b.key));
  }

  return rows
    .filter((row) => !row.parent_id)
    .map((row) => editorNode(row, row.key, subtypesByParent.get(row.id) ?? []))
    .sort((a, b) => a.order_index - b.order_index || a.key.localeCompare(b.key));
}

function decorateWorkflowSteps<T extends TaskTypeEditorNode>(
  types: T[],
  mappings: readonly WorkflowStepRow[],
): T[] {
  const subtypeById = new Map<string, TaskTypeEditorSubtype>();
  for (const type of types) for (const subtype of type.subtypes) subtypeById.set(subtype.id, subtype);
  const mappingsByDelivery = new Map<string, WorkflowStepRow[]>();
  for (const mapping of mappings) {
    const list = mappingsByDelivery.get(mapping.delivery_type_id) ?? [];
    list.push(mapping);
    mappingsByDelivery.set(mapping.delivery_type_id, list);
  }
  return types.map((type) => {
    if (type.behavior !== "entrega") return type;
    const workflowSteps = (mappingsByDelivery.get(type.id) ?? [])
      .slice()
      .sort((a, b) => a.order_index - b.order_index || a.task_subtype_id.localeCompare(b.task_subtype_id))
      .map((mapping) => {
        const subtype = subtypeById.get(mapping.task_subtype_id);
        return subtype ? {
          ...subtype,
          task_type_id: mapping.task_subtype_id,
          workflow_step_id: mapping.workflow_step_id,
          label: mapping.label,
          order_index: mapping.order_index,
          lead_days: mapping.lead_days,
          progress_weight: mapping.progress_weight,
          // A versão publicada é imutável ("Criativo v1" não tem responsável em
          // nenhuma etapa). Sem responsável no passo da versão, vale o do tipo
          // de etapa — que a tela Etapas edita (25/09: Roteiro = Luiza,
          // Captação = Alisson). Sem nenhum dos dois, quem cria cai no North Ai.
          default_assignee: mapping.default_assignee || subtype.default_assignee || null,
          client_visible: mapping.client_visible,
          creation_trigger: mapping.creation_trigger,
        } : null;
      })
      .filter(Boolean) as WorkflowStepDef[];
    return {
      ...type,
      workflow_version_id: (mappingsByDelivery.get(type.id) ?? [])[0]?.workflow_version_id,
      workflowSteps,
    } as T;
  });
}

async function readWorkflowStepMappings(db: TypeReader): Promise<WorkflowStepRow[]> {
  const { data: versions, error: versionError } = await db
    .from("workflow_versions")
    .select("id,delivery_type_id")
    .eq("status", "published");
  if (versionError) throw versionError;
  const versionRows = (versions ?? []) as { id: string; delivery_type_id: string }[];
  if (!versionRows.length) return [];
  const deliveryByVersion = new Map(versionRows.map((version) => [version.id, version.delivery_type_id]));
  const { data: steps, error: stepError } = await db
    .from("workflow_version_steps")
    .select("id,workflow_version_id,task_type_id,label,order_index,lead_days,progress_weight,default_assignee,client_visible,creation_trigger")
    .in("workflow_version_id", versionRows.map((version) => version.id));
  if (stepError) throw stepError;
  return ((steps ?? []) as Array<{
    id: string;
    workflow_version_id: string;
    task_type_id: string;
    label: string;
    order_index: number;
    lead_days: number;
    progress_weight: number;
    default_assignee: string | null;
    client_visible: boolean;
    creation_trigger: TaskSubtypeDef["creation_trigger"];
  }>).map((step) => ({
    delivery_type_id: deliveryByVersion.get(step.workflow_version_id)!,
    workflow_version_id: step.workflow_version_id,
    task_subtype_id: step.task_type_id,
    workflow_step_id: step.id,
    order_index: step.order_index,
    label: step.label,
    lead_days: step.lead_days,
    progress_weight: Number(step.progress_weight) || 1,
    default_assignee: step.default_assignee,
    client_visible: step.client_visible,
    creation_trigger: step.creation_trigger,
  }));
}

/** Todo o vocabulário em UMA consulta — tipos e subtipos moram na mesma
 * tabela, então buscar os dois é uma leitura só. */
export async function listTaskTypes(db: TypeReader): Promise<TaskTypeDef[]> {
  const [typesResult, mappings] = await Promise.all([
    db.from("task_types").select(COLUMNS).eq("active", true),
    readWorkflowStepMappings(db),
  ]);
  const { data, error } = typesResult;
  if (error) throw error;
  // Etapa é uma especialização de Tarefa comum. A associação abaixo conserva
  // a outra metade do modelo: uma Entrega escolhe uma sequência, não absorve
  // todo subtipo disponível de Tarefa.
  return decorateWorkflowSteps(groupRows((data ?? []) as Row[]), mappings);
}

export function findType(types: readonly TaskTypeDef[], key: string): TaskTypeDef | null {
  return types.find((t) => t.key === key) ?? null;
}

export function isDeliveryType(type: TaskTypeDef | null): boolean {
  return type?.behavior === "entrega";
}

export function stepIndexOf(type: TaskTypeDef, subtype: string | null): number {
  if (!subtype) return -1;
  return type.workflowSteps.findIndex((s) => s.key === subtype);
}

/** A etapa seguinte a `subtype` dentro deste tipo, ou null se for a última. */
export function nextWorkflowStepAfter(type: TaskTypeDef, subtype: string | null): WorkflowStepDef | null {
  const index = stepIndexOf(type, subtype);
  if (index < 0) return null;
  return type.workflowSteps[index + 1] ?? null;
}

/** Peso total do molde — o denominador do progresso de uma entrega. Etapas que
 * ainda não nasceram contam aqui: é isso que impede uma entrega com só o
 * roteiro pronto de marcar 100%. */
export function typeTotalWeight(type: TaskTypeDef): number {
  return type.workflowSteps.reduce((sum, s) => sum + (s.progress_weight || 1), 0);
}

/** Um molde que produziria uma cascata quebrada. */
export function deliveryTypeProblem(type: TaskTypeDef): string | null {
  if (type.behavior !== "entrega") return null;
  if (type.workflowSteps.length === 0) return `O tipo "${type.label}" precisa de pelo menos uma etapa.`;
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
// `createTaskType` (abaixo) cria um TIPO de topo novo — antes disso era
// deliberadamente fora de escopo, porque o tipo existia em dois lugares
// (`task_types` e a união `TaskKind` em `lib/taskCatalog.ts`) e uma linha só
// no banco renderizava com o visual de fallback ("Tarefa", cinza) em todo
// card. Com `icon`/`tone` agora colunas de `task_types` e `kindDef` lendo o
// cache ao vivo (lib/taskCatalog/liveKinds.ts) como segundo critério, um tipo
// criado só pela tela já nasce com identidade visual própria — sem mudança de
// código. `createTaskSubtype`/`updateTaskType`/`deleteTaskType` continuam
// sendo o CRUD das etapas de qualquer tipo, novo ou embutido.

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
 * a versão publicada deixaria de encontrar a etapa e a corrente pararia em
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
  const [{ data, error }, mappings] = await Promise.all([
    db.from("task_types").select(COLUMNS),
    readWorkflowStepMappings(db),
  ]);
  if (error) throw error;

  return {
    types: decorateWorkflowSteps(groupRows((data ?? []) as Row[]), mappings),
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

/** O insert cru de uma etapa, sem checar unicidade de key — quem chama já
 * resolveu isso contra a fonte certa de "etapas irmãs já existentes": linhas
 * já no banco para `createTaskSubtype`, o array ainda sendo montado em
 * memória para `createTaskType`. Extraído para as duas nunca terem duas
 * cópias divergentes da mesma lógica de insert. */
async function insertSubtypeRow(
  db: TypeWriter,
  parentId: string,
  orderIndex: number,
  key: string,
  input: SubtypeInput,
): Promise<TaskTypeEditorSubtype> {
  const { data, error } = await db
    .from("task_types")
    .insert({
      parent_id: parentId,
      key,
      label: input.label.trim(),
      order_index: orderIndex,
      // Default 1, não 0 (2026-09-14) — cada card ajusta a própria data na
      // hora; o molde só evita uma etapa nascer com prazo no mesmo dia.
      lead_days: input.lead_days ?? 1,
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
  if (type.behavior === "entrega") {
    throw new HttpError(400, "Etapas sao subtipos de Tarefa; uma Entrega apenas escolhe quais delas compoem seu fluxo.");
  }

  const key = slugifyTypeKey(input.key ?? input.label);
  if (!key) throw new HttpError(400, "O nome da etapa precisa ter ao menos uma letra ou numero.");
  if (type.subtypes.some((s) => s.key === key)) {
    throw new HttpError(409, `O tipo "${type.label}" ja tem uma etapa com a chave "${key}".`);
  }

  return insertSubtypeRow(db, type.id, nextOrderIndex(type.subtypes), key, input);
}

export type TaskTypeCreateInput = {
  label: string;
  key?: string;
  behavior: TaskBehavior;
  icon: string;
  tone: TaskKindTone;
  show_in_performance: boolean;
  steps: SubtypeInput[];
};

async function insertWorkflowStep(
  db: TypeWriter,
  workflowVersionId: string,
  taskSubtypeId: string,
  stepKey: string,
  input: SubtypeInput,
  orderIndex: number,
): Promise<void> {
  const { error } = await db
    .from("workflow_version_steps")
    .insert({
      workflow_version_id: workflowVersionId,
      task_type_id: taskSubtypeId,
      step_key: stepKey,
      label: input.label.trim(),
      order_index: orderIndex,
      lead_days: input.lead_days,
      progress_weight: input.progress_weight,
      default_assignee: input.default_assignee,
      client_visible: input.client_visible,
      creation_trigger: orderIndex === 10 ? "delivery_created" : "previous_step_approved",
    });
  if (error) throw error;
}

/** Cria um TIPO de topo novo — a peça que faltava para "criar um fluxo em
 * cascata pela tela" funcionar de ponta a ponta. Ícone/tom vêm no input (uma
 * paleta fixa escolhida na tela, lib/taskCatalog.ts lê isso via o cache ao
 * vivo em vez de precisar de uma entrada em código para cada tipo novo).
 *
 * Uma Entrega nova cria apenas sua raiz e os elos para subtipos de Tarefa. Se
 * uma etapa ainda não existe no vocabulário comum, ela é criada ali — nunca
 * como filha da Entrega. A associação é a ordem específica do fluxo.
 */
export async function createTaskType(db: TypeWriter, input: TaskTypeCreateInput): Promise<TaskTypeEditorNode> {
  if (!input.steps.length) throw new HttpError(400, "Um fluxo em cascata precisa de pelo menos uma etapa.");

  const key = input.key ?? slugifyTypeKey(input.label);
  if (!key) throw new HttpError(400, "O nome do tipo precisa ter ao menos uma letra ou numero.");
  const [{ types: existingTypes }, { data: catalogData, error: catalogError }] = await Promise.all([
    listTaskTypesForEditor(db),
    db.from("task_types").select(COLUMNS),
  ]);
  if (catalogError) throw catalogError;
  const catalogRows = (catalogData ?? []) as Row[];
  const deliveryRoot = catalogRows.find((row) => !row.parent_id && row.key === "entrega");
  if (existingTypes.some((t) => t.key === key)) {
    throw new HttpError(409, `Já existe um tipo com a chave "${key}".`);
  }

  // Resolve as keys das etapas e barra colisão ENTRE ELAS antes de inserir
  // qualquer coisa — falha rápido no erro de digitação comum (duas etapas com
  // o mesmo nome), em vez de deixar a segunda pisar na primeira no banco.
  const stepKeys: string[] = [];
  for (const step of input.steps) {
    const stepKey = slugifyTypeKey(step.key ?? step.label);
    if (!stepKey) throw new HttpError(400, "O nome da etapa precisa ter ao menos uma letra ou numero.");
    if (stepKeys.includes(stepKey)) {
      throw new HttpError(409, `Duas etapas não podem ter a mesma chave ("${stepKey}").`);
    }
    stepKeys.push(stepKey);
  }

  const deliverySiblings = deliveryRoot
    ? catalogRows.filter((row) => row.parent_id === deliveryRoot.id)
    : existingTypes;
  const { data, error } = await db
    .from("task_types")
    .insert({
      parent_id: deliveryRoot?.id ?? null,
      key,
      label: input.label.trim(),
      order_index: nextOrderIndex(deliverySiblings),
      behavior: input.behavior,
      creatable: true,
      icon: input.icon,
      tone: input.tone,
      show_in_performance: input.show_in_performance,
    })
    .select(COLUMNS)
    .limit(1);
  if (error) throw error;
  const rootRow = (data ?? [])[0] as Row | undefined;
  if (!rootRow) throw new HttpError(503, "Não foi possível criar o tipo.");

  const createdCommonSubtypeIds: string[] = [];
  let workflowVersionId: string | null = null;
  try {
    const subtypes: TaskTypeEditorSubtype[] = [];
    if (input.behavior === "entrega") {
      const { data: versionRows, error: versionError } = await db
        .from("workflow_versions")
        .insert({ delivery_type_id: rootRow.id, version: 1, status: "draft", label: `${rootRow.label} v1`, published_at: null })
        .select("id")
        .limit(1);
      if (versionError) throw versionError;
      workflowVersionId = (versionRows?.[0] as { id?: string } | undefined)?.id ?? null;
      if (!workflowVersionId) throw new HttpError(503, "Não foi possível versionar o fluxo.");
      const commonType = existingTypes.find((type) => type.key === "operacional");
      if (!commonType) throw new HttpError(503, "O tipo Tarefa nao esta configurado.");
      const commonByKey = new Map(commonType.subtypes.map((subtype) => [subtype.key, subtype]));
      for (let i = 0; i < input.steps.length; i++) {
        const existing = commonByKey.get(stepKeys[i]);
        const subtype = existing ?? await insertSubtypeRow(
          db,
          commonType.id,
          nextOrderIndex([...commonByKey.values()]),
          stepKeys[i],
          input.steps[i],
        );
        if (!existing) createdCommonSubtypeIds.push(subtype.id);
        commonByKey.set(subtype.key, subtype);
        await insertWorkflowStep(db, workflowVersionId, subtype.id, subtype.key, input.steps[i], (i + 1) * 10);
        subtypes.push(subtype);
      }
      const { error: publishError } = await db
        .from("workflow_versions")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", workflowVersionId);
      if (publishError) throw publishError;
    } else {
      for (let i = 0; i < input.steps.length; i++) {
        subtypes.push(await insertSubtypeRow(db, rootRow.id, (i + 1) * 10, stepKeys[i], input.steps[i]));
      }
    }
    return {
      id: rootRow.id,
      key: rootRow.key,
      label: rootRow.label,
      order_index: rootRow.order_index,
      behavior: rootRow.behavior,
      creatable: rootRow.creatable,
      active: rootRow.active,
      icon: rootRow.icon,
      tone: rootRow.tone,
      show_in_performance: rootRow.show_in_performance,
      subtypes: input.behavior === "entrega" ? [] : subtypes,
      workflowSteps: input.behavior === "entrega"
        ? subtypes.map((step, index) => ({
            ...step,
            task_type_id: step.task_type_id ?? step.id,
            workflow_step_id: "",
            creation_trigger: index === 0 ? "delivery_created" : "previous_step_approved",
          }))
        : [],
    };
  } catch (stepError) {
    // Desfaz a raiz e seus elos. Etapas comuns já podem ser usadas por outros
    // fluxos, portanto somente as que esta tentativa acabou de criar saem.
    if (workflowVersionId) await db.from("workflow_versions").delete().eq("id", workflowVersionId);
    await db.from("task_types").delete().eq("id", rootRow.id);
    for (const subtypeId of createdCommonSubtypeIds) {
      await db.from("task_types").delete().eq("id", subtypeId);
    }
    throw stepError;
  }
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
    const problem = deactivationProblem(target.label, usage[key]);
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
    deletionProblem(subtype.label, usage[usageKey(type.key, subtype.key)]);
  if (problem) throw new HttpError(409, problem);

  const { error } = await db.from("task_types").delete().eq("id", id);
  if (error) throw error;
}
