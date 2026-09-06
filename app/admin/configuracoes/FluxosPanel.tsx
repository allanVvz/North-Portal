"use client";

import { useEffect, useState } from "react";
import type { TaskTypeEditorNode, TaskTypeEditorSubtype, VocabUsageMap } from "@/lib/taskTypes";
import { usageKey } from "@/lib/taskTypes";

// Configurações › Tipos e fluxos — o molde das Entregas fora do SQL.
//
// A tela edita `task_types`, a tabela auto-referenciada onde um Tipo é a linha
// sem pai e suas Etapas são as linhas filhas: a ordem das etapas É a cascata.
// O que NÃO se faz aqui é criar um tipo de topo — ele tem contraparte em
// lib/taskCatalog.ts (tom, ícone, união TaskKind) e uma linha só no banco
// renderizaria com o visual de fallback em todo card.

type EditorData = { types: TaskTypeEditorNode[]; usage: VocabUsageMap };

const BEHAVIOR_LABEL: Record<string, string> = {
  entrega: "Entrega",
  plano: "Plano",
  simples: "Tarefa",
};

type StepDraft = {
  label: string;
  lead_days: number;
  progress_weight: number;
  default_assignee: string;
  client_visible: boolean;
};

function toStepDraft(step: TaskTypeEditorSubtype): StepDraft {
  return {
    label: step.label,
    lead_days: step.lead_days,
    progress_weight: step.progress_weight,
    default_assignee: step.default_assignee ?? "",
    client_visible: step.client_visible,
  };
}

const EMPTY_STEP: StepDraft = { label: "", lead_days: 0, progress_weight: 1, default_assignee: "", client_visible: false };

export default function FluxosPanel() {
  const [data, setData] = useState<EditorData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Um editor aberto por vez em toda a tela: id da linha, ou `new:<typeId>`.
  const [editing, setEditing] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState<StepDraft>(EMPTY_STEP);
  const [typeLabel, setTypeLabel] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/task-types?scope=editor")
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: EditorData | null) => {
        if (payload) setData(payload);
        else setError("Não foi possível carregar os tipos.");
      })
      .catch(() => setError("Não foi possível carregar os tipos."));
  }, []);

  function closeEditor() {
    setEditing(null);
    setStepDraft(EMPTY_STEP);
    setTypeLabel("");
  }

  /** Toda escrita volta pelo servidor: as travas (card em aberto, última etapa
   * de uma Entrega, etapa já usada) moram lá, e a mensagem que elas devolvem é
   * o que o admin precisa ler — por isso o corpo do erro é exibido cru. */
  async function send(url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, init);
      const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(typeof payload?.error === "string" ? payload.error : "Não foi possível salvar.");
        return null;
      }
      return payload ?? {};
    } catch {
      setError("Não foi possível salvar — verifique sua conexão.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function applyStep(typeId: string, stepId: string, patch: Partial<TaskTypeEditorSubtype>) {
    setData((cur) =>
      cur
        ? {
            ...cur,
            types: cur.types.map((t) =>
              t.id === typeId ? { ...t, subtypes: t.subtypes.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) } : t,
            ),
          }
        : cur,
    );
  }

  async function patchStep(typeId: string, stepId: string, patch: Partial<TaskTypeEditorSubtype>) {
    const ok = await send(`/api/admin/task-types/${stepId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (ok) applyStep(typeId, stepId, patch);
    return Boolean(ok);
  }

  async function saveStep(type: TaskTypeEditorNode) {
    const label = stepDraft.label.trim();
    if (!label) return;
    const fields = {
      label,
      lead_days: stepDraft.lead_days,
      progress_weight: stepDraft.progress_weight,
      default_assignee: stepDraft.default_assignee.trim() || null,
      client_visible: stepDraft.client_visible,
    };

    if (editing === `new:${type.id}`) {
      const created = await send("/api/admin/task-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: type.id, ...fields }),
      });
      if (!created) return;
      setData((cur) =>
        cur
          ? {
              ...cur,
              types: cur.types.map((t) =>
                t.id === type.id ? { ...t, subtypes: [...t.subtypes, created as unknown as TaskTypeEditorSubtype] } : t,
              ),
            }
          : cur,
      );
      closeEditor();
      return;
    }

    if (editing && (await patchStep(type.id, editing, fields))) closeEditor();
  }

  async function saveTypeLabel(type: TaskTypeEditorNode) {
    const label = typeLabel.trim();
    if (!label) return;
    const ok = await send(`/api/admin/task-types/${type.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (!ok) return;
    setData((cur) => (cur ? { ...cur, types: cur.types.map((t) => (t.id === type.id ? { ...t, label } : t)) } : cur));
    closeEditor();
  }

  async function toggleTypeActive(type: TaskTypeEditorNode) {
    const ok = await send(`/api/admin/task-types/${type.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !type.active }),
    });
    if (!ok) return;
    setData((cur) =>
      cur ? { ...cur, types: cur.types.map((t) => (t.id === type.id ? { ...t, active: !type.active } : t)) } : cur,
    );
  }

  async function removeStep(type: TaskTypeEditorNode, step: TaskTypeEditorSubtype) {
    const ok = await send(`/api/admin/task-types/${step.id}`, { method: "DELETE" });
    if (!ok) return;
    setData((cur) =>
      cur
        ? {
            ...cur,
            types: cur.types.map((t) =>
              t.id === type.id ? { ...t, subtypes: t.subtypes.filter((s) => s.id !== step.id) } : t,
            ),
          }
        : cur,
    );
  }

  /** Reordenar é reescrever `order_index` das etapas que mudaram de lugar —
   * a ordem da lista é literalmente a ordem da cascata. Otimista, com rollback
   * se qualquer PATCH falhar; renumera de 10 em 10 para caber uma inserção
   * manual entre duas etapas depois. */
  async function reorder(type: TaskTypeEditorNode, beforeId: string) {
    const id = dragId;
    setDragId(null);
    if (!id || id === beforeId || !data) return;
    const dragged = type.subtypes.find((s) => s.id === id);
    if (!dragged) return;

    const others = type.subtypes.filter((s) => s.id !== id);
    const at = others.findIndex((s) => s.id === beforeId);
    const reordered = at === -1 ? [...others, dragged] : [...others.slice(0, at), dragged, ...others.slice(at)];
    const renumbered = reordered.map((s, i) => ({ ...s, order_index: (i + 1) * 10 }));
    const changed = renumbered.filter((s) => type.subtypes.find((o) => o.id === s.id)?.order_index !== s.order_index);
    if (!changed.length) return;

    const before = data;
    setError("");
    setData({ ...data, types: data.types.map((t) => (t.id === type.id ? { ...t, subtypes: renumbered } : t)) });
    setBusy(true);
    try {
      const results = await Promise.all(
        changed.map((s) =>
          fetch(`/api/admin/task-types/${s.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order_index: s.order_index }),
          }),
        ),
      );
      if (results.some((res) => !res.ok)) {
        setData(before);
        setError("Não foi possível reordenar.");
      }
    } catch {
      setData(before);
      setError("Não foi possível reordenar — verifique sua conexão.");
    }
    setBusy(false);
  }

  if (!data) {
    return (
      <div className="set-card">
        <h2 className="set-h">Tipos e fluxos</h2>
        <p className="admin-sub">{error || "Carregando…"}</p>
      </div>
    );
  }

  return (
    <div className="set-card">
      <div className="set-appearance-head">
        <div>
          <h2 className="set-h">Tipos e fluxos</h2>
          <p className="admin-sub">
            O vocabulário dos cards. Um tipo <strong>Entrega</strong> cascateia pelas etapas na ordem abaixo — arraste para
            reordenar. Editar um molde vale para as entregas <strong>novas</strong>: as que já estão em andamento
            congelaram o próprio denominador de progresso quando nasceram, e não mudam de tamanho no meio do caminho.
          </p>
        </div>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="voc-list">
        {data.types.map((type) => {
          const typeUsage = data.usage[usageKey(type.key)];
          return (
            <section className={`voc-type ${type.active ? "" : "off"}`} key={type.id}>
              <header className="voc-type-head">
                {editing === type.id ? (
                  <div className="voc-inline">
                    <label className="admin-field">
                      <span>Nome do tipo</span>
                      <input value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} autoFocus />
                    </label>
                    <div className="kb-modal-actions-right">
                      <button className="admin-btn ghost" onClick={closeEditor} disabled={busy}>Cancelar</button>
                      <button className="admin-btn primary" onClick={() => void saveTypeLabel(type)} disabled={busy || !typeLabel.trim()}>
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="voc-type-meta">
                      <div className="voc-type-titlerow">
                        <strong>{type.label}</strong>
                        <span className="voc-key">{type.key}</span>
                        <span className={`set-badge ${type.behavior === "entrega" ? "publicada" : "rascunho"}`}>
                          {BEHAVIOR_LABEL[type.behavior] ?? type.behavior}
                        </span>
                        {type.active ? null : <span className="set-badge rascunho">Inativo</span>}
                        {type.creatable ? null : <span className="set-badge rascunho">Fora do dropdown</span>}
                      </div>
                      <span className="admin-sub">
                        {type.subtypes.filter((s) => s.active).length} etapa(s) ativa(s)
                        {typeUsage ? ` · ${typeUsage.total} card(s), ${typeUsage.open} em aberto` : " · nenhum card"}
                      </span>
                    </div>
                    <div className="voc-actions">
                      <button
                        className="admin-btn ghost"
                        onClick={() => { setEditing(type.id); setTypeLabel(type.label); }}
                        disabled={busy || editing !== null}
                      >
                        Renomear
                      </button>
                      <button className="admin-btn ghost" onClick={() => void toggleTypeActive(type)} disabled={busy || editing !== null}>
                        {type.active ? "Desativar" : "Ativar"}
                      </button>
                    </div>
                  </>
                )}
              </header>

              <div className="voc-steps">
                {type.subtypes.map((step, index) =>
                  editing === step.id ? (
                    <StepEditor
                      key={step.id}
                      draft={stepDraft}
                      setDraft={setStepDraft}
                      busy={busy}
                      onCancel={closeEditor}
                      onSave={() => void saveStep(type)}
                    />
                  ) : (
                    <div
                      className={`voc-step ${step.active ? "" : "off"} ${dragId === step.id ? "dragging" : ""}`}
                      key={step.id}
                      draggable={editing === null}
                      onDragStart={(e) => { setDragId(step.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => setDragId(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); void reorder(type, step.id); }}
                    >
                      <span className="voc-step-pos" aria-hidden>{index + 1}</span>
                      <div className="voc-step-meta">
                        <div className="voc-type-titlerow">
                          <strong>{step.label}</strong>
                          <span className="voc-key">{step.key}</span>
                          {step.client_visible ? <span className="set-badge publicada">Cliente vê</span> : null}
                          {step.active ? null : <span className="set-badge rascunho">Inativa</span>}
                        </div>
                        <span className="admin-sub">
                          prazo +{step.lead_days}d · peso {step.progress_weight}
                          {step.default_assignee ? ` · ${step.default_assignee}` : ""}
                          {data.usage[usageKey(type.key, step.key)]
                            ? ` · ${data.usage[usageKey(type.key, step.key)].total} card(s)`
                            : ""}
                        </span>
                      </div>
                      <div className="voc-actions">
                        <button
                          className="admin-btn ghost"
                          onClick={() => { setEditing(step.id); setStepDraft(toStepDraft(step)); }}
                          disabled={busy || editing !== null}
                        >
                          Editar
                        </button>
                        <button
                          className="admin-btn ghost"
                          onClick={() => void patchStep(type.id, step.id, { active: !step.active })}
                          disabled={busy || editing !== null}
                        >
                          {step.active ? "Desativar" : "Ativar"}
                        </button>
                        {/* Excluir some assim que a etapa tem histórico: o servidor
                            recusaria (deletionProblem), e desativar é o caminho certo. */}
                        {data.usage[usageKey(type.key, step.key)] ? null : (
                          <button
                            className="admin-btn ghost"
                            onClick={() => void removeStep(type, step)}
                            disabled={busy || editing !== null}
                          >
                            Excluir
                          </button>
                        )}
                      </div>
                    </div>
                  ),
                )}

                {editing === `new:${type.id}` ? (
                  <StepEditor
                    draft={stepDraft}
                    setDraft={setStepDraft}
                    busy={busy}
                    onCancel={closeEditor}
                    onSave={() => void saveStep(type)}
                  />
                ) : (
                  <button
                    className="admin-btn ghost voc-add"
                    onClick={() => { setEditing(`new:${type.id}`); setStepDraft(EMPTY_STEP); }}
                    disabled={busy || editing !== null}
                  >
                    + Etapa em {type.label}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function StepEditor({
  draft,
  setDraft,
  busy,
  onCancel,
  onSave,
}: {
  draft: StepDraft;
  setDraft: (d: StepDraft) => void;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="voc-step-editor">
      <label className="admin-field">
        <span>Nome da etapa</span>
        <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Ex.: Edição" autoFocus />
      </label>
      <div className="admin-field-row">
        <label className="admin-field">
          <span>Prazo (dias)</span>
          <input
            type="number"
            min={0}
            value={draft.lead_days}
            onChange={(e) => setDraft({ ...draft, lead_days: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <label className="admin-field">
          <span>Peso no progresso</span>
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={draft.progress_weight}
            onChange={(e) => setDraft({ ...draft, progress_weight: Number(e.target.value) || 1 })}
          />
        </label>
        <label className="admin-field">
          <span>Responsável padrão</span>
          <input
            value={draft.default_assignee}
            onChange={(e) => setDraft({ ...draft, default_assignee: e.target.value })}
            placeholder="opcional"
          />
        </label>
      </div>
      <label className="admin-toggle">
        <input
          type="checkbox"
          checked={draft.client_visible}
          onChange={(e) => setDraft({ ...draft, client_visible: e.target.checked })}
        />
        <span className="sw" />
        <span>O cliente acompanha esta etapa no portal</span>
      </label>
      <div className="set-actions">
        <span className="admin-sub">A chave da etapa é derivada do nome e não muda depois.</span>
        <div className="kb-modal-actions-right">
          <button className="admin-btn ghost" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button className="admin-btn primary" onClick={onSave} disabled={busy || !draft.label.trim()}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
