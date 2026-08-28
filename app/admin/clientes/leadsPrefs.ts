"use client";

import { useEffect, useState } from "react";

// Qual seção de /admin/clientes está aberta (Clientes ou Leads) e, dentro de
// Leads, qual visualização. Mesmo mecanismo de taskSortPrefs.ts/kanbanPrefs.ts:
// localStorage + CustomEvent + evento `storage` (este último cobre a mudança
// feita em outra aba do navegador).

export type ClientesSection = "clientes" | "leads";
export type LeadsView = "kanban" | "tabela";

type Prefs = { section: ClientesSection; view: LeadsView };

const DEFAULTS: Prefs = { section: "clientes", view: "kanban" };

const STORAGE_KEY = "north-clientes-prefs";
const EVENT = "north-clientes-prefs-change";

const VALID_SECTIONS = new Set<ClientesSection>(["clientes", "leads"]);
const VALID_VIEWS = new Set<LeadsView>(["kanban", "tabela"]);

/** Valida campo a campo em vez de confiar no que estiver gravado: uma versão
 *  antiga do app pode ter escrito uma seção que não existe mais, e propagar
 *  isso renderizaria uma tela vazia sem erro nenhum. */
function readPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const stored = JSON.parse(raw) as Partial<Prefs>;
    return {
      section: VALID_SECTIONS.has(stored.section as ClientesSection) ? (stored.section as ClientesSection) : DEFAULTS.section,
      view: VALID_VIEWS.has(stored.view as LeadsView) ? (stored.view as LeadsView) : DEFAULTS.view,
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * O estado inicial é SEMPRE o default, com a leitura do localStorage num
 * effect depois do mount. /admin/clientes é renderizada no servidor, e um
 * initializer lazy divergiria do HTML server-rendered — React descartaria a
 * árvore inteira, que é pior do que o flash da seção padrão (ver CLAUDE.md e
 * o mesmo comentário em taskSortPrefs.ts).
 */
export function useClientesPrefs() {
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    setPrefsState(readPrefs());
    function onChange() { setPrefsState(readPrefs()); }
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  function update(patch: Partial<Prefs>) {
    const next = { ...readPrefs(), ...patch };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch { /* localStorage indisponível: a escolha vale só nesta sessão */ }
    setPrefsState(next);
    window.dispatchEvent(new Event(EVENT));
  }

  return {
    section: prefs.section,
    view: prefs.view,
    setSection: (section: ClientesSection) => update({ section }),
    setView: (view: LeadsView) => update({ view }),
  };
}
