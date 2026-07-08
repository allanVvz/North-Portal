"use client";

import { useEffect, useState } from "react";

export type AttrKind = "Texto" | "Seleção" | "Pessoa" | "Data" | "Número";

export const KIND_ICON: Record<AttrKind, string> = {
  Texto: "Aa", Seleção: "◧", Pessoa: "◔", Data: "▦", Número: "#",
};

export type AttrDef = {
  key: string;
  label: string;
  scope: string; // display text, e.g. "Criativo · Agendamento"
  kinds: string[] | "base"; // "base" = shown for every kind, always on
  kind: AttrKind; // the attribute's data-type (not the task kind)
  locked?: boolean;
};

// The extra per-kind fields the Kanban persists (in tasks.payload). The task's
// core columns (kind, subtype, dates, workflow, reviewer) are edited directly in
// the modal sections; these are the optional payload attributes toggled by the
// "Atributos visíveis" panel.
export const ATTR_DEFS: AttrDef[] = [
  { key: "title", label: "Tarefa", scope: "Todos", kinds: "base", kind: "Texto", locked: true },
  { key: "formato", label: "Formato", scope: "Criativo", kinds: ["criativo"], kind: "Seleção" },
  { key: "plataforma", label: "Plataforma", scope: "Criativo · Agendamento", kinds: ["criativo", "agendamento"], kind: "Seleção" },
  { key: "assignee", label: "Responsável", scope: "Todos", kinds: "base", kind: "Pessoa" },
  { key: "legenda", label: "Legenda", scope: "Agendamento", kinds: ["agendamento"], kind: "Texto" },
  { key: "status", label: "Status", scope: "Todos", kinds: "base", kind: "Seleção", locked: true },
];

const STORAGE_KEY = "kb-attr-visible";
const EVENT = "kb-attr-visible-change";

function readMap(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function isAttrVisible(map: Record<string, boolean>, key: string): boolean {
  const def = ATTR_DEFS.find((a) => a.key === key);
  if (def?.locked) return true;
  return map[key] !== false;
}

/** Reads + writes the attribute-visibility map (localStorage), synced live across
 *  every mounted component that calls this hook (board + panel + modal). */
export function useAttrVisibility() {
  const [map, setMapState] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setMapState(readMap());
    function onChange() { setMapState(readMap()); }
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  function save(next: Record<string, boolean>) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setMapState(next);
    window.dispatchEvent(new Event(EVENT));
  }

  return { map, save, visible: (key: string) => isAttrVisible(map, key) };
}
