"use client";

import { useEffect, useRef, useState } from "react";
import DateRangeField from "../DateRangeField";
import PerformanceCompositeFilter from "./PerformanceCompositeFilter";
import { ACQUISITION_SECTIONS, ANALYTICS_SECTIONS, OBJECTIVE_LABEL, PLATFORM_LABEL } from "./performanceLabels";
import type { PerformanceWorkspace } from "./usePerformanceWorkspace";

const DATE_PRESETS = [7, 30, 90];

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed ? <path d="M3 3l18 18" /> : null}
    </svg>
  );
}

// Topo compartilhado entre Analytics e Aquisição (Parte 1/6) — renderizado
// uma única vez em PerformanceScreen.tsx, acima de qualquer uma das duas
// telas, para que trocar de aba nunca duplique nem desmonte o filtro.
export default function PerformanceToolbar({ workspace, view }: { workspace: PerformanceWorkspace; view: "dashboard" | "acquisition" }) {
  const {
    clients, canEdit,
    preset, customRangeValid, period, setCustomRange, choosePreset,
    data, loading, load,
    platformOptions, objectiveOptions,
    filters, changeFilters,
    campaignOptions, adsetOptions, selectedCampaignIds, selectedAdsetIds, onCampaignChange, onAdsetChange, adsetDisabled,
    entityLevel, selectedAdIds,
    templates, activeTemplateId, activeTemplateConfig, templateDirty, templateSaving, templateError,
    templateSaveRequest, requestTemplateSave, applyTemplate, saveTemplate,
    hiddenSections, toggleSectionVisibility,
  } = workspace;
  void activeTemplateConfig;

  const [visibilityMenuOpen, setVisibilityMenuOpen] = useState(false);
  const visibilityRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!visibilityMenuOpen) return;
    const close = (event: MouseEvent) => { if (visibilityRef.current && !visibilityRef.current.contains(event.target as Node)) setVisibilityMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setVisibilityMenuOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [visibilityMenuOpen]);

  const comparisonIds = entityLevel === "campaign" ? selectedCampaignIds : entityLevel === "adset" ? selectedAdsetIds : selectedAdIds;
  const activeEntityLabel = entityLevel === "campaign" ? "campanha" : entityLevel === "adset" ? "conjunto" : "criativo";
  const hasSelectionContext = comparisonIds.length > 0;
  const selectionCount = comparisonIds.length;

  const screenKey = view === "dashboard" ? "analytics" : "acquisition";
  const sections = view === "dashboard" ? ANALYTICS_SECTIONS : ACQUISITION_SECTIONS;
  const hidden = hiddenSections[screenKey];

  return (
    <>
      <div className="perf-analysis-toolbar">
        <DateRangeField
          from={period.from}
          to={period.to}
          onChange={setCustomRange}
          presets={DATE_PRESETS}
          activePreset={customRangeValid ? null : preset}
          onPreset={(days) => choosePreset(days as 7 | 30 | 90)}
        />
        <PerformanceCompositeFilter
          clients={clients}
          platformOptions={platformOptions}
          platformLabel={PLATFORM_LABEL}
          objectiveOptions={objectiveOptions}
          objectiveLabel={OBJECTIVE_LABEL}
          filters={filters}
          onFiltersChange={changeFilters}
          campaignOptions={campaignOptions}
          adsetOptions={adsetOptions}
          campaignSelected={selectedCampaignIds}
          adsetSelected={selectedAdsetIds}
          onCampaignChange={onCampaignChange}
          onAdsetChange={onAdsetChange}
          adsetDisabled={adsetDisabled}
          templates={templates}
          activeTemplateId={activeTemplateId}
          templateDirty={templateDirty}
          saveRequestToken={templateSaveRequest}
          canSaveTemplate={canEdit}
          templateSaving={templateSaving}
          onTemplateSelect={applyTemplate}
          onTemplateSave={saveTemplate}
        />
        {hasSelectionContext ? (
          <div className="perf-selection-compact" title={`${selectionCount} ${activeEntityLabel}${selectionCount === 1 ? "" : "s"} selecionado${selectionCount === 1 ? "" : "s"}`}>
            <strong aria-label={`${selectionCount} seleções`}>{selectionCount}</strong>
          </div>
        ) : null}
        <div className="perf-chart-settings" ref={visibilityRef}>
          <button
            type="button"
            className="perf-toolbar-icon"
            aria-label="Mostrar/esconder gráficos"
            title="Mostrar/esconder gráficos"
            aria-expanded={visibilityMenuOpen}
            onClick={() => setVisibilityMenuOpen((v) => !v)}
          >
            <EyeIcon crossed={hidden.size > 0} />
          </button>
          {visibilityMenuOpen ? (
            <div className="perf-chart-settings-menu perf-visibility-menu">
              <div className="perf-settings-menu-head"><strong>Gráficos</strong><small>Escolha o que aparece na tela</small></div>
              <div className="perf-settings-options">
                {sections.map((section) => {
                  const isHidden = hidden.has(section.key);
                  return (
                    <button type="button" key={section.key} className={`perf-visibility-row${isHidden ? "" : " on"}`} onClick={() => toggleSectionVisibility(screenKey, section.key)}>
                      <EyeIcon crossed={isHidden} />
                      <span>{section.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
        {canEdit ? (
          <button
            type="button"
            className={`perf-toolbar-icon perf-save-template${templateDirty ? " is-dirty" : ""}`}
            aria-label={templateDirty ? "Salvar alterações do template" : "Salvar template"}
            title={templateDirty ? "Salvar alterações do template" : "Salvar template"}
            onClick={requestTemplateSave}
            disabled={templateSaving}
          >
            <svg viewBox="0 0 24 24" aria-hidden><path d="M5 4h11l3 3v13H5zM8 4v6h8V4M8 20v-6h8v6" /></svg>
          </button>
        ) : null}
        <button
          type="button"
          className={`perf-toolbar-icon perf-refresh${loading ? " is-loading" : ""}`}
          aria-label={loading ? "Atualizando dados" : "Atualizar dados"}
          title="Atualizar dados"
          onClick={() => void load(true)}
          disabled={loading || Boolean(data?.demo)}
        >
          <svg viewBox="0 0 24 24" aria-hidden><path d="M19 7v5h-5M5 17v-5h5M18 11a7 7 0 0 0-12-3L5 9m1 4a7 7 0 0 0 12 3l1-1" /></svg>
        </button>
        <div className="kb-spacer" />
        {data?.demo ? <span className="perf-demo-chip">Dados de demonstração</span> : null}
        {data?.stale ? <span className="perf-demo-chip perf-stale-chip" title={data.error}>Dados desatualizados</span> : null}
      </div>
      {templateError ? <p className="admin-error perf-template-error">{templateError}</p> : null}
    </>
  );
}
