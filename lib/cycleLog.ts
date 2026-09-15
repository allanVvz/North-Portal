// Os "checks" de uma tarefa recorrente (ATA 14/09).
//
// A reunião pediu que, numa demanda recorrente, cada entrega concluída fique
// listada no próprio card com a data do check e quem deu o check. "Concluir
// ciclo" é esse check: `completeTaskCycleForRequest` (lib/supabase.ts) acrescenta
// uma entrada aqui antes de avançar o molde para a próxima data.
//
// Mora no payload do MOLDE (`payload.cycle_log`), porque o molde é o card que
// fica sempre aberto e centraliza a demanda. Ciclos concluídos antes de
// 15/09/2026 não têm entrada: o sistema só guardava `last_completed_at`.

export type CycleLogEntry = {
  /** Número do ciclo que foi concluído. */
  cycle: number;
  /** A data prevista daquele ciclo (o `due_date` do molde no momento do check). */
  due_date: string | null;
  completed_at: string;
  by: string | null;
  by_id: string | null;
};

export function cycleLogOf(payload: Record<string, unknown> | null | undefined): CycleLogEntry[] {
  const raw = payload?.cycle_log;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is CycleLogEntry => Boolean(entry) && typeof (entry as CycleLogEntry).completed_at === "string",
  );
}

/** A lista a gravar depois de um check — mais recente por último, com teto. */
export function appendCycleLog(
  payload: Record<string, unknown> | null | undefined,
  entry: CycleLogEntry,
  limit = 200,
): CycleLogEntry[] {
  return [...cycleLogOf(payload), entry].slice(-limit);
}
