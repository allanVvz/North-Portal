"use client";

import { Fragment } from "react";
import type { AdSummary, CampaignSummary, PerformanceEntitySummary } from "./insights";
import { OBJECTIVE_LABEL, PLATFORM_LABEL, metricValue, platformTone } from "./performanceLabels";
import type { CAMPAIGN_METRIC_COLUMNS, SortDir } from "@/lib/performancePrefs";
import {
  AD_SOURCE_TAGS, CAMPAIGN_BLOCKS, CAMPAIGN_BLOCK_LABEL,
  type AdSourceTag, type CampaignBlock, type PerformanceEntityLevel,
} from "@/lib/performanceTemplates";
import type { MetaPostMetricKey } from "@/lib/windsor";

type Column = { key: MetaPostMetricKey; label: string };
type AdRowsState = { loading: boolean; error: string; ads: AdSummary[] };
type ColumnKind = Partial<Record<MetaPostMetricKey, "money" | "percent" | "decimal">>;

// Tabela Campanhas/Conjuntos/Criativos compartilhada entre Analytics e
// Aquisição — extraída de PerformanceDashboard.tsx (que tinha essa tabela
// inline + PerformanceEntityTable.tsx separado para adset/ad) e de
// CreativeTable (Aquisição, mais simples, sem sort/colunas/CSV). As duas
// telas agora renderizam este mesmo componente, alimentado pelo mesmo
// estado compartilhado (usePerformanceWorkspace).
export default function PerformanceCampaignTable({
  level,
  onChangeLevel,
  campaigns,
  campaignTotal,
  entityRows,
  columns,
  allColumns,
  columnKind,
  visibleColumns,
  onToggleColumn,
  columnsMenuOpen,
  onToggleColumnsMenu,
  sortKey,
  sortDir,
  onToggleSort,
  selectedCampaignIds,
  selectedAdsetIds,
  selectedAdIds,
  onToggleCampaign,
  onToggleAllCampaigns,
  onToggleEntity,
  onToggleAllEntities,
  entityLoading,
  entityError,
  expanded,
  adRowsFor,
  onToggleExpand,
  onExportCsv,
  onLoadMore,
  categoryNote,
  canEditTemplate,
  campaignBlocks,
  adSourceTags,
  onSetCampaignBlock,
  onSetAdSourceTag,
  suggestBlock,
}: {
  level: PerformanceEntityLevel;
  onChangeLevel: (level: PerformanceEntityLevel) => void;
  campaigns: CampaignSummary[];
  campaignTotal: number;
  entityRows: PerformanceEntitySummary[];
  columns: Column[];
  allColumns: typeof CAMPAIGN_METRIC_COLUMNS;
  columnKind: ColumnKind;
  visibleColumns: MetaPostMetricKey[];
  onToggleColumn: (key: MetaPostMetricKey) => void;
  columnsMenuOpen: boolean;
  onToggleColumnsMenu: () => void;
  sortKey: MetaPostMetricKey;
  sortDir: SortDir;
  onToggleSort: (key: MetaPostMetricKey) => void;
  selectedCampaignIds: string[];
  selectedAdsetIds: string[];
  selectedAdIds: string[];
  onToggleCampaign: (id: string) => void;
  onToggleAllCampaigns: () => void;
  onToggleEntity: (id: string) => void;
  onToggleAllEntities: () => void;
  entityLoading: boolean;
  entityError: string;
  expanded: string | null;
  adRowsFor: (campaign: CampaignSummary) => AdRowsState | undefined;
  onToggleExpand: (campaign: CampaignSummary) => void;
  onExportCsv: () => void;
  onLoadMore: () => void;
  categoryNote: boolean;
  canEditTemplate: boolean;
  campaignBlocks: Record<string, CampaignBlock>;
  adSourceTags: Record<string, AdSourceTag>;
  onSetCampaignBlock: (campaignId: string, block: CampaignBlock | "") => void;
  onSetAdSourceTag: (adId: string, tag: AdSourceTag | "") => void;
  suggestBlock: (objective?: string | null, optimizationGoal?: string | null, name?: string | null) => CampaignBlock;
}) {
  const formatMetric = (value: number | undefined, key: MetaPostMetricKey, currency?: string) => metricValue(value, columnKind[key] ?? "number", currency);
  const selectedEntityIds = level === "adset" ? selectedAdsetIds : selectedAdIds;
  const itemCount = level === "campaign" ? campaignTotal : entityRows.length;
  // Colunas extras de tagueamento do template: "Bloco" nas campanhas, "#"
  // (fonte) nos criativos. Só aparecem para quem pode editar template.
  const blockCol = canEditTemplate && level === "campaign" ? 1 : 0;
  const tagCol = canEditTemplate && level === "ad" ? 1 : 0;

  return (
    <div className="perf-card">
      <div className="perf-card-head">
        <div>
          <h3>{level === "campaign" ? "Campanhas" : level === "adset" ? "Conjuntos de anúncios" : "Criativos"}</h3>
          <p className="perf-card-sub">
            {itemCount} item{itemCount === 1 ? "" : "s"} por plataforma no período
            {categoryNote ? " · sempre em Ads (campanha é um conceito de mídia paga)" : ""}
          </p>
        </div>
        <div className="perf-table-actions">
          <div className="perf-level-toggle" role="group" aria-label="Nível da análise">
            <button type="button" className={level === "campaign" ? "on" : ""} onClick={() => onChangeLevel("campaign")}>Campanhas</button>
            <button type="button" className={level === "adset" ? "on" : ""} onClick={() => onChangeLevel("adset")}>Conjuntos</button>
            <button type="button" className={level === "ad" ? "on" : ""} onClick={() => onChangeLevel("ad")}>Criativos</button>
          </div>
          <div className="perf-columns-menu">
            <button className="admin-btn ghost small" onClick={onToggleColumnsMenu}>Colunas ({columns.length})</button>
            {columnsMenuOpen ? (
              <div className="perf-columns-dropdown">
                {allColumns.map((c) => (
                  <label key={c.key} className="perf-columns-item">
                    <input type="checkbox" checked={visibleColumns.includes(c.key)} onChange={() => onToggleColumn(c.key)} />
                    {c.label}
                  </label>
                ))}
                <button className="admin-btn ghost small perf-columns-close" onClick={onToggleColumnsMenu}>Fechar</button>
              </div>
            ) : null}
          </div>
          <button className="admin-btn ghost small" onClick={onExportCsv} disabled={campaignTotal === 0}>Exportar CSV</button>
        </div>
      </div>

      {level !== "campaign" ? (
        entityLoading ? <p className="perf-empty">Carregando {level === "adset" ? "conjuntos de anúncios" : "criativos"}…</p>
        : entityError ? <p className="admin-error">{entityError}</p>
        : !entityRows.length ? <p className="perf-empty">Selecione ao menos uma campanha para carregar {level === "adset" ? "seus conjuntos" : "seus criativos"}.</p>
        : (
          <div className="admin-table-wrap perf-table-wrap">
            <table className="admin-table perf-table perf-ads-table">
              <thead><tr>
                <th className="perf-select-cell"><input type="checkbox" aria-label="Selecionar todos os itens" checked={entityRows.every((row) => selectedEntityIds.includes(row.id))} onChange={onToggleAllEntities} /></th>
                <th>Rede</th><th>Campanha</th>{level === "ad" ? <th>Conjunto</th> : null}<th>{level === "adset" ? "Conjunto de anúncios" : "Criativo"}</th><th>Objetivo</th>
                {tagCol ? <th title="Fonte de tráfego da conversão (#1/#2/#3)">#</th> : null}
                {columns.map((column) => <th key={column.key}>{column.label}</th>)}
              </tr></thead>
              <tbody>{entityRows.map((row) => (
                <tr key={row.key} className={selectedEntityIds.includes(row.id) ? "selected" : ""}>
                  <td className="perf-select-cell"><input type="checkbox" aria-label={`Selecionar ${row.name}`} checked={selectedEntityIds.includes(row.id)} onChange={() => onToggleEntity(row.id)} /></td>
                  <td>{row.platform}</td>
                  <td className="perf-td-caption" title={row.campaignName}>{row.campaignName}</td>
                  {level === "ad" ? <td className="perf-td-caption" title={row.adsetName}>{row.adsetName || "—"}</td> : null}
                  <td className="perf-td-caption"><span className="perf-entity-name">{row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" /> : null}<span title={row.name}>{row.name}</span></span></td>
                  <td className="admin-cell-muted">{row.objective ? OBJECTIVE_LABEL[row.objective] ?? row.objective : "—"}</td>
                  {tagCol ? (
                    <td>
                      <select
                        className="perf-tag-select"
                        aria-label={`Fonte de ${row.name}`}
                        value={adSourceTags[row.id] ?? ""}
                        onChange={(e) => onSetAdSourceTag(row.id, e.target.value as AdSourceTag | "")}
                      >
                        <option value="">—</option>
                        {AD_SOURCE_TAGS.map((t) => <option key={t} value={t}>#{t}</option>)}
                      </select>
                    </td>
                  ) : null}
                  {columns.map((column) => <td key={column.key}>{formatMetric(row.metrics[column.key], column.key, row.currency)}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )
      ) : (
        <>
          <div className="admin-table-wrap perf-table-wrap">
            <table className="admin-table perf-table perf-ads-table">
              <thead>
                <tr>
                  <th className="perf-select-cell"><input type="checkbox" aria-label="Selecionar todas as campanhas" checked={campaigns.length > 0 && campaigns.every((campaign) => campaign.campaignId && selectedCampaignIds.includes(`${campaign.accountId}:${campaign.campaignId}`))} onChange={onToggleAllCampaigns} /></th>
                  <th aria-label="Expandir" />
                  <th>Plataforma</th><th>Conta</th><th>Campanha</th><th>Objetivo</th>
                  {blockCol ? <th title="Bloco de objetivo no relatório de anúncios">Bloco</th> : null}
                  {columns.map((c) => (
                    <th key={c.key} className="perf-th-sort" onClick={() => onToggleSort(c.key)} aria-sort={sortKey === c.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      {c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const compositeId = `${c.accountId}:${c.campaignId}`;
                  const ads = adRowsFor(c);
                  const isExpanded = expanded === c.key;
                  return (
                    <Fragment key={c.key}>
                      <tr className={`perf-row-link ${selectedCampaignIds.includes(compositeId) ? "selected" : ""}`} onClick={() => onToggleExpand(c)}>
                        <td className="perf-select-cell" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Selecionar campanha ${c.caption}`} checked={selectedCampaignIds.includes(compositeId)} disabled={!c.campaignId} onChange={() => onToggleCampaign(compositeId)} /></td>
                        <td className="perf-expand-cell">{c.campaignId ? (isExpanded ? "▾" : "▸") : ""}</td>
                        <td><span className={`kb-type ${platformTone(c.platform)}`}>{PLATFORM_LABEL[c.platform]}</span></td>
                        <td className="admin-cell-muted">{c.accountName}</td>
                        <td className="perf-td-caption" title={c.caption}>{c.caption || "—"}</td>
                        <td className="admin-cell-muted">{c.objective ? OBJECTIVE_LABEL[c.objective] ?? c.objective : "—"}</td>
                        {blockCol ? (
                          <td onClick={(event) => event.stopPropagation()}>
                            {c.campaignId ? (
                              <select
                                className="perf-tag-select"
                                aria-label={`Bloco da campanha ${c.caption}`}
                                value={campaignBlocks[c.campaignId] ?? suggestBlock(c.objective, undefined, c.caption)}
                                onChange={(e) => onSetCampaignBlock(c.campaignId as string, e.target.value as CampaignBlock | "")}
                              >
                                {CAMPAIGN_BLOCKS.map((b) => <option key={b} value={b}>{CAMPAIGN_BLOCK_LABEL[b]}</option>)}
                              </select>
                            ) : "—"}
                          </td>
                        ) : null}
                        {columns.map((col) => (
                          <td key={col.key}>{formatMetric(c.metrics[col.key], col.key, c.currency)}</td>
                        ))}
                      </tr>
                      {isExpanded ? (
                        <tr className="perf-ad-subrow">
                          <td colSpan={6 + blockCol + columns.length}>
                            {!c.campaignId ? (
                              <p className="perf-empty">Detalhamento por anúncio disponível apenas para campanhas da conexão direta com a Meta.</p>
                            ) : ads?.loading ? (
                              <p className="perf-empty">Carregando anúncios…</p>
                            ) : ads?.error ? (
                              <p className="admin-error">{ads.error}</p>
                            ) : ads && ads.ads.length === 0 ? (
                              <p className="perf-empty">Nenhum anúncio individual retornado para esta campanha no período.</p>
                            ) : ads ? (
                              <table className="admin-table perf-ad-subtable">
                                <thead>
                                  <tr>
                                    <th>Anúncio</th><th>Alcance</th><th>Impressões</th><th>Engajamento</th>
                                    <th>Cliques link</th><th>CTR</th><th>CPC</th><th>Investimento</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {ads.ads.map((ad) => (
                                    <tr key={ad.key}>
                                      <td className="perf-ad-name-cell">
                                        {ad.thumbnailUrl ? <img className="perf-ad-thumb" src={ad.thumbnailUrl} alt="" /> : null}
                                        <span title={ad.adName}>{ad.adName}</span>
                                      </td>
                                      <td>{metricValue(ad.metrics.alcance)}</td>
                                      <td>{metricValue(ad.metrics.impressoes)}</td>
                                      <td>{metricValue(ad.metrics.engajamento)}</td>
                                      <td>{metricValue(ad.metrics.cliquesLink)}</td>
                                      <td>{metricValue(ad.metrics.ctr, "percent")}</td>
                                      <td>{metricValue(ad.metrics.cpc, "money", ad.currency)}</td>
                                      <td>{metricValue(ad.metrics.custo, "money", ad.currency)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {campaigns.length === 0 ? <tr><td colSpan={6 + blockCol + columns.length} className="perf-empty">Nenhum anúncio pago no período com os filtros atuais.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {campaignTotal > campaigns.length ? (
            <div className="perf-pagination">
              <button className="admin-btn ghost" onClick={onLoadMore}>
                Carregar mais ({campaigns.length} de {campaignTotal})
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
