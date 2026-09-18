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

function read(): OperationFilter[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_OPERATION_FILTERS];
    const parsed: unknown = JSON.parse(raw);
    // Um formato antigo/estranho volta ao padrão em vez de filtrar errado.
    return Array.isArray(parsed) && parsed.every(isFilter) ? parsed : [...DEFAULT_OPERATION_FILTERS];
  } catch {
    return [...DEFAULT_OPERATION_FILTERS];
  }
}

export function useOperationFilters() {
  const [filters, setFiltersState] = useState<OperationFilter[]>(() => [...DEFAULT_OPERATION_FILTERS]);

  useEffect(() => { setFiltersState(read()); }, []);

  function setFilters(next: OperationFilter[] | ((current: OperationFilter[]) => OperationFilter[])) {
    setFiltersState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      try {
        // `situacao` vem do link (?situacao=) — é contexto da navegação, não
        // preferência da pessoa, e não pode ficar grudado para a próxima visita.
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value.filter((filter) => filter.attr !== "situacao")));
      } catch { /* sem localStorage: vale só nesta sessão */ }
      return value;
    });
  }

  function resetFilters() { setFilters([...DEFAULT_OPERATION_FILTERS]); }

  return { filters, setFilters, resetFilters };
}
