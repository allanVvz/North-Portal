"use client";

import { useEffect, useState } from "react";
import type { RecurringTask } from "@/lib/supabase";
import { normalizeOperationItems, type OperationItem, type OperationTask } from "./operationItems";

// Uma leitura da Operação por página (30/09). Cabeçalho, insights e o pulso por
// cliente precisam dos mesmos itens; cada um buscava /api/admin/tasks e
// /api/admin/routines por conta própria. Aqui a leitura em andamento é
// compartilhada (mesma promessa) e reaproveitada por alguns segundos — o
// suficiente para os componentes de uma mesma tela, curto o bastante para não
// servir dado velho depois de uma edição e navegação.

export type OperationData = { items: OperationItem[]; tasks: OperationTask[] };

const FRESH_MS = 15_000;
let inflight: { at: number; promise: Promise<OperationData> } | null = null;

async function load(): Promise<OperationData> {
  const [tasks, routines] = await Promise.all([fetch("/api/admin/tasks", { cache: "no-store" }), fetch("/api/admin/routines", { cache: "no-store" })]);
  const taskData = tasks.ok ? await tasks.json() as { tasks?: OperationTask[] } : {};
  const routineData = routines.ok ? await routines.json() as { tasks?: RecurringTask[] } : {};
  const rawTasks = taskData.tasks ?? [];
  return { items: normalizeOperationItems(rawTasks, routineData.tasks ?? []), tasks: rawTasks };
}

export function loadOperationData(): Promise<OperationData> {
  if (!inflight || Date.now() - inflight.at > FRESH_MS) {
    const promise = load();
    inflight = { at: Date.now(), promise };
    // Falhou: a próxima chamada tenta de novo em vez de herdar o erro.
    promise.catch(() => { if (inflight?.promise === promise) inflight = null; });
  }
  return inflight.promise;
}

/** null enquanto carrega; vazio se a leitura falhar. */
export function useOperationData(): OperationData | null {
  const [data, setData] = useState<OperationData | null>(null);
  useEffect(() => {
    let active = true;
    loadOperationData()
      .then((value) => { if (active) setData(value); })
      .catch(() => { if (active) setData({ items: [], tasks: [] }); });
    return () => { active = false; };
  }, []);
  return data;
}
