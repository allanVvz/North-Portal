"use client";

import type { PerformanceEntitySummary } from "./insights";
import type { MetaPostMetricKey } from "@/lib/windsor";

export default function PerformanceEntityTable({
  level,
  rows,
  columns,
  selectedIds,
  loading,
  error,
  onToggle,
  onToggleAll,
  formatMetric,
}: {
  level: "adset" | "ad";
  rows: PerformanceEntitySummary[];
  columns: { key: MetaPostMetricKey; label: string }[];
  selectedIds: string[];
  loading: boolean;
  error: string;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  formatMetric: (value: number | undefined, key: MetaPostMetricKey, currency?: string) => string;
}) {
  if (loading) return <p className="perf-empty">Carregando {level === "adset" ? "conjuntos de anúncios" : "criativos"}…</p>;
  if (error) return <p className="admin-error">{error}</p>;
  if (!rows.length) return <p className="perf-empty">Selecione ao menos uma campanha para carregar {level === "adset" ? "seus conjuntos" : "seus criativos"}.</p>;
  const allSelected = rows.every((row) => selectedIds.includes(row.id));
  return (
    <div className="admin-table-wrap perf-table-wrap">
      <table className="admin-table perf-table perf-ads-table">
        <thead><tr>
          <th className="perf-select-cell"><input type="checkbox" aria-label="Selecionar todos os itens" checked={allSelected} onChange={onToggleAll} /></th>
          <th>Rede</th><th>Campanha</th>{level === "ad" ? <th>Conjunto</th> : null}<th>{level === "adset" ? "Conjunto de anúncios" : "Criativo"}</th><th>Objetivo</th>
          {columns.map((column) => <th key={column.key}>{column.label}</th>)}
        </tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.key} className={selectedIds.includes(row.id) ? "selected" : ""}>
            <td className="perf-select-cell"><input type="checkbox" aria-label={`Selecionar ${row.name}`} checked={selectedIds.includes(row.id)} onChange={() => onToggle(row.id)} /></td>
            <td>{row.platform}</td>
            <td className="perf-td-caption" title={row.campaignName}>{row.campaignName}</td>
            {level === "ad" ? <td className="perf-td-caption" title={row.adsetName}>{row.adsetName || "—"}</td> : null}
            <td className="perf-td-caption"><span className="perf-entity-name">{row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" /> : null}<span title={row.name}>{row.name}</span></span></td>
            <td className="admin-cell-muted">{row.objective || "—"}</td>
            {columns.map((column) => <td key={column.key}>{formatMetric(row.metrics[column.key], column.key, row.currency)}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

