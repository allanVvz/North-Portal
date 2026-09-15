"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientLite, StudioMessage } from "./types";

// Conversas do Estúdio, separadas por cliente.
//
// Hoje ficam só neste navegador (a tela diz isso). O contrato — um fio de
// mensagens por cliente, com `append`/`patch` — é o que um armazenamento no
// servidor vai implementar quando o histórico sair daqui (roadmap R4.11).
//
// Rascunhos NÃO são guardados: ao recarregar, um pedido que estava em rascunho,
// revisão ou criação aparece como cancelado — nunca volta como se ainda fosse
// confirmável com dados que ninguém está vendo.

const STORAGE_KEY = "northai.studio.v2";
const MAX_MESSAGES = 60;

type Stored = { activeClient: string | null; threads: Record<string, StudioMessage[]> };

function load(clients: readonly ClientLite[]): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { activeClient: null, threads: {} };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const known = new Set(clients.map((client) => client.slug));
    const threads: Record<string, StudioMessage[]> = {};
    for (const [slug, list] of Object.entries(parsed.threads ?? {})) {
      if (!known.has(slug) || !Array.isArray(list)) continue;
      threads[slug] = list
        .filter((message) => message && typeof message.id === "string" && (message.role === "user" || message.role === "assistant"))
        .map((message) =>
          message.role === "assistant" && message.kind === "recipe" && (message.status === "rascunho" || message.status === "revisar" || message.status === "criando")
            ? { ...message, status: "cancelado" as const, note: message.status === "criando" ? "A página foi fechada durante a criação — confira na Operação." : "Rascunho não enviado." }
            : message,
        );
    }
    const activeClient = typeof parsed.activeClient === "string" && known.has(parsed.activeClient) ? parsed.activeClient : null;
    return { activeClient, threads };
  } catch {
    return { activeClient: null, threads: {} };
  }
}

export function useStudioSession(clients: readonly ClientLite[]) {
  const [state, setState] = useState<Stored>({ activeClient: null, threads: {} });
  const [hydrated, setHydrated] = useState(false);

  // localStorage só depois de montar (regra de hidratação do CLAUDE.md).
  useEffect(() => {
    setState(load(clients));
    setHydrated(true);
  }, [clients]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // armazenamento indisponível: o Estúdio funciona igual, só não lembra
    }
  }, [state, hydrated]);

  const setActiveClient = useCallback((slug: string | null) => {
    setState((current) => ({ ...current, activeClient: slug }));
  }, []);

  const append = useCallback((slug: string, message: StudioMessage) => {
    setState((current) => ({
      ...current,
      threads: { ...current.threads, [slug]: [...(current.threads[slug] ?? []), message].slice(-MAX_MESSAGES) },
    }));
  }, []);

  const patch = useCallback((slug: string, id: string, changes: Partial<StudioMessage>) => {
    setState((current) => ({
      ...current,
      threads: {
        ...current.threads,
        [slug]: (current.threads[slug] ?? []).map((message) => (message.id === id ? ({ ...message, ...changes } as StudioMessage) : message)),
      },
    }));
  }, []);

  const clearThread = useCallback((slug: string) => {
    setState((current) => {
      const threads = { ...current.threads };
      delete threads[slug];
      return { ...current, threads };
    });
  }, []);

  return { hydrated, activeClient: state.activeClient, threads: state.threads, setActiveClient, append, patch, clearThread };
}
