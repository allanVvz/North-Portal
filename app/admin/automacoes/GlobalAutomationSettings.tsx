"use client";

import { useEffect, useMemo, useState } from "react";
import type { TaskRecord } from "@/lib/validation";
import type { TaskTypeEditorNode } from "@/lib/taskTypes";
import type { GlobalRule, RuleDefinition } from "@/lib/automations/rules";
import TaskModal from "../TaskModal";

type ClientLite = { slug: string; name: string };
type DailyFormat = { label: string; deliveryTypeId: string | null; ready: boolean };
type Template = { id: string; name: string };
type Draft = { id: string | null; name: string; active: boolean; definition: RuleDefinition };
type Card = { key: string; draft: Draft; saved: GlobalRule | null; editing: boolean };

const ACTION_LABEL: Record<RuleDefinition["actionKind"], string> = {
  create_card: "Criar card", change_status: "Mudar status", ai: "North AI",
  drive: "Preparar Drive", report: "Gerar relatório", daily: "Montar diária", provision: "Provisionar clientes",
};
const STATUS_LABEL: Record<string, string> = {
  backlog: "Entrada", em_producao: "Em produção", revisao: "Revisão",
  aprovacao: "Aprovação", aprovado: "Aprovado", parada: "Parada",
};
const STATUSES = Object.keys(STATUS_LABEL);

function blank(): Card {
  return { key: crypto.randomUUID(), saved: null, editing: true, draft: {
    id: null, name: "", active: false,
    definition: {
      sourceTypeId: "", sourceSubtypeId: null, workflowVersionId: null, workflowStepId: null,
      triggerKind: "recurrence_occurrence", fromStatus: null, toStatus: null,
      actionKind: "create_card", actionConfig: {}, outputTypeId: null, outputSubtypeId: null,
    },
  } };
}

function fromRule(rule: GlobalRule): Card {
  return { key: rule.id, saved: rule, editing: false, draft: {
    id: rule.id, name: rule.name, active: rule.active, definition: rule.definition,
  } };
}

export default function GlobalAutomationSettings({ clients }: { clients: ClientLite[] }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [types, setTypes] = useState<TaskTypeEditorNode[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [dailyFormats, setDailyFormats] = useState<DailyFormat[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [legacyActiveCount, setLegacyActiveCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch("/api/admin/automation-rules").then((r) => r.json()),
      fetch("/api/admin/task-types?scope=editor").then((r) => r.json()),
      fetch("/api/admin/assignees").then((r) => r.json()),
      fetch("/api/admin/automations/daily/options").then((r) => r.ok ? r.json() : null),
      fetch("/api/admin/performance/templates").then((r) => r.ok ? r.json() : null),
    ]).then(([rules, vocabulary, team, daily, performance]) => {
      if (!mounted) return;
      setCards((rules.rules ?? []).map(fromRule));
      setLegacyActiveCount(rules.legacyActiveCount ?? 0);
      setTypes((vocabulary.types ?? []).filter((type: TaskTypeEditorNode) => type.active));
      setAssignees(team.assignees ?? []);
      setDailyFormats(daily?.formats ?? []);
      setTemplates(performance?.templates ?? []);
    }).catch(() => setMessage("Não foi possível carregar as automações.")).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  function update(key: string, patch: Partial<Draft>) {
    setCards((current) => current.map((card) => card.key === key
      ? { ...card, draft: { ...card.draft, ...patch } } : card));
  }

  function updateDefinition(key: string, patch: Partial<RuleDefinition>) {
    setCards((current) => current.map((card) => card.key === key
      ? { ...card, draft: { ...card.draft, definition: { ...card.draft.definition, ...patch } } } : card));
  }

  async function save(card: Card) {
    setBusyKey(card.key); setMessage("");
    try {
      const response = await fetch("/api/admin/automation-rules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(card.draft),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Não foi possível publicar a regra.");
      setCards((current) => current.map((item) => item.key === card.key ? fromRule(result as GlobalRule) : item));
      setMessage(`${result.name} publicada na versão ${result.version}. Cards já vinculados conservam a versão anterior.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível publicar a regra."); }
    finally { setBusyKey(null); }
  }

  async function useCreatedCard(task: TaskRecord) {
    const card = cards.find((item) => item.key === creatingFor);
    setCreatingFor(null);
    if (!card?.saved) return;
    try {
      const response = await fetch(`/api/admin/tasks/${task.id}/automations`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionIds: [card.saved.versionId] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "O card foi criado, mas não foi possível vinculá-lo à automação.");
      setMessage(`Card criado e vinculado a ${card.saved.name} v${card.saved.version}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "O card foi criado sem vínculo."); }
  }

  if (loading) return <div className="auto-grid"><div className="auto-card auto-loading">Carregando…</div></div>;

  const creatingRule = cards.find((item) => item.key === creatingFor)?.saved;
  const creatingSource = types.find((type) => type.id === creatingRule?.definition.sourceTypeId);
  return <div className="global-automations">
    {message ? <p className="admin-warn" role="status">{message}</p> : null}
    {legacyActiveCount ? <p className="admin-sub">{legacyActiveCount} configurações existentes continuam ativas nos próprios cards. Vincule novas regras globais ao criar ou editar um card.</p> : null}
    <div className="auto-grid">
      {cards.map((card) => <RuleCard key={card.key} card={card} types={types} dailyFormats={dailyFormats} templates={templates}
        busy={busyKey === card.key}
        onDraft={(patch) => update(card.key, patch)}
        onDefinition={(patch) => updateDefinition(card.key, patch)}
        onEdit={(editing) => setCards((current) => current.map((item) => item.key === card.key ? { ...item, editing } : item))}
        onCancel={() => setCards((current) => card.saved
          ? current.map((item) => item.key === card.key ? fromRule(card.saved!) : item)
          : current.filter((item) => item.key !== card.key))}
        onSave={() => void save(card)} onCreateCard={() => setCreatingFor(card.key)} />)}
      <button type="button" className="auto-add-box" onClick={() => setCards((current) => [...current, blank()])}>
        <span className="auto-add-plus" aria-hidden>+</span>Nova automação
      </button>
    </div>
    {creatingFor && creatingRule ? <TaskModal mode="new" task={null} slug=""
      prefill={{ kind: creatingSource?.key === "plano" ? "plano_acao" : creatingSource?.key === "tarefa" ? "operacional" : creatingSource?.key }}
      clients={clients} assignees={assignees} clientName="" adminReviewers={[]} clientReviewers={[]}
      planoVisibilityOn={false} onClose={() => setCreatingFor(null)}
      onSaved={(task) => { void useCreatedCard(task); }} onDeleted={() => setCreatingFor(null)} /> : null}
  </div>;
}

function RuleCard({ card, types, dailyFormats, templates, busy, onDraft, onDefinition, onEdit, onCancel, onSave, onCreateCard }: {
  card: Card; types: TaskTypeEditorNode[]; dailyFormats: DailyFormat[]; templates: Template[]; busy: boolean;
  onDraft: (patch: Partial<Draft>) => void;
  onDefinition: (patch: Partial<RuleDefinition>) => void;
  onEdit: (editing: boolean) => void; onCancel: () => void; onSave: () => void; onCreateCard: () => void;
}) {
  const d = card.draft.definition;
  const source = types.find((type) => type.id === d.sourceTypeId);
  const output = types.find((type) => type.id === d.outputTypeId);
  const subtype = source?.subtypes.find((item) => item.id === d.sourceSubtypeId);
  const outputSubtype = output?.subtypes.find((item) => item.id === d.outputSubtypeId);
  const cascades = useMemo(() => types.flatMap((type) => type.workflow_version_id
    ? type.workflowSteps.filter((step) => step.task_type_id === d.sourceSubtypeId)
      .map((step) => ({ key: `${type.workflow_version_id}:${step.workflow_step_id}`,
        versionId: type.workflow_version_id!, stepId: step.workflow_step_id,
        label: `${type.label} · ${step.label} · versão ${type.workflow_version_id!.slice(0, 8)}` }))
    : []), [types, d.sourceSubtypeId]);
  const sourceLabel = [source?.label, subtype?.label].filter(Boolean).join(" / ") || "Origem pendente";
  const outputLabel = [output?.label, outputSubtype?.label].filter(Boolean).join(" / ");
  const triggerLabel = d.triggerKind === "recurrence_occurrence" ? "Ocorrência da recorrência"
    : `${STATUS_LABEL[d.fromStatus ?? ""] ?? "?"} → ${STATUS_LABEL[d.toStatus ?? ""] ?? "?"}`;
  const cascadeLabel = cascades.find((item) => item.stepId === d.workflowStepId)?.label ?? "Sem vínculo na cascata";

  return <article className={`auto-card global-rule-card ${card.editing ? "auto-card-open" : ""}`}>
    {!card.editing ? <>
      <div className="global-rule-head"><strong>{card.saved?.name}</strong><span className={card.saved?.active ? "global-rule-on" : "global-rule-off"}>{card.saved?.active ? "Ativa" : "Inativa"}</span></div>
      <dl className="global-rule-summary">
        <div><dt>Entrada</dt><dd>{sourceLabel}</dd></div>
        <div><dt>Gatilho</dt><dd>{triggerLabel}</dd></div>
        <div><dt>Ação</dt><dd>{ACTION_LABEL[d.actionKind]}</dd></div>
        <div><dt>Saída</dt><dd>{outputLabel || "No próprio card"}</dd></div>
        <div><dt>Cascata</dt><dd>{cascadeLabel}</dd></div>
      </dl>
      <div className="auto-actions"><small>Versão {card.saved?.version}</small><div>
        <button type="button" className="admin-btn ghost" onClick={onCreateCard}>+ Criar card</button>
        <button type="button" className="admin-btn ghost" onClick={() => onEdit(true)}>Editar regra</button>
      </div></div>
    </> : <>
      <label className="auto-field"><span>Nome da automação</span><input value={card.draft.name}
        onChange={(event) => onDraft({ name: event.target.value })} placeholder="Ex.: Diária de criativos" /></label>
      <div className="global-rule-flow">
        <fieldset><legend>1. Origem</legend>
          <label>Tipo<select value={d.sourceTypeId} onChange={(event) => onDefinition({ sourceTypeId: event.target.value,
            sourceSubtypeId: null, workflowVersionId: null, workflowStepId: null })}>
            <option value="">Escolher Tipo</option>{types.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
          </select></label>
          {source?.subtypes.length ? <label>Subtipo<select value={d.sourceSubtypeId ?? ""}
            onChange={(event) => onDefinition({ sourceSubtypeId: event.target.value || null, workflowVersionId: null, workflowStepId: null })}>
            <option value="">Todos os subtipos</option>{source.subtypes.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></label> : null}
          {cascades.length ? <label>Vínculo na cascata<select value={d.workflowStepId ?? ""}
            onChange={(event) => { const item = cascades.find((candidate) => candidate.stepId === event.target.value);
              onDefinition({ workflowVersionId: item?.versionId ?? null, workflowStepId: item?.stepId ?? null }); }}>
            <option value="">Qualquer cascata</option>{cascades.map((item) => <option key={item.key} value={item.stepId}>{item.label}</option>)}
          </select></label> : null}
        </fieldset>
        <fieldset><legend>2. Gatilho</legend>
          <label>Quando<select value={d.triggerKind} onChange={(event) => onDefinition({
            triggerKind: event.target.value as RuleDefinition["triggerKind"],
            fromStatus: event.target.value === "recurrence_occurrence" ? null : "em_producao",
            toStatus: event.target.value === "recurrence_occurrence" ? null : "revisao",
          })}>
            <option value="recurrence_occurrence">Nasce uma ocorrência</option>
            <option value="status_transition">Status muda</option>
          </select></label>
          {d.triggerKind === "status_transition" ? <div className="global-status-pair">
            <label>De<select value={d.fromStatus ?? ""} onChange={(event) => onDefinition({ fromStatus: event.target.value as RuleDefinition["fromStatus"] })}>
              {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
            </select></label>
            <label>Para<select value={d.toStatus ?? ""} onChange={(event) => onDefinition({ toStatus: event.target.value as RuleDefinition["toStatus"] })}>
              {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
            </select></label>
          </div> : <p className="admin-sub">A data vem da recorrência do Plano, Entrega ou Tarefa. Plano sem recorrência executa uma vez.</p>}
        </fieldset>
        <fieldset><legend>3. Ação</legend>
          <label>Executar<select value={d.actionKind} onChange={(event) => onDefinition({
            actionKind: event.target.value as RuleDefinition["actionKind"], actionConfig:
              event.target.value === "daily" ? { automationKey: "diaria_recorrente",
                dailyQuantities: dailyFormats.filter((format) => format.ready && format.deliveryTypeId)
                  .map((format, index) => ({ deliveryTypeId: format.deliveryTypeId!, count: index === 0 ? 1 : 0, offsetDays: 3 })) }
                : event.target.value === "provision" ? { automationKey: "provisionar_card_metricas" } : {},
            outputTypeId: event.target.value === "create_card" ? d.outputTypeId : null,
            outputSubtypeId: event.target.value === "create_card" ? d.outputSubtypeId : null,
          })}>{Object.entries(ACTION_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {d.actionKind === "create_card" ? <label>Título do novo card<input value={d.actionConfig.title ?? ""}
            onChange={(event) => onDefinition({ actionConfig: { ...d.actionConfig, title: event.target.value || undefined } })}
            placeholder="Usar nome da automação" /></label> : null}
          {d.actionKind === "change_status" ? <label>Novo status<select value={d.actionConfig.status ?? ""}
            onChange={(event) => onDefinition({ actionConfig: { status: event.target.value as RuleDefinition["actionConfig"]["status"] } })}>
            <option value="">Escolher</option>{STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
          </select></label> : null}
          {d.actionKind === "ai" ? <label>Instrução<textarea value={d.actionConfig.instruction ?? ""}
            onChange={(event) => onDefinition({ actionConfig: { instruction: event.target.value } })} /></label> : null}
          {d.actionKind === "report" ? <label>Relatório<select value={d.actionConfig.automationKey ?? ""}
            onChange={(event) => onDefinition({ actionConfig: { automationKey: event.target.value as RuleDefinition["actionConfig"]["automationKey"] } })}>
            <option value="">Escolher</option><option value="relatorio_trafego_semanal">Anúncios</option>
            <option value="relatorio_conversao">Conversão</option>
          </select></label> : null}
          {d.actionKind === "report" ? <label>Template de Performance<select value={d.actionConfig.performanceTemplateId ?? ""}
            onChange={(event) => onDefinition({ actionConfig: { ...d.actionConfig, performanceTemplateId: event.target.value || null } })}>
            <option value="">Template padrão</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label> : null}
          {d.actionKind === "daily" ? <div className="global-daily-quantities">
            <p className="admin-sub">Quantidades sugeridas por Subtipo. O Plano pode ajustá-las em cada ciclo.</p>
            {dailyFormats.filter((format) => format.ready && format.deliveryTypeId).map((format) => {
              const current = d.actionConfig.dailyQuantities?.find((row) => row.deliveryTypeId === format.deliveryTypeId);
              return <label key={format.deliveryTypeId}>{format.label}<input type="number" min={0} max={50} value={current?.count ?? 0}
                onChange={(event) => onDefinition({ actionConfig: { ...d.actionConfig, dailyQuantities: dailyFormats
                  .filter((item) => item.ready && item.deliveryTypeId).map((item) => ({
                    deliveryTypeId: item.deliveryTypeId!, count: item.deliveryTypeId === format.deliveryTypeId
                      ? Number(event.target.value) : d.actionConfig.dailyQuantities?.find((row) => row.deliveryTypeId === item.deliveryTypeId)?.count ?? 0,
                    offsetDays: d.actionConfig.dailyQuantities?.find((row) => row.deliveryTypeId === item.deliveryTypeId)?.offsetDays ?? 3,
                  })) } })} /></label>;
            })}
          </div> : null}
          {d.actionKind === "provision" ? <p className="admin-sub">Clientes elegíveis recebem o card uma vez por ocorrência do modelo.</p> : null}
        </fieldset>
        <fieldset><legend>4. Saída</legend>
          {d.actionKind === "create_card" ? <>
            <label>Tipo<select value={d.outputTypeId ?? ""} onChange={(event) => onDefinition({ outputTypeId: event.target.value || null, outputSubtypeId: null })}>
              <option value="">Escolher Tipo</option>{types.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
            </select></label>
            {output?.subtypes.length ? <label>Subtipo<select value={d.outputSubtypeId ?? ""} onChange={(event) => onDefinition({ outputSubtypeId: event.target.value || null })}>
              <option value="">Sem subtipo</option>{output.subtypes.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select></label> : null}
          </> : <p className="admin-sub">Resultado e erros aparecem nos comentários do card.</p>}
        </fieldset>
      </div>
      <div className="auto-actions"><label className="admin-toggle"><input type="checkbox" checked={card.draft.active}
        onChange={(event) => onDraft({ active: event.target.checked })} /><span className="sw" /><span>Ativa</span></label>
        <div><button type="button" className="admin-btn ghost" onClick={onCancel}>Cancelar</button>
          <button type="button" className="admin-btn primary" onClick={onSave} disabled={busy || !card.draft.name.trim() || !d.sourceTypeId}>
            {busy ? "Publicando…" : card.saved ? "Publicar nova versão" : "Publicar regra"}
          </button></div></div>
    </>}
  </article>;
}
