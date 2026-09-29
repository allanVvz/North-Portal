"use client";

import { useEffect, useRef, useState } from "react";
import type { TaskRecord, TaskStatus } from "@/lib/validation";

type Props = {
  taskId: string;
  status: TaskStatus;
  reviewerIds: string[];
  currentUserId: string | null;
  deliveryId?: string;
  onDecided: (task: TaskRecord, effectiveStatus?: TaskStatus) => void;
};

/** Reviewer decisions use the atomic endpoint; they never travel as comments or status PATCHes. */
export default function TaskReviewActions({ taskId, status, reviewerIds, currentUserId, deliveryId, onDecided }: Props) {
  const [decision, setDecision] = useState<"approve" | "request_changes" | null>(null);
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState(false);
  const requestId = useRef("");
  const authorized = Boolean(currentUserId && reviewerIds.includes(currentUserId));
  useEffect(() => { setResolved(false); }, [taskId, status, deliveryId]);

  if (status !== "revisao" || !authorized || resolved) return null;

  async function submit() {
    if (!decision || busy) return;
    if (!requestId.current) requestId.current = crypto.randomUUID();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/tasks/${taskId}/review-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, justification: justification.trim() || undefined, expected_status: "revisao", ...(deliveryId ? { delivery_id: deliveryId } : {}), request_id: requestId.current }),
      });
      const body = await response.json().catch(() => null) as { task?: TaskRecord; effective_status?: TaskStatus; error?: string } | null;
      if (!response.ok || !body?.task) {
        if (response.status === 409) setError("O status mudou enquanto você escrevia. Atualize o card para decidir.");
        else setError(body?.error || "Não foi possível registrar a decisão.");
        return;
      }
      onDecided(body.task, body.effective_status);
      setResolved(true);
      setDecision(null);
      setJustification("");
      requestId.current = "";
    } catch {
      setError("Falha de conexão. Tente novamente; a mesma solicitação será reaproveitada.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="task-review-actions" aria-label="Decisão da revisão">
    <div className="task-review-buttons">
      <button type="button" className="admin-btn primary" disabled={busy} onClick={() => { if (decision !== "approve") requestId.current = crypto.randomUUID(); setDecision("approve"); setError(""); }}>Aprovar</button>
      <button type="button" className="admin-btn ghost" disabled={busy} onClick={() => { if (decision !== "request_changes") requestId.current = crypto.randomUUID(); setDecision("request_changes"); setError(""); }}>Pedir ajustes</button>
    </div>
    {decision ? <div className="task-review-form">
      <label>Justificativa (opcional)
        <textarea value={justification} onChange={(event) => setJustification(event.target.value)} rows={2} placeholder="Deixe um contexto para esta decisão" />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div>
        <button type="button" className="admin-btn ghost" disabled={busy} onClick={() => { setDecision(null); setJustification(""); setError(""); requestId.current = ""; }}>Cancelar</button>
        <button type="button" className="admin-btn primary" disabled={busy} onClick={() => void submit()}>{busy ? "Salvando…" : decision === "approve" ? "Confirmar aprovação" : "Confirmar ajustes"}</button>
      </div>
    </div> : null}
  </section>;
}
