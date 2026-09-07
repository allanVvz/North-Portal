"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskRecord } from "@/lib/validation";

export type AutosaveState = "saved" | "pending" | "saving" | "error";

/** Quanto tempo de silêncio no teclado antes de gravar um campo de texto. */
export const TEXT_IDLE_MS = 2500;

/** "Vazio" tem três grafias no formulário — `null`, `undefined` e `""` — e as
 * três significam a mesma coisa para o card. Comparar os bytes crus fazia um
 * campo de texto que a pessoa focou e deixou em branco contar como edição:
 * saía um PATCH, e o PATCH virava notificação de "card editado" sem que nada
 * tivesse sido editado. */
function normalize(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  // `recurrence_weekdays` e `assignee_profile_ids` são conjuntos, não
  // sequências: [1,3] e [3,1] são a mesma recorrência. A ordem muda quando a
  // pessoa desmarca e remarca um dia, e só isso já disparava um salvamento.
  if (Array.isArray(value)) return [...value.map(normalize)].sort();
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, normalize(v)] as const)
      .filter(([, v]) => v !== null)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  return value;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export function diffTaskPatch(current: Record<string, unknown>, confirmed: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(current).filter(([key, value]) => !equal(value, confirmed[key])));
}

export function useTaskAutosave({
  taskId,
  values,
  enabled,
  textKeys,
  valid = true,
  onSaved,
}: {
  taskId: string;
  values: Record<string, unknown>;
  enabled: boolean;
  textKeys: string[];
  valid?: boolean;
  onSaved: (task: TaskRecord) => void;
}) {
  const [state, setState] = useState<AutosaveState>("saved");
  const confirmed = useRef(values);
  const latest = useRef(values);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<boolean> | null>(null);
  const rerun = useRef(false);
  const mounted = useRef(true);

  const taskIdSeen = useRef(taskId);
  if (taskIdSeen.current !== taskId) {
    taskIdSeen.current = taskId;
    confirmed.current = values;
  }

  latest.current = values;

  const persist = useCallback(async (): Promise<boolean> => {
    if (!enabled || !valid) {
      if (!valid) setState("pending");
      return false;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (running.current) {
      rerun.current = true;
      return running.current.then(() => persist());
    }
    const patch = diffTaskPatch(latest.current, confirmed.current);
    if (!Object.keys(patch).length) {
      setState("saved");
      return true;
    }
    setState("saving");
    const request = (async () => {
      try {
        const response = await fetch(`/api/admin/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = await response.json().catch(() => null) as TaskRecord | { error?: string } | null;
        if (!response.ok) throw new Error(body && "error" in body ? body.error : "Não foi possível salvar o card.");
        confirmed.current = { ...confirmed.current, ...patch };
        if (mounted.current) onSaved(body as TaskRecord);
        return true;
      } catch {
        if (mounted.current) setState("error");
        return false;
      } finally {
        running.current = null;
      }
    })();
    running.current = request;
    const ok = await request;
    if (rerun.current) {
      rerun.current = false;
      return persist();
    }
    if (ok && mounted.current) setState(Object.keys(diffTaskPatch(latest.current, confirmed.current)).length ? "pending" : "saved");
    return ok;
  }, [enabled, onSaved, taskId, valid]);

  useEffect(() => {
    if (!enabled) return;
    const patch = diffTaskPatch(values, confirmed.current);
    const keys = Object.keys(patch);
    if (!keys.length) { setState("saved"); return; }
    setState("pending");
    if (!valid) return;
    if (timer.current) clearTimeout(timer.current);
    // Janela de digitação. Eram 700ms: escrever um parágrafo virava uma dezena
    // de salvamentos, e cada salvamento era uma notificação para todo mundo do
    // card. Fechar o card faz `flush` e o `beforeunload` avisa se algo estiver
    // pendente, então esperar mais não arrisca perder texto — só junta o que a
    // pessoa ainda está escrevendo num salvamento só.
    if (keys.every((key) => textKeys.includes(key))) timer.current = setTimeout(() => void persist(), TEXT_IDLE_MS);
    else void persist();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [enabled, persist, textKeys.join("|"), valid, values]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (state === "pending" || state === "saving" || state === "error") event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [state]);
  // `mounted` existe para não chamar setState depois que o modal fechou. Mas
  // ele só era posto em `false`, e nada o devolvia para `true` — e em
  // StrictMode (dev, `reactStrictMode: true` no next.config) o React roda
  // montar → limpar → montar de propósito. Depois dessa sequência a flag ficava
  // `false` PARA SEMPRE, e o efeito era exatamente o oposto do pretendido: o
  // card salvava (o PATCH ia e voltava 200), mas `onSaved` nunca era chamado e
  // o estado nunca saía de "Salvando…". Só aparecia em dev, e só um teste
  // olhava esse rótulo — os outros conferem o banco, que estava certo.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return { state, flush: persist, retry: persist };
}
