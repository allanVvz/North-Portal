"use client";

import { useMemo, useState } from "react";
import { METRIC_DEFS } from "../metricDefs";
import { filterByClient } from "../approvalGroups";
import type { PublishedTask } from "@/lib/supabase";
import { kindDef, kindLabel, kindTone } from "@/lib/taskCatalog";

type ClientLite = { slug: string; name: string };

function tone(t: PublishedTask): string {
  const p = (t.payload ?? {}) as Record<string, unknown>;
  if (typeof p.barTone === "string") return p.barTone;
  return kindTone(t.kind);
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "agora";
  const h = Math.floor(diff / 3.6e6);
  if (h < 1) return "há minutos";
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

function filledMetrics(t: PublishedTask): { key: string; label: string; value: string }[] {
  return METRIC_DEFS
    .map((m) => ({ key: m.key, label: m.label, value: t.metrics[m.key] ?? "" }))
    .filter((m) => m.value.trim());
}

export default function PerformanceBoard({
  initial,
  clients,
  canEdit,
}: {
  initial: PublishedTask[];
  clients: ClientLite[];
  canEdit: boolean;
}) {
  const [tasks, setTasks] = useState<PublishedTask[]>(initial);
  const [clientFilter, setClientFilter] = useState("");
  const [editing, setEditing] = useState<PublishedTask | null>(null);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");

  // Only performance-eligible kinds (plano_acao, criativo) carry real-world
  // metrics — a published operacional/agendamento card doesn't belong here.
  const rows = useMemo(
    () => filterByClient(tasks, clientFilter).filter((t) => kindDef(t.kind).performance),
    [tasks, clientFilter],
  );

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2800);
  }

  async function saveMetrics(task: PublishedTask, values: Record<string, string>) {
    setBusy(task.id);
    try {
      const cleaned = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
      const res = await fetch(`/api/admin/metrics/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics: cleaned }),
      });
      if (!res.ok) throw new Error();
      const saved = await res.json();
      setTasks((rows_) => rows_.map((r) => (r.id === task.id ? { ...r, metrics: saved.metrics, metricsSource: saved.source, metricsUpdatedAt: saved.updated_at } : r)));
      flash("Métricas salvas.");
      setEditing(null);
    } catch {
      flash("Não foi possível salvar. Tente novamente.");
    }
    setBusy("");
  }

  return (
    <div className="ap">
      <div className="ap-filters">
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="ap-clientfilter">
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="admin-empty">Nenhum card publicado ainda.</p>
      ) : (
        <div className="ap-list">
          {rows.map((t) => {
            const filled = filledMetrics(t);
            return (
              <article className="ap-row" key={t.id}>
                <span className={`ap-thumb tone-${tone(t)}`} aria-hidden />
                <div className="ap-body">
                  <div className="ap-metaline">
                    <span className={`ap-type tone-${tone(t)}`}>{kindLabel(t.kind)}</span>
                    <span className="ap-client">{t.clientName}</span>
                  </div>
                  <p className="ap-title">{t.title}</p>
                  <p className="ap-sub">
                    Publicado{relTime(t.updated_at) ? ` · ${relTime(t.updated_at)}` : ""}
                    {t.metricsUpdatedAt ? ` · métricas atualizadas ${relTime(t.metricsUpdatedAt)}` : ""}
                  </p>
                  {filled.length > 0 ? (
                    <p className="perf-metrics-line">
                      {filled.map((m) => `${m.label}: ${m.value}`).join(" · ")}
                    </p>
                  ) : (
                    <p className="admin-sub">Sem métricas registradas ainda.</p>
                  )}
                </div>
                <div className="ap-actions">
                  <button className={`admin-btn ${canEdit ? "primary" : "ghost"}`} disabled={busy === t.id} onClick={() => setEditing(t)}>
                    {canEdit ? "Editar métricas" : "Ver métricas"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing ? (
        <MetricsModal
          task={editing}
          busy={busy === editing.id}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSave={(values) => void saveMetrics(editing, values)}
        />
      ) : null}

      {toast ? <div className="ap-toast" role="status">{toast}</div> : null}
    </div>
  );
}

function MetricsModal(props: {
  task: PublishedTask;
  busy: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSave: (values: Record<string, string>) => void;
}) {
  const { task, busy, canEdit, onClose, onSave } = props;
  const [values, setValues] = useState<Record<string, string>>(task.metrics);

  return (
    <div className="kb-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="tm tone-neutral perf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head tm-head-plain">
          <div>
            <h2>Métricas</h2>
            <p className="admin-sub">{task.title} · {task.clientName}</p>
          </div>
          <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <div className="tm-grid">
          {METRIC_DEFS.map((m) => (
            <label className="admin-field" key={m.key}>
              <span>{m.label}{m.unit ? ` (${m.unit})` : ""}</span>
              <input
                value={values[m.key] ?? ""}
                disabled={!canEdit}
                onChange={(e) => setValues((v) => ({ ...v, [m.key]: e.target.value }))}
                placeholder="—"
              />
            </label>
          ))}
        </div>
        <p className="admin-sub perf-hint">
          {canEdit
            ? "Preenchimento manual por enquanto — integração automática com APIs de anúncios (Meta) fica para uma próxima fase."
            : "Modo visualização — apenas gerentes registram métricas."}
        </p>
        <div className="kb-modal-actions">
          <span />
          <div className="kb-modal-actions-right">
            <button className="admin-btn ghost" onClick={onClose} disabled={busy}>{canEdit ? "Cancelar" : "Fechar"}</button>
            {canEdit ? (
              <button className="admin-btn primary" onClick={() => onSave(values)} disabled={busy}>
                {busy ? "Salvando…" : "Salvar métricas"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
