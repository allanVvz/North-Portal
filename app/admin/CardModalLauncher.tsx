"use client";

import { useEffect, useRef, useState } from "react";
import TaskModal from "./TaskModal";
import type { ClientFlowFlags, ReviewerCandidate, TaskRecord } from "@/lib/validation";

const EMPTY_RELATED_TASKS: TaskRecord[] = [];

// Opens the full TaskModal for a card coming from a screen that isn't the Kanban
// board (Revisões/Aprovações/Plano de Ação) — fetches that client's reviewer
// candidates and its task list (for plan↔activity management) on demand.
export default function CardModalLauncher({
  task,
  clientName,
  clientSlug,
  onClose,
  onSaved,
  onDeleted,
  onChanged,
  initialRelatedTasks = EMPTY_RELATED_TASKS,
  parentTask,
}: {
  task: TaskRecord;
  clientName: string;
  clientSlug: string;
  onClose: () => void;
  onSaved: (task: TaskRecord) => void;
  onDeleted: (id: string) => void;
  onChanged?: (task: TaskRecord) => void;
  initialRelatedTasks?: TaskRecord[];
  parentTask?: TaskRecord;
}) {
  const [activeTask, setActiveTask] = useState(task);
  const [history, setHistory] = useState<TaskRecord[]>(() => parentTask ? [parentTask] : []);
  const [adminReviewers, setAdminReviewers] = useState<ReviewerCandidate[]>([]);
  const [clientReviewers, setClientReviewers] = useState<ReviewerCandidate[]>([]);
  const [clientTasks, setClientTasks] = useState<TaskRecord[]>(() => [task, ...initialRelatedTasks.filter((related) => related.id !== task.id)]);
  // Both default to the "hidden until loaded" side (planoVisibilityOn=false,
  // flowFlags=null -> revisaoOff/aprovacaoOff true in TaskModal) so nothing
  // flashes visible for the fetch's duration then disappears — same pattern
  // as KanbanBoard. Omitting these two fetches entirely (as this file used
  // to) meant every screen that opens a card through here (Revisões,
  // Aprovações, Plano de Ação) silently fell back to TaskModal's prop
  // defaults (planoVisibilityOn=true) — the "visível para o cliente" box
  // kept showing regardless of the real global switch.
  const [planoVisibilityOn, setPlanoVisibilityOn] = useState(false);
  const [flowFlags, setFlowFlags] = useState<ClientFlowFlags | null>(null);
  // Every registered client, so the editor's Cliente picker can move a card
  // to any of them — not just the one it currently belongs to.
  const [clients, setClients] = useState<{ slug: string; name: string }[]>([]);
  // Every Responsável option (team + historical names) — the field is a
  // dropdown-only now, never free text.
  const [assignees, setAssignees] = useState<string[]>([]);
  const rootTaskIdRef = useRef(task.id);

  useEffect(() => {
    setClientTasks((current) => {
      const merged = new Map(current.map((row) => [row.id, row]));
      merged.set(task.id, task);
      for (const related of initialRelatedTasks) merged.set(related.id, related);
      return Array.from(merged.values());
    });
    // A router.refresh after activating a future execution recreates the root
    // task object. Resetting navigation on object identity used to throw the
    // user back to the parent immediately. Only a genuinely different root
    // card starts a new modal history.
    if (rootTaskIdRef.current === task.id) return;
    rootTaskIdRef.current = task.id;
    setActiveTask(task);
    setHistory(parentTask ? [parentTask] : []);
  }, [task, initialRelatedTasks, parentTask]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/clients")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data?.clients) setClients(data.clients.map((c: { slug: string; name: string }) => ({ slug: c.slug, name: c.name }))); })
      .catch(() => { /* Cliente picker just shows the current one */ });
    fetch("/api/admin/assignees")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data?.assignees) setAssignees(data.assignees); })
      .catch(() => { /* Responsável picker just shows the current one */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/reviewers?slug=${encodeURIComponent(clientSlug)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setAdminReviewers(data.adminReviewers ?? []);
        setClientReviewers(data.clientReviewers ?? []);
      })
      .catch(() => { /* modal still opens, just without reviewer options */ });
    fetch(`/api/admin/tasks?slug=${encodeURIComponent(clientSlug)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.tasks) return;
        setClientTasks((current) => {
          const merged = new Map(current.map((row) => [row.id, row]));
          for (const row of data.tasks as TaskRecord[]) merged.set(row.id, row);
          return Array.from(merged.values());
        });
      })
      .catch(() => { /* member management just shows what we have */ });
    fetch(`/api/admin/client/${encodeURIComponent(clientSlug)}/flow-flags`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setFlowFlags(data); })
      .catch(() => { /* Revisor/Aprovador just stay hidden */ });
    return () => { cancelled = true; };
  }, [clientSlug]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings/plano-visibility")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setPlanoVisibilityOn(Boolean(data.enabled)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const patchLocal = (t: TaskRecord) => {
    setClientTasks((rows) => rows.some((r) => r.id === t.id) ? rows.map((r) => (r.id === t.id ? t : r)) : [...rows, t]);
  };
  const patchActiveTask = (t: TaskRecord) => {
    patchLocal(t);
    if (t.id === activeTask.id) onChanged?.(t);
  };
  const planCandidates = clientTasks
    .filter((candidate) => candidate.kind === "plano_acao")
    .map((candidate) => ({ id: candidate.id, title: candidate.title }));

  return (
    <TaskModal
      key={activeTask.id}
      mode="edit"
      task={activeTask}
      slug={clientSlug}
      clients={clients}
      assignees={assignees}
      clientName={clientName}
      adminReviewers={adminReviewers}
      clientReviewers={clientReviewers}
      clientTasks={clientTasks}
      planCandidates={planCandidates}
      planoVisibilityOn={planoVisibilityOn}
      flowFlags={flowFlags}
      onTaskPatched={patchActiveTask}
      onOpenRelatedTask={(related) => { patchLocal(related); setHistory((items) => [...items, activeTask]); setActiveTask(related); }}
      onBack={history.length ? () => {
        const previous = history[history.length - 1];
        setHistory((items) => items.slice(0, -1));
        setActiveTask(previous);
      } : undefined}
      onClose={onClose}
      onSaved={(updated) => onSaved(updated)}
      onDeleted={onDeleted}
    />
  );
}
