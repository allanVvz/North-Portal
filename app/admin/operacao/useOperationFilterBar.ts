"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { COLUMNS, PRIORITY_LABEL } from "../kanbanShared";
import { TASK_BASE_TYPES, classifyTask } from "@/lib/taskClassification";
import { subtypeLabel } from "@/lib/taskCatalog";
import type { TaskTypeDef } from "@/lib/taskTypes";
import type { AttrDef, AttrOption } from "./OperationSearchBar";
import { useOperationFilters } from "./operationFilterPrefs";
import {
  DEFAULT_OPERATION_FILTERS, MULTI_VALUE_ATTRS, compatibleSubtypes, itemTypeTags, operationSituation,
  type OperationFilter, type OperationFilterAttr, type OperationItem,
} from "./operationItems";

// A caixa de busca + filtros da Operação, igual nas duas telas (Tarefas e
// Rotinas; Planos e Entregas). Antes só Tarefas tinha a caixa composta; Planos e
// Entregas tinha outra busca, com um seletor de cliente à parte e sem status —
// e por isso mostrava entregas e planos já concluídos. Os filtros são os mesmos
// (e lembrados na mesma chave), então trocar de aba não muda o recorte.

const FILTER_ATTRS: AttrDef[] = [
  { key: "status", label: "Status", icon: "◧" },
  { key: "situacao", label: "Situação", icon: "◉" },
  { key: "tipo", label: "Tipo", icon: "▣" },
  { key: "subtipo", label: "Subtipo", icon: "▢" },
  { key: "cliente", label: "Cliente", icon: "◔" },
  { key: "frequencia", label: "Frequência", icon: "↻" },
  { key: "prioridade", label: "Prioridade", icon: "⚑" },
  { key: "responsavel", label: "Responsável", icon: "◑" },
];
export const SITUATION_LABEL: Record<string, string> = {
  ativa: "Ativa", sem_agenda: "Sem agenda", concluida: "Concluída", historico: "Encerrada",
  no_prazo: "No prazo", atrasada: "Atrasada", parada: "Parada",
};
export const CADENCE_LABEL: Record<string, string> = { semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal" };
export const SEM_RESPONSAVEL = "Sem responsável";
const TYPE_LABEL: Record<string, string> = { rotina: "Rotina", plano: "Plano", entrega: "Entrega", tarefa: "Tarefa" };

function sameFilters(a: readonly OperationFilter[], b: readonly OperationFilter[]): boolean {
  const key = (filter: OperationFilter) => `${filter.attr}:${filter.value}`;
  const left = new Set(a.map(key));
  return left.size === new Set(b.map(key)).size && b.every((filter) => left.has(key(filter)));
}

/** `attrsShown` restringe os atributos oferecidos (Frequência não faz sentido
 *  numa lista só de planos e entregas). */
export function useOperationFilterBar(allItems: readonly OperationItem[], today: string, attrsShown?: readonly OperationFilterAttr[]) {
  const searchParams = useSearchParams();
  const { filters, setFilters, resetFilters } = useOperationFilters();
  const [catalogTypes, setCatalogTypes] = useState<TaskTypeDef[]>([]);
  useEffect(() => {
    fetch("/api/admin/task-types").then((response) => response.ok ? response.json() : null)
      .then((data: { types?: TaskTypeDef[] } | null) => setCatalogTypes(data?.types ?? [])).catch(() => {});
  }, []);

  // Filtros vindos de um link (Home → Operação, "precisam de atenção"): a URL
  // define o recorte daquela visita e NÃO é gravada como preferência. Sem
  // parâmetro de filtro, vale o que a pessoa deixou salvo.
  useEffect(() => {
    const fromUrl: OperationFilter[] = [];
    const statuses = (searchParams.get("status") ?? "").split(",").filter(Boolean);
    for (const value of statuses) {
      const column = COLUMNS.find((entry) => entry.status === value);
      if (column) fromUrl.push({ attr: "status", value, label: column.label });
    }
    const situacao = searchParams.get("situacao");
    if (situacao && SITUATION_LABEL[situacao]) fromUrl.push({ attr: "situacao", value: situacao, label: SITUATION_LABEL[situacao] });
    for (const value of (searchParams.get("tipo") ?? "").split(",").filter(Boolean)) {
      fromUrl.push({ attr: "tipo", value, label: TYPE_LABEL[value] ?? value });
    }
    const cliente = searchParams.get("cliente");
    if (cliente) fromUrl.push({ attr: "cliente", value: cliente, label: cliente });
    const responsavel = searchParams.get("responsavel");
    if (responsavel) fromUrl.push({ attr: "responsavel", value: responsavel, label: responsavel });
    const prioridade = searchParams.get("prioridade");
    if (prioridade && PRIORITY_LABEL[prioridade as keyof typeof PRIORITY_LABEL]) {
      fromUrl.push({ attr: "prioridade", value: prioridade, label: PRIORITY_LABEL[prioridade as keyof typeof PRIORITY_LABEL] });
    }
    if (!fromUrl.length) return;
    // Sem status no link, vale o padrão (tudo menos concluído).
    const withStatus = statuses.length ? fromUrl : [...DEFAULT_OPERATION_FILTERS, ...fromUrl];
    setFilters(withStatus, false);
  // setFilters é um closure novo a cada render, mas escreve sempre o mesmo estado.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const selectedTypes = useMemo(() => filters.filter((filter) => filter.attr === "tipo").map((filter) => filter.value), [filters]);

  const optionsFor = useCallback((attr: OperationFilterAttr): AttrOption[] => {
    if (attr === "status") return COLUMNS.map((column) => ({ value: column.status, label: column.label }));
    if (attr === "situacao") {
      return [...new Set(allItems.map((item) => operationSituation(item, today)))].map((value) => ({ value, label: SITUATION_LABEL[value] ?? value }));
    }
    if (attr === "tipo") {
      const entries: [string, string][] = [
        ...TASK_BASE_TYPES.map((type): [string, string] => [type.key, type.label]),
        ...allItems.flatMap(itemTypeTags).map((value): [string, string] => [value, TYPE_LABEL[value] ?? TASK_BASE_TYPES.find((type) => type.key === value)?.label ?? "Checkpoint"]),
      ];
      return [...new Map(entries).entries()].map(([value, label]) => ({ value, label }));
    }
    if (attr === "subtipo") {
      const catalog = [
        ...(selectedTypes.includes("tarefa") ? catalogTypes.find((type) => type.key === "operacional")?.subtypes.map((subtype) => ({ value: subtype.key, label: subtype.label })) ?? [] : []),
        ...(selectedTypes.includes("entrega") ? catalogTypes.filter((type) => type.behavior === "entrega").map((type) => ({ value: type.key, label: type.label })) : []),
      ];
      const present = compatibleSubtypes(allItems, selectedTypes).map((value) => ({ value, label: allItems.map((item) => classifyTask(item.task.kind, item.task.subtype)).find((classification) => classification.subtypeKey === value)?.subtypeLabel ?? subtypeLabel(value) }));
      return [...new Map([...catalog, ...present].map((option) => [option.value, option])).values()];
    }
    if (attr === "cliente") return [...new Set(allItems.map((item) => item.clientName))].sort().map((value) => ({ value, label: value }));
    if (attr === "frequencia") return ["semanal", "quinzenal", "mensal"].map((value) => ({ value, label: CADENCE_LABEL[value] }));
    if (attr === "prioridade") return Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }));
    const names = [...new Set(allItems.flatMap((item) => (item.task.assignee ?? "").split(",").map((name) => name.trim()).filter(Boolean)))].sort();
    return names.concat(allItems.some((item) => !item.task.assignee) ? [SEM_RESPONSAVEL] : []).map((value) => ({ value, label: value }));
  }, [allItems, selectedTypes, today, catalogTypes]);

  const attrs = FILTER_ATTRS.filter((attr) => (!attrsShown || attrsShown.includes(attr.key)) && (attr.key !== "subtipo" || selectedTypes.length > 0));

  // Subtipo só vale enquanto for compatível com os Tipos escolhidos.
  const pruneSubtypes = useCallback((next: OperationFilter[]) => {
    const types = next.filter((filter) => filter.attr === "tipo").map((filter) => filter.value);
    if (!types.length) return next.filter((filter) => filter.attr !== "subtipo");
    const valid = new Set([
      ...compatibleSubtypes(allItems, types),
      ...(types.includes("tarefa") ? catalogTypes.find((type) => type.key === "operacional")?.subtypes.map((subtype) => subtype.key) ?? [] : []),
      ...(types.includes("entrega") ? catalogTypes.filter((type) => type.behavior === "entrega").map((type) => type.key) : []),
    ]);
    return next.filter((filter) => filter.attr !== "subtipo" || valid.has(filter.value));
  }, [allItems, catalogTypes]);

  function toggle(attr: OperationFilterAttr, option: AttrOption) {
    setFilters((current) => {
      const has = current.some((filter) => filter.attr === attr && filter.value === option.value);
      const next = MULTI_VALUE_ATTRS.includes(attr)
        ? has ? current.filter((filter) => !(filter.attr === attr && filter.value === option.value)) : [...current, { attr, value: option.value, label: option.label }]
        : has ? current.filter((filter) => filter.attr !== attr) : [...current.filter((filter) => filter.attr !== attr), { attr, value: option.value, label: option.label }];
      return pruneSubtypes(next);
    });
  }
  function removeAttr(attr: OperationFilterAttr) {
    setFilters((current) => pruneSubtypes(current.filter((filter) => filter.attr !== attr)));
  }

  return {
    filters,
    setFilters,
    resetFilters,
    pruneSubtypes,
    isDefault: sameFilters(filters, DEFAULT_OPERATION_FILTERS),
    /** Props prontas para <OperationSearchBar>, menos `q`/`onQChange`/`placeholder`. */
    barProps: {
      filters,
      attrs,
      optionsFor,
      onToggle: toggle,
      onRemoveAttr: removeAttr,
      onRemoveLast: () => { const last = filters.at(-1); if (last) removeAttr(last.attr); },
      onReset: resetFilters,
      isDefault: sameFilters(filters, DEFAULT_OPERATION_FILTERS),
    },
  };
}
