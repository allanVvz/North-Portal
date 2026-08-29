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
  // Whether the attribute starts ON before the user has ever touched it in
  // the visibility map. Omitted/true = on by default (legacy behavior);
  // false = the card/modal hide it until explicitly toggled on.
  defaultOn?: boolean;
};

// The extra per-kind fields the Kanban persists (in tasks.payload). The task's
// core columns (kind, dates, workflow, reviewer) are edited directly in the
// modal sections; these are the optional payload/derived attributes toggled by
// the "Atributos visíveis" panel, and consumed by the Kanban card (Quadro),
// the Tabela columns, and the Calendário's progress badge. `status` is never
// rendered on the kanban CARD — only in the modal/detail panel/Tabela —
// regardless of this map. "Tarefa" (título) is intentionally not listed here —
// it isn't a gated Cell anywhere (the title is always the modal's
// header/identifier), so a toggle for it would do nothing.
export const ATTR_DEFS: AttrDef[] = [
  { key: "kind", label: "Tipo", scope: "Todos", kinds: "base", kind: "Seleção", defaultOn: false },
  { key: "formato", label: "Formato", scope: "Criativo", kinds: ["criativo"], kind: "Seleção", defaultOn: false },
  { key: "plataforma", label: "Plataforma", scope: "Criativo · Agendamento", kinds: ["criativo", "agendamento"], kind: "Seleção", defaultOn: false },
  { key: "assignee", label: "Responsável", scope: "Todos", kinds: "base", kind: "Pessoa" },
  { key: "reviewer", label: "Revisor (mesmo com fluxo desligado)", scope: "Todos", kinds: "base", kind: "Pessoa", defaultOn: false },
  { key: "approver", label: "Aprovador (mesmo com fluxo desligado)", scope: "Todos", kinds: "base", kind: "Pessoa", defaultOn: false },
  // Criativo entrou aqui junto com os fluxos em cascata: a etapa de uma peça
  // (Roteiro/Captação/Edição/Publicação) é kind=criativo + subtype, então sem
  // isto o campo que a identifica não apareceria em lugar nenhum.
  { key: "subtype", label: "Subtipo", scope: "Criativo · Agendamento · Planejamento", kinds: ["criativo", "agendamento", "planejamento"], kind: "Seleção", defaultOn: false },
  // Ligado por padrão, ao contrário dos outros: numa cascata a etapa ("2/4 ·
  // Captação") é a identidade do card, não um enfeite opcional.
  { key: "flow_step", label: "Etapa do fluxo", scope: "Criativo", kinds: ["criativo"], kind: "Seleção" },
  { key: "status", label: "Status", scope: "Todos", kinds: "base", kind: "Seleção", defaultOn: false },
  { key: "priority", label: "Prioridade", scope: "Todos", kinds: "base", kind: "Seleção", defaultOn: false },
  { key: "plan_link", label: "Plano de Ação", scope: "Todos", kinds: "base", kind: "Seleção", defaultOn: false },
  { key: "progress", label: "Progresso", scope: "Todos", kinds: "base", kind: "Seleção", defaultOn: false },
  { key: "client_visible", label: "Visível ao cliente", scope: "Todos", kinds: "base", kind: "Seleção", defaultOn: false },
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
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key] !== false;
  return def?.defaultOn ?? true;
}

/** Reads + writes the attribute-visibility map (localStorage), synced live across
 *  every mounted component that calls this hook (board + panel + modal).
 *
 *  `lazy: true` reads localStorage synchronously on first render instead of
 *  starting from `{}` and syncing in an effect. Safe (and needed) for
 *  components that only ever mount client-side after an interaction — a
 *  modal/popover has no server-rendered HTML to hydrate against, so there's
 *  nothing to mismatch; skipping the empty-then-populated cycle is what
 *  removes the "attributes flash then disappear" glitch when opening a card.
 *  Do NOT use it for KanbanBoard itself: that component IS server-rendered,
 *  and a lazy localStorage read there would diverge from the SSR'd markup
 *  (same class of bug already hit once with the admin theme toggle). */
export function useAttrVisibility(opts?: { lazy?: boolean }) {
  const [map, setMapState] = useState<Record<string, boolean>>(() => (opts?.lazy ? readMap() : {}));

  useEffect(() => {
    if (!opts?.lazy) setMapState(readMap());
    function onChange() { setMapState(readMap()); }
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save(next: Record<string, boolean>) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setMapState(next);
    window.dispatchEvent(new Event(EVENT));
  }

  return { map, save, visible: (key: string) => isAttrVisible(map, key) };
}
