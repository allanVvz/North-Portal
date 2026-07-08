"use client";

import { useEffect, useState } from "react";
import TaskModal from "./TaskModal";
import type { ReviewerCandidate, TaskRecord } from "@/lib/validation";

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
    return () => { cancelled = true; };
  }, [clientSlug]);

  const patchLocal = (t: TaskRecord) => {
    setClientTasks((rows) => rows.map((r) => (r.id === t.id ? t : r)));
    onChanged?.(t);
  };

  return (
    <TaskModal
      mode="edit"
      task={task}
      slug={clientSlug}
      clientName={clientName}
      adminReviewers={adminReviewers}
      clientReviewers={clientReviewers}
      clientTasks={clientTasks}
      onTaskPatched={patchLocal}
      onClose={onClose}
      onSaved={(updated) => onSaved(updated)}
      onDeleted={onDeleted}
    />
  );
}
