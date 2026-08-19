"use client";

import { useState } from "react";
import { DASH_METRICS } from "./insights";
import type { CustomMetric, CustomMetricOp } from "@/lib/performancePrefs";
import type { MetaPostMetricKey } from "@/lib/windsor";

const OPS: CustomMetricOp[] = ["+", "-", "×", "÷"];

export default function CustomMetricsPanel({
  open,
  onClose,
  customMetrics,
  onSave,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  customMetrics: CustomMetric[];
  onSave: (metric: CustomMetric) => void;
  onDelete: (id: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [a, setA] = useState<MetaPostMetricKey>("custo");
  const [op, setOp] = useState<CustomMetricOp>("÷");
  const [b, setB] = useState<MetaPostMetricKey>("cliques");

  if (!open) return null;

  function save() {
    if (!label.trim()) return;
    onSave({ id: crypto.randomUUID(), label: label.trim(), a, op, b });
    setLabel("");
  }

  return (
    <div className="kb-modal-backdrop" onClick={onClose}>
      <div className="kb-modal perf-custommetrics" onClick={(e) => e.stopPropagation()}>
        <div className="kb-modal-head">
          <h2>Métricas personalizadas</h2>
          <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <p className="admin-sub">Combine duas métricas com uma operação simples — ex. Investimento ÷ Cliques = custo por clique.</p>

        <div className="perf-custommetric-form">
          <label className="admin-field"><span>Nome</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Custo por clique" maxLength={60} />
          </label>
          <div className="perf-custommetric-formula">
            <select value={a} onChange={(e) => setA(e.target.value as MetaPostMetricKey)}>
              {DASH_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <select value={op} onChange={(e) => setOp(e.target.value as CustomMetricOp)} className="perf-custommetric-op">
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={b} onChange={(e) => setB(e.target.value as MetaPostMetricKey)}>
              {DASH_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <button className="admin-btn primary" onClick={save} disabled={!label.trim()}>Salvar métrica</button>
        </div>

        {customMetrics.length > 0 ? (
          <ul className="perf-custommetric-list">
            {customMetrics.map((m) => (
              <li key={m.id}>
                <span><strong>{m.label}</strong><small>{DASH_METRICS.find((d) => d.key === m.a)?.label ?? m.a} {m.op} {DASH_METRICS.find((d) => d.key === m.b)?.label ?? m.b}</small></span>
                <button type="button" className="admin-btn ghost danger small" onClick={() => onDelete(m.id)}>Excluir</button>
              </li>
            ))}
          </ul>
        ) : <p className="admin-empty">Nenhuma métrica personalizada ainda.</p>}
      </div>
    </div>
  );
}
