"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import TaskModal, { type TaskCreationScope } from "../TaskModal";

type ClientOption = { slug: string; name: string; is_active: boolean };

// "+ Nova tarefa" on the admin Home — a ÚNICA porta de criação.
//
// Houve por um tempo um segundo botão, "+ Nova entrega". Era o mesmo gesto
// (criar um card) partido em dois por uma distinção que só fazia sentido para
// quem escreveu o código: quem cria não deveria ter que escolher a porta antes
// de escolher o que está fazendo. Hoje o TIPO decide o que nasce — um tipo com
// behavior 'entrega' vira uma corrente de etapas, 'plano' vira um agregador, e
// o resto vira um card comum.
export default function NewTaskLauncher() {
  const router = useRouter();
  const [scope, setScope] = useState<TaskCreationScope | null>(null);
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [planoVisibilityOn, setPlanoVisibilityOn] = useState(true);

  async function openModal(nextScope: TaskCreationScope) {
    setLoading(true);
    // Fetched on click, not on mount: the Home shouldn't pay for three requests
    // that most visits never need.
    const [c, a, p] = await Promise.all([
      fetch("/api/admin/clients").then((r) => (r.ok ? r.json() : { clients: [] })),
      fetch("/api/admin/assignees").then((r) => (r.ok ? r.json() : { assignees: [] })),
      fetch("/api/admin/settings/plano-visibility").then((r) => (r.ok ? r.json() : { enabled: true })),
    ]);
    setClients((c.clients ?? []).filter((x: ClientOption) => x.is_active));
    setAssignees(a.assignees ?? []);
    setPlanoVisibilityOn(p.enabled ?? true);
    setLoading(false);
    setScope(nextScope);
  }

  return (
    <>
      <button type="button" className="admin-btn primary" onClick={() => void openModal("task")} disabled={loading}>
        {loading ? "Abrindo…" : "+ Nova tarefa"}
      </button>
      {scope ? (
        <TaskModal
          mode="new"
          task={null}
          slug=""
          clients={clients}
          assignees={assignees}
          clientName=""
          initialKind="operacional"
          creationScope={scope}
          adminReviewers={[]}
          clientReviewers={[]}
          planoVisibilityOn={planoVisibilityOn}
          onClose={() => setScope(null)}
          onSaved={() => {
            setScope(null);
            router.refresh();
          }}
          onDeleted={() => {
            setScope(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
