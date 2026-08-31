"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import TaskModal, { type TaskCreationPrefill } from "./TaskModal";
import type { TaskRecord } from "@/lib/validation";

type ClientOption = { slug: string; name: string; is_active: boolean };

// A ÚNICA porta de criação de tarefa. O mesmo botão em toda tela — Home, quadro,
// Entregas, Rotinas, Plano de Ação, Automações. O que nasce é decidido DENTRO do
// modal, pelo tipo escolhido no dropdown; nenhuma tela pré-decide isso.
//
// `prefill` é só conveniência de campo (a coluna do quadro de onde o clique
// saiu, o cliente da tela atual) — nunca muda o comportamento do modal.
export default function NewTaskButton({
  label = "+ Nova tarefa",
  className = "admin-btn primary",
  prefill,
  onCreated,
}: {
  label?: string;
  className?: string;
  prefill?: TaskCreationPrefill;
  onCreated?: (task: TaskRecord) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<{ slug: string; name: string }[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [planoVisibilityOn, setPlanoVisibilityOn] = useState(true);

  async function openModal() {
    setLoading(true);
    // Buscado no clique, não na montagem: a maioria das visitas não cria nada.
    const [c, a, p] = await Promise.all([
      fetch("/api/admin/clients").then((r) => (r.ok ? r.json() : { clients: [] })),
      fetch("/api/admin/assignees").then((r) => (r.ok ? r.json() : { assignees: [] })),
      fetch("/api/admin/settings/plano-visibility").then((r) => (r.ok ? r.json() : { enabled: true })),
    ]);
    setClients(
      (c.clients ?? [])
        .filter((x: ClientOption) => x.is_active)
        .map((x: ClientOption) => ({ slug: x.slug, name: x.name })),
    );
    setAssignees(a.assignees ?? []);
    setPlanoVisibilityOn(p.enabled ?? true);
    setLoading(false);
    setOpen(true);
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void openModal()} disabled={loading}>
        {loading ? "Abrindo…" : label}
      </button>
      {open ? (
        <TaskModal
          mode="new"
          task={null}
          slug=""
          clients={clients}
          assignees={assignees}
          clientName=""
          prefill={prefill}
          adminReviewers={[]}
          clientReviewers={[]}
          planoVisibilityOn={planoVisibilityOn}
          onClose={() => setOpen(false)}
          onSaved={(task) => {
            setOpen(false);
            if (onCreated) onCreated(task);
            else router.refresh();
          }}
          onDeleted={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
