"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskRecord } from "@/lib/validation";

export type AutosaveState = "saved" | "pending" | "saving" | "error";

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
    if (keys.every((key) => textKeys.includes(key))) timer.current = setTimeout(() => void persist(), 700);
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
  useEffect(() => () => { mounted.current = false; }, []);

  return { state, flush: persist, retry: persist };
}
