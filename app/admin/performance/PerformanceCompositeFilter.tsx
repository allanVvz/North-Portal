"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PerformanceTemplate } from "@/lib/performanceTemplates";
import type { MetaPlatform } from "@/lib/windsor";

export type PerfCategory = "ads" | "organico" | "ambos";
export type PerfFilterAttr = "cliente" | "categoria" | "rede" | "objetivo";
export type PerfActiveFilter = { attr: PerfFilterAttr; value: string; label: string };
export type ChecklistOption = { key: string; label: string };
type PerfMenuAttr = "template" | "cliente" | "categoria" | "rede" | "objetivo" | "campanha" | "conjunto";

const CATEGORY_OPTIONS: { value: PerfCategory; label: string }[] = [
  { value: "ads", label: "Ads" },
  { value: "organico", label: "Orgânico" },
  { value: "ambos", label: "Ambos" },
];

const ATTR_DEFS: { key: PerfMenuAttr; label: string; icon: string }[] = [
  { key: "template", label: "Template", icon: "▦" },
  { key: "cliente", label: "Cliente", icon: "◔" },
  { key: "categoria", label: "Categoria", icon: "◧" },
  { key: "rede", label: "Rede", icon: "◑" },
  { key: "objetivo", label: "Objetivo", icon: "◎" },
  { key: "campanha", label: "Campanha", icon: "◫" },
  { key: "conjunto", label: "Conjunto de anúncios", icon: "▦" },
];
const FILTER_LABEL: Record<PerfFilterAttr, string> = {
  cliente: "Cliente",
  categoria: "Categoria",
  rede: "Rede",
  objetivo: "Objetivo",
};

// Single composite filter bar shared by Analytics e Aquisição: junta o
// padrão single-value por chip (template/cliente/categoria/rede/objetivo)
// com o padrão multi-select por checkbox que a Aquisição já usava para
// campanha/conjunto — os dois passam a viver na mesma caixa/estado
// compartilhado (usePerformanceWorkspace).
export default function PerformanceCompositeFilter({
  clients,
  platformOptions,
  platformLabel,
  objectiveOptions,
  objectiveLabel,
  filters,
  onFiltersChange,
  campaignOptions,
  adsetOptions,
  campaignSelected,
  adsetSelected,
  onCampaignChange,
  onAdsetChange,
  adsetDisabled,
  templates,
  activeTemplateId,
  templateDirty,
  saveRequestToken,
  canSaveTemplate,
  templateSaving,
  onTemplateSelect,
  onTemplateSave,
}: {
  clients: { slug: string; name: string }[];
  platformOptions: MetaPlatform[];
  platformLabel: Record<MetaPlatform, string>;
  objectiveOptions: string[];
  objectiveLabel: Record<string, string>;
  filters: PerfActiveFilter[];
  onFiltersChange: (next: PerfActiveFilter[]) => void;
  campaignOptions: ChecklistOption[];
  adsetOptions: ChecklistOption[];
  campaignSelected: string[];
  adsetSelected: string[];
  onCampaignChange: (next: string[]) => void;
  onAdsetChange: (next: string[]) => void;
  adsetDisabled: boolean;
  templates: PerformanceTemplate[];
  activeTemplateId: string;
  templateDirty: boolean;
  saveRequestToken: number;
  canSaveTemplate: boolean;
  templateSaving: boolean;
  onTemplateSelect: (template: PerformanceTemplate) => void;
  onTemplateSave: (input: { name: string; overwrite: boolean }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pendingAttr, setPendingAttr] = useState<PerfMenuAttr | null>(null);
  const [templateQuery, setTemplateQuery] = useState("");
  const [checklistQuery, setChecklistQuery] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [saved, setSaved] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const savedTimerRef = useRef<number | null>(null);
  const handledSaveRequestRef = useRef(0);
  const activeTemplate = templates.find((template) => template.id === activeTemplateId);

  useEffect(() => {
    if (!saveRequestToken || handledSaveRequestRef.current === saveRequestToken) return;
    handledSaveRequestRef.current = saveRequestToken;
    setOpen(true);
    setPendingAttr("template");
    setTemplateQuery("");
    setTemplateName(activeTemplate?.scope === "builtin" ? `${activeTemplate.name} — cópia` : activeTemplate?.name ?? "");
    setSaveOpen(true);
  }, [saveRequestToken, activeTemplate]);

  useEffect(() => () => {
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setPendingAttr(null);
        setSaveOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setPendingAttr(null);
        setSaveOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const valueOptions = useMemo((): { value: string; label: string }[] => {
    if (pendingAttr === "cliente") return clients.map((client) => ({ value: client.slug, label: client.name }));
    if (pendingAttr === "categoria") return CATEGORY_OPTIONS;
    if (pendingAttr === "rede") return platformOptions.map((platform) => ({ value: platform, label: platformLabel[platform] }));
    return [];
  }, [pendingAttr, clients, platformOptions, platformLabel]);

  const objectiveValues = useMemo(() => filters.find((f) => f.attr === "objetivo")?.value.split(",").filter(Boolean) ?? [], [filters]);

  const visibleTemplates = useMemo(() => {
    const query = templateQuery.trim().toLocaleLowerCase("pt-BR");
    return query
      ? templates.filter((template) => `${template.name} ${template.description}`.toLocaleLowerCase("pt-BR").includes(query))
      : templates;
  }, [templateQuery, templates]);

  const visibleObjectives = useMemo(() => {
    const query = checklistQuery.trim().toLocaleLowerCase("pt-BR");
    return objectiveOptions.filter((value) => !query || (objectiveLabel[value] ?? value).toLocaleLowerCase("pt-BR").includes(query));
  }, [checklistQuery, objectiveOptions, objectiveLabel]);

  const visibleCampaigns = useMemo(() => {
    const query = checklistQuery.trim().toLocaleLowerCase("pt-BR");
    return campaignOptions.filter((option) => !query || option.label.toLocaleLowerCase("pt-BR").includes(query));
  }, [checklistQuery, campaignOptions]);
  const visibleAdsets = useMemo(() => {
    const query = checklistQuery.trim().toLocaleLowerCase("pt-BR");
    return adsetOptions.filter((option) => !query || option.label.toLocaleLowerCase("pt-BR").includes(query));
  }, [checklistQuery, adsetOptions]);

  const singleValueAttrs: PerfFilterAttr[] = ["cliente", "categoria", "rede"];
  const availableAttrs = ATTR_DEFS.filter((attr) => {
    if (attr.key === "template" || attr.key === "objetivo" || attr.key === "campanha" || attr.key === "conjunto") return true;
    return !filters.some((filter) => filter.attr === (attr.key as PerfFilterAttr) && singleValueAttrs.includes(attr.key as PerfFilterAttr));
  });
  const canOverwrite = Boolean(activeTemplate && activeTemplate.scope !== "builtin" && canSaveTemplate);

  function openMenu(attr: PerfMenuAttr) {
    setPendingAttr(attr);
    setChecklistQuery("");
  }

  function addFilter(attr: Exclude<PerfFilterAttr, "objetivo">, value: string, label: string) {
    onFiltersChange([...filters.filter((filter) => filter.attr !== attr), { attr, value, label }]);
    setPendingAttr(null);
    setOpen(false);
  }

  function removeFilter(attr: PerfFilterAttr) {
    onFiltersChange(filters.filter((filter) => filter.attr !== attr));
  }

  function toggleObjective(value: string) {
    const next = objectiveValues.includes(value) ? objectiveValues.filter((item) => item !== value) : [...objectiveValues, value];
    const others = filters.filter((filter) => filter.attr !== "objetivo");
    if (!next.length) { onFiltersChange(others); return; }
    const labels = next.map((item) => objectiveLabel[item] ?? item);
    onFiltersChange([...others, { attr: "objetivo", value: next.join(","), label: labels.length > 2 ? `${labels.slice(0, 2).join(", ")} +${labels.length - 2}` : labels.join(", ") }]);
  }

  function toggleChecklist(current: string[], onChange: (next: string[]) => void, key: string) {
    onChange(current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function chooseTemplate(template: PerformanceTemplate) {
    onTemplateSelect(template);
    setTemplateQuery("");
    setPendingAttr(null);
    setOpen(false);
  }

  async function submitSave(overwrite: boolean) {
    const ok = await onTemplateSave({ name: templateName, overwrite });
    if (!ok) return;
    setSaveOpen(false);
    setSaved(true);
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => setSaved(false), 2400);
  }

  const chipLabel = (items: string[], source: ChecklistOption[], plural: string) => items.length === 1
    ? source.find((option) => option.key === items[0])?.label ?? "1 selecionado"
    : `${items.length} ${plural}`;

  return (
    <div className="kb-searchbar perf-filterbar perf-analysis-filterbar" ref={ref}>
      <div className="kb-searchbar-box" onClick={() => setOpen(true)}>
        {activeTemplate ? (
          <span className="kb-filterchip perf-template-chip">
            <b>Template:</b> {activeTemplate.name}{templateDirty ? <em>Alterado</em> : null}
          </span>
        ) : null}
        {filters.map((filter) => (
          <span className="kb-filterchip" key={filter.attr}>
            <b>{FILTER_LABEL[filter.attr]}:</b> {filter.label}
            <button type="button" aria-label={`Remover filtro ${FILTER_LABEL[filter.attr]}`} onClick={(event) => { event.stopPropagation(); removeFilter(filter.attr); }}>✕</button>
          </span>
        ))}
        {campaignSelected.length ? <span className="kb-filterchip"><b>Campanha:</b> {chipLabel(campaignSelected, campaignOptions, "selecionadas")}<button type="button" aria-label="Limpar campanhas" onClick={(event) => { event.stopPropagation(); onCampaignChange([]); }}>✕</button></span> : null}
        {adsetSelected.length ? <span className="kb-filterchip"><b>Conjunto:</b> {chipLabel(adsetSelected, adsetOptions, "selecionados")}<button type="button" aria-label="Limpar conjuntos de anúncios" onClick={(event) => { event.stopPropagation(); onAdsetChange([]); }}>✕</button></span> : null}
        {!activeTemplate && filters.length === 0 && !campaignSelected.length && !adsetSelected.length ? (
          <span className="doc-filterbar-placeholder">Template, cliente, categoria, rede, objetivo, campanha…</span>
        ) : null}
      </div>

      {open ? (
        <div className="kb-searchbar-panel perf-analysis-filter-panel">
          {pendingAttr === "template" ? (
            <>
              <div className="kb-searchbar-panelhead">
                <button type="button" className="kb-searchbar-back" onClick={() => { setPendingAttr(null); setSaveOpen(false); }}>‹ Voltar</button>
                <span>Template</span>
              </div>
              <input className="perf-analysis-search" value={templateQuery} onChange={(event) => setTemplateQuery(event.target.value)} placeholder="Buscar template…" aria-label="Buscar template" />
              <div className="perf-composite-template-list" role="listbox" aria-label="Templates de Performance">
                {visibleTemplates.map((template) => (
                  <button key={template.id} type="button" role="option" aria-selected={template.id === activeTemplateId} className={template.id === activeTemplateId ? "on" : ""} onClick={() => chooseTemplate(template)}>
                    <span className="perf-template-radio" aria-hidden />
                    <span><strong>{template.name}</strong><small>{template.description}</small></span>
                    <small>{template.scope === "builtin" ? "Nativo" : "Equipe"}</small>
                  </button>
                ))}
                {visibleTemplates.length === 0 ? <p className="admin-sub kb-searchbar-empty">Nenhum template encontrado.</p> : null}
              </div>
              <div className="perf-composite-save">
                {!canSaveTemplate ? <small>Somente gerentes podem salvar templates para a equipe.</small> : !saveOpen ? (
                  <small>{saved ? "Template salvo para toda a equipe ✓" : "Use o botão redondo de salvar ao lado dos filtros para criar ou atualizar um template."}</small>
                ) : (
                  <div className="perf-analysis-save-form">
                    <label><span>Nome do template da equipe</span><input autoFocus value={templateName} onChange={(event) => setTemplateName(event.target.value)} maxLength={60} placeholder="Ex.: Conversas · mensal" aria-label="Nome do template" /></label>
                    <div className="perf-template-save-actions">
                      <button type="button" className="admin-btn ghost small" onClick={() => setSaveOpen(false)}>Cancelar</button>
                      {canOverwrite ? <button type="button" className="admin-btn ghost small" disabled={templateSaving || templateName.trim().length < 2} onClick={() => void submitSave(true)}>Atualizar equipe</button> : null}
                      <button type="button" className="admin-btn primary small" disabled={templateSaving || templateName.trim().length < 2} onClick={() => void submitSave(false)}>{templateSaving ? "Salvando…" : "Salvar para equipe"}</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : pendingAttr === "objetivo" ? (
            <>
              <div className="kb-searchbar-panelhead">
                <button type="button" className="kb-searchbar-back" onClick={() => setPendingAttr(null)}>‹ Voltar</button>
                <span>Objetivo</span>
              </div>
              <input className="acq-filter-search" autoFocus type="search" value={checklistQuery} onChange={(event) => setChecklistQuery(event.target.value)} placeholder="Buscar objetivo…" aria-label="Buscar objetivo" />
              <div className="acq-filter-options">
                {visibleObjectives.map((value) => (
                  <label className="acq-filter-option" key={value}><input type="checkbox" checked={objectiveValues.includes(value)} onChange={() => toggleObjective(value)} /><span>{objectiveLabel[value] ?? value}</span></label>
                ))}
                {!visibleObjectives.length ? <div className="acq-filter-empty">Nenhum objetivo com dados no período.</div> : null}
              </div>
            </>
          ) : pendingAttr === "campanha" ? (
            <>
              <div className="kb-searchbar-panelhead">
                <button type="button" className="kb-searchbar-back" onClick={() => setPendingAttr(null)}>‹ Voltar</button>
                <span>Campanha</span>
              </div>
              <input className="acq-filter-search" autoFocus type="search" value={checklistQuery} onChange={(event) => setChecklistQuery(event.target.value)} placeholder="Buscar campanha…" aria-label="Buscar campanha" />
              <div className="acq-filter-options">
                <label className="acq-filter-option"><input type="checkbox" checked={campaignSelected.length === 0} onChange={() => onCampaignChange([])} /><span>Todas as campanhas</span></label>
                {visibleCampaigns.map((option) => <label className="acq-filter-option" key={option.key}><input type="checkbox" checked={campaignSelected.includes(option.key)} onChange={() => toggleChecklist(campaignSelected, onCampaignChange, option.key)} /><span>{option.label}</span></label>)}
                {!visibleCampaigns.length ? <div className="acq-filter-empty">Nenhum resultado.</div> : null}
              </div>
            </>
          ) : pendingAttr === "conjunto" ? (
            <>
              <div className="kb-searchbar-panelhead">
                <button type="button" className="kb-searchbar-back" onClick={() => setPendingAttr(null)}>‹ Voltar</button>
                <span>Conjunto de anúncios</span>
              </div>
              <input className="acq-filter-search" autoFocus type="search" value={checklistQuery} onChange={(event) => setChecklistQuery(event.target.value)} placeholder="Buscar conjunto…" aria-label="Buscar conjunto de anúncios" />
              <div className="acq-filter-options">
                <label className="acq-filter-option"><input type="checkbox" checked={adsetSelected.length === 0} onChange={() => onAdsetChange([])} /><span>Todos os conjuntos</span></label>
                {visibleAdsets.map((option) => <label className="acq-filter-option" key={option.key}><input type="checkbox" checked={adsetSelected.includes(option.key)} onChange={() => toggleChecklist(adsetSelected, onAdsetChange, option.key)} /><span>{option.label}</span></label>)}
                {!visibleAdsets.length ? <div className="acq-filter-empty">Nenhum resultado.</div> : null}
              </div>
            </>
          ) : pendingAttr ? (
            <>
              <div className="kb-searchbar-panelhead">
                <button type="button" className="kb-searchbar-back" onClick={() => setPendingAttr(null)}>‹ Voltar</button>
                <span>{ATTR_DEFS.find((attr) => attr.key === pendingAttr)?.label}</span>
              </div>
              <div className="kb-searchbar-chips">
                {valueOptions.map((option) => (
                  <button type="button" key={option.value} className="kb-chip" onClick={() => addFilter(pendingAttr as Exclude<PerfFilterAttr, "objetivo">, option.value, option.label)}>{option.label}</button>
                ))}
                {valueOptions.length === 0 ? <p className="admin-sub kb-searchbar-empty">Nenhum valor disponível.</p> : null}
              </div>
            </>
          ) : (
            <>
              <div className="kb-searchbar-panelhead"><span>Filtrar por atributo</span></div>
              <div className="kb-searchbar-attrlist">
                {availableAttrs.map((attr) => (
                  <button
                    type="button"
                    key={attr.key}
                    className="kb-searchbar-attr"
                    disabled={attr.key === "conjunto" && adsetDisabled}
                    onClick={() => openMenu(attr.key)}
                  >
                    <span aria-hidden>{attr.icon}</span>{attr.label}
                    {attr.key === "conjunto" && adsetDisabled ? <small>{campaignSelected.length ? "Carregando…" : "Selecione uma campanha"}</small> : null}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
