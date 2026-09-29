"use client";

import { useEffect, useState } from "react";
import { DEFAULT_OPERATION_FILTERS, type OperationFilter, type OperationFilterAttr } from "./operationItems";

// Filtros da Operação lembrados por pessoa, no próprio navegador — mesmo
// mecanismo de taskSortPrefs.ts. O estado nasce SEMPRE no padrão (é o que o
// servidor renderiza) e só depois lê o localStorage, para não quebrar a
// hidratação (CLAUDE.md, "Hydration gotcha").

const STORAGE_KEY = "op-filters";
const VALID_ATTRS = new Set<OperationFilterAttr>(["status", "tipo", "subtipo", "situacao", "cliente", "frequencia", "prioridade", "responsavel"]);

function isFilter(value: unknown): value is OperationFilter {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return VALID_ATTRS.has(row.attr as OperationFilterAttr) && typeof row.value === "string" && typeof row.label === "string";
}

// O STATUS NUNCA é lembrado (30/09): a tela abre sempre em "tudo menos
// Concluído", para todo mundo. Antes o conjunto inteiro era gravado, e quem
// salvou filtros numa versão anterior (sem status, ou com Concluído) seguia
// vendo concluídos para sempre — o padrão só valia para quem nunca mexeu. Os
// outros atributos (cliente, tipo, responsável…) continuam lembrados.
const REMEMBERED = (filter: OperationFilter) => filter.attr !== "status" && filter.attr !== "situacao";

export function withDefaultStatus(stored: readonly OperationFilter[]): OperationFilter[] {
  return [...DEFAULT_OPERATION_FILTERS, ...stored.filter(REMEMBERED)];
}

function read(): OperationFilter[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_OPERATION_FILTERS];
    const parsed: unknown = JSON.parse(raw);
    // Um formato antigo/estranho volta ao padrão em vez de filtrar errado.
    return Array.isArray(parsed) && parsed.every(isFilter) ? withDefaultStatus(parsed) : [...DEFAULT_OPERATION_FILTERS];
  } catch {
    return [...DEFAULT_OPERATION_FILTERS];
  }
}

export function useOperationFilters() {
  const [filters, setFiltersState] = useState<OperationFilter[]>(() => [...DEFAULT_OPERATION_FILTERS]);

  useEffect(() => { setFiltersState(read()); }, []);

  /** `persist: false` para filtros que vêm de um link (Home → Operação): são
   *  contexto daquela visita, não a preferência da pessoa. */
  function setFilters(next: OperationFilter[] | ((current: OperationFilter[]) => OperationFilter[]), persist = true) {
    setFiltersState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      if (!persist) return value;
      try {
        // `situacao` vem do link (?situacao=) e o status volta ao padrão a cada
        // visita — nenhum dos dois fica grudado para a próxima.
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value.filter(REMEMBERED)));
      } catch { /* sem localStorage: vale só nesta sessão */ }
      return value;
    });
  }

  function resetFilters() { setFilters([...DEFAULT_OPERATION_FILTERS]); }

  return { filters, setFilters, resetFilters };
}
