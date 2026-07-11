"use client";

import { useEffect, useState } from "react";
import TaskModal from "./TaskModal";
import type { ClientFlowFlags, ReviewerCandidate, TaskRecord } from "@/lib/validation";

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
}: {
  task: TaskRecord;
  clientName: string;
  clientSlug: string;
  onClose: () => void;
  onSaved: (task: TaskRecord) => void;
  onDeleted: (id: string) => void;
  onChanged?: (task: TaskRecord) => void;
}) {
  const [adminReviewers, setAdminReviewers] = useState<ReviewerCandidate[]>([]);
  const [clientReviewers, setClientReviewers] = useState<ReviewerCandidate[]>([]);
  const [clientTasks, setClientTasks] = useState<TaskRecord[]>([task]);
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
      .then((data) => { if (!cancelled && data?.tasks) setClientTasks(data.tasks); })
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
    setClientTasks((rows) => rows.map((r) => (r.id === t.id ? t : r)));
    onChanged?.(t);
  };

  return (
    <TaskModal
      mode="edit"
      task={task}
      slug={clientSlug}
      clients={[]}
      clientName={clientName}
      adminReviewers={adminReviewers}
      clientReviewers={clientReviewers}
      clientTasks={clientTasks}
      planoVisibilityOn={planoVisibilityOn}
      flowFlags={flowFlags}
      onTaskPatched={patchLocal}
      onClose={onClose}
      onSaved={(updated) => onSaved(updated)}
      onDeleted={onDeleted}
    />
  );
}
