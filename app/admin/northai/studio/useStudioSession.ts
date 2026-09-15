"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientLite, StudioMessage } from "./types";

// Conversas do Estúdio, uma por cliente, indexadas pelo ID do cliente (nunca
// pelo nome). Hoje ficam só neste navegador (a tela diz isso); o contrato —
// `append`/`patch` por cliente — é o que um armazenamento no servidor vai
// implementar em R4.11.
//
// Rascunhos NÃO são guardados: ao recarregar, um pedido que estava em rascunho,
// revisão ou criação aparece como cancelado.

const STORAGE_KEY = "northai.studio.v3";
const LEGACY_KEY = "northai.studio.v2"; // indexado por slug
const MAX_MESSAGES = 60;

type Stored = { activeClient: string | null; threads: Record<string, StudioMessage[]> };

function closeDrafts(list: unknown): StudioMessage[] {
  if (!Array.isArray(list)) return [];
  return (list as StudioMessage[])
    .filter((message) => message && typeof message.id === "string" && (message.role === "user" || message.role === "assistant"))
    .map((message) =>
      message.role === "assistant" && message.kind === "recipe" && (message.status === "rascunho" || message.status === "revisar" || message.status === "criando")
        ? { ...message, status: "cancelado" as const, note: message.status === "criando" ? "A página foi fechada durante a criação — confira na Operação." : "Rascunho não enviado." }
        : message,
    );
}

function load(clients: readonly ClientLite[]): Stored {
  const byId = new Map(clients.map((client) => [client.id, client]));
  const bySlug = new Map(clients.map((client) => [client.slug, client]));
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>;
      const threads: Record<string, StudioMessage[]> = {};
      for (const [id, list] of Object.entries(parsed.threads ?? {})) if (byId.has(id)) threads[id] = closeDrafts(list);
      return { activeClient: parsed.activeClient && byId.has(parsed.activeClient) ? parsed.activeClient : null, threads };
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as { activeClient?: string | null; threads?: Record<string, unknown> };
      const threads: Record<string, StudioMessage[]> = {};
      for (const [slug, list] of Object.entries(parsed.threads ?? {})) {
        const client = bySlug.get(slug);
        if (client) threads[client.id] = closeDrafts(list).map((message) => (message.role === "user" ? { ...message, clientId: client.id } : message));
      }
      return { activeClient: parsed.activeClient ? bySlug.get(parsed.activeClient)?.id ?? null : null, threads };
    }
  } catch {
    // armazenamento ilegível: começa limpo
  }
  return { activeClient: null, threads: {} };
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

  const setActiveClient = useCallback((clientId: string | null) => {
    setState((current) => ({ ...current, activeClient: clientId }));
  }, []);

  const append = useCallback((clientId: string, message: StudioMessage) => {
    setState((current) => ({
      ...current,
      threads: { ...current.threads, [clientId]: [...(current.threads[clientId] ?? []), message].slice(-MAX_MESSAGES) },
    }));
  }, []);

  const patch = useCallback((clientId: string, id: string, changes: Partial<StudioMessage>) => {
    setState((current) => ({
      ...current,
      threads: {
        ...current.threads,
        [clientId]: (current.threads[clientId] ?? []).map((message) => (message.id === id ? ({ ...message, ...changes } as StudioMessage) : message)),
      },
    }));
  }, []);

  return { hydrated, activeClient: state.activeClient, threads: state.threads, setActiveClient, append, patch };
}
