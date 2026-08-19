"use client";

import { useEffect, useState } from "react";
import type { SortDir, SortKey } from "./taskSort";

// Preferência de ordenação por visão, local ao dispositivo — mesmo mecanismo
// de kanbanAttrs.ts/kanbanPrefs.ts (localStorage + CustomEvent + evento
// `storage`), para que dois componentes montados na mesma tela nunca fiquem
// mostrando ordens diferentes.

export type SortPref = { key: SortKey; dir: SortDir };

export type SortScope =
  | "tarefas.quadro.status"
  | "tarefas.quadro.responsavel"
  | "tarefas.tabela"
  | "clientes.prazo"
  | "clientes.cliente"
  | "clientes.responsavel"
  | "clientes.lista";

// Cada visão abre na ordem que responde a pergunta que se faz nela:
// no quadro por etapa, "o que mexeu agora"; agrupado por pessoa ou por prazo,
// "o que vence primeiro".
export const SORT_DEFAULTS: Record<SortScope, SortPref> = {
  "tarefas.quadro.status": { key: "edicao", dir: "desc" },
  "tarefas.quadro.responsavel": { key: "data", dir: "asc" },
  "tarefas.tabela": { key: "edicao", dir: "desc" },
  "clientes.prazo": { key: "data", dir: "asc" },
  "clientes.cliente": { key: "edicao", dir: "desc" },
  "clientes.responsavel": { key: "edicao", dir: "desc" },
  "clientes.lista": { key: "data", dir: "asc" },
};

const STORAGE_KEY = "kb-sort";
const EVENT = "kb-sort-change";

const VALID_KEYS = new Set<SortKey>(["manual", "alfabetico", "edicao", "data"]);

/** Descarta escopos/valores desconhecidos em vez de propagar uma ordem inválida
 *  para o comparador (um `key` antigo removido do menu cairia no default). */
function readPref(scope: SortScope): SortPref {
  const fallback = SORT_DEFAULTS[scope];
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const stored = (JSON.parse(raw) as Record<string, Partial<SortPref>>)[scope];
    if (!stored) return fallback;
    return {
      key: VALID_KEYS.has(stored.key as SortKey) ? (stored.key as SortKey) : fallback.key,
      dir: stored.dir === "asc" || stored.dir === "desc" ? stored.dir : fallback.dir,
    };
  } catch {
    return fallback;
  }
}

/**
 * O estado inicial é SEMPRE o default, com a leitura do localStorage num
 * effect. KanbanBoard e ClientsWorkspace são renderizados no servidor, e um
 * initializer lazy divergiria do HTML server-rendered — o mesmo erro de
 * hidratação já cometido no tema do admin e nos atributos do card
 * (ver kanbanAttrs.ts:68-79).
 */
export function useSortPref(scope: SortScope) {
  const [sort, setSortState] = useState<SortPref>(SORT_DEFAULTS[scope]);

  useEffect(() => {
    setSortState(readPref(scope));
    function onChange() { setSortState(readPref(scope)); }
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [scope]);

  function setSort(next: SortPref) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const all = raw ? (JSON.parse(raw) as Record<string, SortPref>) : {};
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...all, [scope]: next }));
    } catch { /* localStorage indisponível: a escolha vale só nesta sessão */ }
    setSortState(next);
    window.dispatchEvent(new Event(EVENT));
  }

  return { sort, setSort };
}
