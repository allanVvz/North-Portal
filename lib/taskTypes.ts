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

/** Todo o vocabulário em UMA consulta — tipos e subtipos moram na mesma
 * tabela, então buscar os dois é uma leitura só. */
export async function listTaskTypes(db: TypeReader): Promise<TaskTypeDef[]> {
  const { data, error } = await db.from("task_types").select(COLUMNS).eq("active", true);
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  const subtypesByParent = new Map<string, TaskSubtypeDef[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = subtypesByParent.get(row.parent_id) ?? [];
    list.push({
      key: row.key,
      label: row.label,
      order_index: row.order_index,
      lead_days: row.lead_days,
      progress_weight: Number(row.progress_weight) || 1,
      default_assignee: row.default_assignee,
      client_visible: row.client_visible,
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
