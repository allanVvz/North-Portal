"use client";

import { useEffect, useState } from "react";
import type { TaskRecord } from "@/lib/validation";
import type { DailyConfig } from "@/lib/validation";
import { AUTOMATION_DEFINITIONS, AUTOMATION_KEYS, type AutomationKey } from "@/lib/automationCatalog";
import { kindIcon } from "@/lib/taskCatalog";
import { DEFAULT_BUILTIN_TEMPLATE } from "@/lib/performanceTemplates";
import { CONVERSION_METRICS_DEFAULT, KNOWN_METRIC_TAGS } from "@/lib/metricTags";
import AutomationCardPicker from "./AutomationCardPicker";
import TagChipsInput from "../TagChipsInput";
import TaskModal from "../TaskModal";
import { agencyToday } from "../recurringState";

type ClientLite = { slug: string; name: string };
type Row = TaskRecord & { clientName?: string };
type PerformanceTemplateLite = { id: string; name: string; scope: string };
type DailyOptions = { deliveryTypeId: string | null; workflowReady: boolean;
  folders: Array<{ client_id: string; raw_folder_id: string | null; uploads_folder_id: string | null }>;
  recurringPlans: Array<{ id: string; title: string; kind: string; client_id: string | null;
    clientName: string | null; recurrence_cadence: string | null }> };
// Minimal shape the card actually renders — satisfied both by a freshly
// picked/created Row (in-session) and by the backend-resolved summary below.
type TargetTaskDisplay = {
  id: string;
  client_id?: string | null;
  title: string;
  kind: string;
  clientName?: string | null;
  recurrence_cadence?: string | null;
  due_date?: string | null;
};
type AutomationConfig = {
  id: string;
  automationKey: AutomationKey;
  targetTaskId: string;
  performanceTemplateId: string | null;
  active: boolean;
  collectMetricKeys: string[] | null;
  dailyConfig: DailyConfig | null;
  dependsOnConfigId: string | null;
  // Resolved server-side (lib/supabase.ts listAutomationConfigs) — never
  // cross-referenced against GET /api/admin/tasks here, because a recurring
  // target card that already advanced past its first cycle gets
  // payload.recurrence_group=true and disappears from that list
  // (visibleOnTaskBoard) — exactly the common case once an automation has
  // actually fired.
  targetTask: { id: string; clientId: string | null; title: string; kind: string; clientName: string | null; dueDate: string | null; recurrenceCadence: string | null } | null;
};

const AUTOMATION_ICON: Record<AutomationKey, string> = {
  relatorio_trafego_semanal: "▤",
  provisionar_card_metricas: "⇄",
  coleta_metrica_cliente: "✎",
  relatorio_conversao: "▧",
  diaria_recorrente: "▣",
};

// Automações que usam um template de Performance (o mesmo seletor).
const USES_PERFORMANCE_TEMPLATE: AutomationKey[] = ["relatorio_trafego_semanal", "relatorio_conversao"];

// A "slot" is one card on screen — either a saved automation_configs row
// (id set) or a still-unsaved draft added by clicking "+ Nova automação"
// (id null).
type Slot = {
  key: string;
  id: string | null;
  automationKey: AutomationKey | "";
  targetTask: TargetTaskDisplay | null;
  performanceTemplateId: string;
  active: boolean;
  collectMetricKeys: string[];
  dailyConfig: DailyConfig | null;
  dependsOnConfigId: string | null;
};

function slotFromConfig(config: AutomationConfig): Slot {
  return {
    key: config.id,
    id: config.id,
    automationKey: config.automationKey,
    targetTask: config.targetTask ? {
      id: config.targetTask.id,
      client_id: config.targetTask.clientId,
      title: config.targetTask.title,
      kind: config.targetTask.kind,
      clientName: config.targetTask.clientName,
      due_date: config.targetTask.dueDate,
      recurrence_cadence: config.targetTask.recurrenceCadence,
    } : null,
    performanceTemplateId: config.performanceTemplateId ?? "",
    active: config.active,
    collectMetricKeys: config.collectMetricKeys ?? [],
    dailyConfig: config.dailyConfig ?? null,
    dependsOnConfigId: config.dependsOnConfigId ?? null,
  };
}

function blankSlot(): Slot {
  return { key: crypto.randomUUID(), id: null, automationKey: "", targetTask: null, performanceTemplateId: "", active: true, collectMetricKeys: [], dailyConfig: null, dependsOnConfigId: null };
}

// Automações (promovida de uma aba de Configurações para tela própria no menu
// principal em 2026-08-21; o contrato atual está em docs/reporting/report-pipeline.md).
// Grid de 2 colunas, cards compactos, revelação progressiva por etapa: só o
// tipo de automação aparece de início; ao escolher, ele vira um chip
// compacto e os dois campos seguintes (card-alvo + modelo de Performance)
// aparecem juntos, animados.
export default function AutomationSettings({ clients }: { clients: ClientLite[] }) {
  const [tasks, setTasks] = useState<Row[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [templates, setTemplates] = useState<PerformanceTemplateLite[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingCardFor, setCreatingCardFor] = useState<string | null>(null);
  const [dailyOptions, setDailyOptions] = useState<DailyOptions>({ deliveryTypeId: null, workflowReady: false, folders: [], recurringPlans: [] });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/admin/tasks").then((r) => (r.ok ? r.json() : { tasks: [] })),
      fetch("/api/admin/assignees").then((r) => (r.ok ? r.json() : { assignees: [] })),
      fetch("/api/admin/performance/templates").then((r) => (r.ok ? r.json() : { templates: [] })),
      fetch("/api/admin/automations").then((r) => (r.ok ? r.json() : { automations: [] })),
      fetch("/api/admin/automations/daily/options").then((r) => (r.ok ? r.json() : null)),
    ]).then(([tasksRes, assigneesRes, templatesRes, automationsRes, optionsRes]) => {
      if (cancelled) return;
      const loadedTasks: Row[] = tasksRes.tasks ?? [];
      setTasks(loadedTasks);
      setAssignees(assigneesRes.assignees ?? []);
      setTemplates(templatesRes.templates ?? []);
      if (optionsRes) setDailyOptions(optionsRes);
      const configs: AutomationConfig[] = automationsRes.automations ?? [];
      setSlots(configs.map((c) => slotFromConfig(c)));
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, []);

  function updateSlot(key: string, patch: Partial<Slot>) {
    setSlots((current) => current.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function removeSlotLocally(key: string) {
    setSlots((current) => current.filter((s) => s.key !== key));
  }
  async function removeSlot(slot: Slot) {
    if (slot.id) {
      await fetch(`/api/admin/automations/${slot.id}`, { method: "DELETE" }).catch(() => {});
    }
    removeSlotLocally(slot.key);
  }
  async function saveSlot(slot: Slot): Promise<{ ok: boolean; message?: string }> {
    if (!slot.automationKey || !slot.targetTask) return { ok: false };
    const body = {
      automationKey: slot.automationKey,
      targetTaskId: slot.targetTask.id,
      performanceTemplateId: USES_PERFORMANCE_TEMPLATE.includes(slot.automationKey as AutomationKey) ? (slot.performanceTemplateId || null) : null,
      active: slot.active,
      collectMetricKeys: slot.automationKey === "relatorio_conversao"
        ? (slot.collectMetricKeys.length ? slot.collectMetricKeys : CONVERSION_METRICS_DEFAULT)
        : slot.automationKey === "coleta_metrica_cliente"
          ? slot.collectMetricKeys
          : null,
      dailyConfig: slot.automationKey === "diaria_recorrente" ? slot.dailyConfig : null,
    };
    const res = slot.id
      ? await fetch(`/api/admin/automations/${slot.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/admin/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      // A regra de dependência mora no servidor: "registre antes o Relatório de
      // anúncios neste card" tem que chegar a quem salvou, não virar "Erro".
      const data = await res.json().catch(() => null);
      return { ok: false, message: data?.error };
    }
    const saved: AutomationConfig = await res.json();
    updateSlot(slot.key, { id: saved.id, dependsOnConfigId: saved.dependsOnConfigId ?? null });
    return { ok: true };
  }

  if (loading) {
    return <div className="auto-grid"><div className="auto-card auto-loading">Carregando…</div></div>;
  }

  return (
    <div className="auto-grid">
      {slots.map((slot) => (
        <AutomationConfigCard
          key={slot.key}
          slot={slot}
          tasks={tasks}
          templates={templates}
          dailyOptions={dailyOptions}
          onChange={(patch) => updateSlot(slot.key, patch)}
          onSave={() => saveSlot(slot)}
          onRemove={() => removeSlot(slot)}
          onCreateCard={() => setCreatingCardFor(slot.key)}
        />
      ))}

      <button type="button" className="auto-add-box" onClick={() => setSlots((s) => [...s, blankSlot()])}>
        <span className="auto-add-plus" aria-hidden>+</span>
        Nova automação
      </button>

      {creatingCardFor ? (
        <TaskModal
          mode="new"
          task={null}
          slug=""
          clients={clients}
          assignees={assignees}
          clientName=""
          adminReviewers={[]}
          clientReviewers={[]}
          planoVisibilityOn={false}
          onClose={() => setCreatingCardFor(null)}
          onSaved={(task) => {
            setTasks((current) => [...current, task]);
            const slot = slots.find((item) => item.key === creatingCardFor);
            updateSlot(creatingCardFor, { targetTask: task,
              dailyConfig: slot?.automationKey === "diaria_recorrente" && task.client_id && dailyOptions.deliveryTypeId
                ? { clientId: task.client_id, deliveryTypeId: dailyOptions.deliveryTypeId,
                    pieces: [{ key: crypto.randomUUID(), name: "Peça 1", format: "Reels", offsetDays: 3 }] }
                : slot?.dailyConfig ?? null });
            setCreatingCardFor(null);
          }}
          onDeleted={() => setCreatingCardFor(null)}
        />
      ) : null}
    </div>
  );
}

function AutomationConfigCard({
  slot,
  tasks,
  templates,
  dailyOptions,
  onChange,
  onSave,
  onRemove,
  onCreateCard,
}: {
  slot: Slot;
  tasks: Row[];
  templates: PerformanceTemplateLite[];
  dailyOptions: DailyOptions;
  onChange: (patch: Partial<Slot>) => void;
  onSave: () => Promise<{ ok: boolean; message?: string }>;
  onRemove: () => void;
  onCreateCard: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [provisionMsg, setProvisionMsg] = useState("");
  const [provisioning, setProvisioning] = useState(false);

  const def = slot.automationKey ? AUTOMATION_DEFINITIONS[slot.automationKey] : null;
  const canSave = Boolean(slot.automationKey && slot.targetTask &&
    (slot.automationKey !== "diaria_recorrente" || (slot.dailyConfig?.pieces.length && dailyOptions.workflowReady)));
  const showDetails = Boolean(slot.automationKey);

  async function save() {
    setBusy(true);
    setMsg("");
    const result = await onSave();
    setMsg(result.ok ? "Salvo ✓" : result.message ?? "Erro ao salvar");
    setBusy(false);
  }

  async function toggleActive(next: boolean) {
    if (slot.id) {
      const response = await fetch(`/api/admin/automations/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      }).catch(() => null);
      if (!response?.ok) {
        const body = await response?.json().catch(() => null);
        setMsg(body?.error ?? "Não foi possível alterar a automação.");
        return;
      }
    }
    onChange({ active: next });
  }

  async function provisionNow() {
    if (!slot.targetTask) return;
    setProvisioning(true);
    setProvisionMsg("");
    try {
      const res = await fetch("/api/admin/automations/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateTaskId: slot.targetTask.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Falha ao provisionar.");
      const errorNote = data.errors?.length ? ` · ${data.errors.length} erro(s)` : "";
      setProvisionMsg(`${data.provisioned} provisionado(s)${errorNote}`);
    } catch (error) {
      setProvisionMsg(error instanceof Error ? error.message : "Falha ao provisionar.");
    }
    setProvisioning(false);
  }

  return (
    <div className={`auto-card ${showDetails ? "auto-card-open" : ""}`}>
      <div className="auto-card-head">
        <label className="auto-switch" title="Automação ativa">
          <input type="checkbox" checked={slot.active} onChange={(e) => void toggleActive(e.target.checked)} disabled={!slot.id} />
          <span className="sw sw-sm" />
        </label>
        <button type="button" className="auto-remove" onClick={onRemove} disabled={busy} aria-label="Remover automação" title="Remover">✕</button>
      </div>

      {!showDetails ? (
        <select
          className="auto-type-select"
          autoFocus
          value=""
          onChange={(e) => onChange({ automationKey: e.target.value as AutomationKey, performanceTemplateId: "", targetTask: null })}
        >
          <option value="" disabled>Tipo de automação</option>
          {AUTOMATION_KEYS.map((key) => (
            <option key={key} value={key}>{AUTOMATION_ICON[key]}  {AUTOMATION_DEFINITIONS[key].label}</option>
          ))}
        </select>
      ) : (
        <div className="auto-details">
          <button
            type="button"
            className="auto-chip auto-chip-type"
            onClick={() => onChange({ automationKey: "", targetTask: null, performanceTemplateId: "" })}
            title={def?.description}
          >
            <span aria-hidden>{AUTOMATION_ICON[slot.automationKey as AutomationKey]}</span>
            {def?.label}
          </button>

          {/* De onde vêm os dados e de quem esta automação depende — é o que faz
              "Relatório de anúncios" e "Relatório de vendas" deixarem de parecer
              configurações irmãs. Rótulo, não mais uma caixa. */}
          {def ? (
            <dl className="auto-meta">
              <div><dt>Fonte</dt><dd>{def.source}</dd></div>
              {def.dependsOn ? (
                <div>
                  <dt>Depende de</dt>
                  <dd>
                    {AUTOMATION_DEFINITIONS[def.dependsOn].label}
                    {slot.id && !slot.dependsOnConfigId ? <span className="auto-meta-warn"> · não registrado para este cliente</span> : null}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {slot.targetTask ? (
            <button type="button" className="auto-chip auto-chip-card" onClick={() => onChange({ targetTask: null })}>
              <span aria-hidden>{kindIcon(slot.targetTask.kind)}</span>
              <span className="auto-chip-text">
                {slot.targetTask.title}
                {slot.targetTask.clientName ? <small>{slot.targetTask.clientName}</small> : null}
              </span>
            </button>
          ) : (
            <div className="auto-pick">
              {slot.automationKey === "diaria_recorrente" ? (
                <select className="auto-template-select" value="" aria-label="Selecionar Plano recorrente"
                  onChange={(event) => {
                    const task = dailyOptions.recurringPlans.find((item) => item.id === event.target.value);
                    if (!task?.client_id || !dailyOptions.deliveryTypeId) return;
                    onChange({ targetTask: task, dailyConfig: {
                      clientId: task.client_id, deliveryTypeId: dailyOptions.deliveryTypeId,
                      pieces: [{ key: crypto.randomUUID(), name: "Peça 1", format: "Reels", offsetDays: 3 }],
                    } });
                  }}>
                  <option value="">Selecionar Plano recorrente</option>
                  {dailyOptions.recurringPlans.map((plan) => <option key={plan.id} value={plan.id}>
                    {plan.clientName ? `${plan.clientName} · ` : ""}{plan.title}
                  </option>)}
                </select>
              ) : <AutomationCardPicker tasks={tasks} onPick={(task) => onChange({ targetTask: task, dailyConfig: null })} />}
              <button type="button" className="auto-linklike" onClick={onCreateCard}>+ Criar card</button>
            </div>
          )}

          {USES_PERFORMANCE_TEMPLATE.includes(slot.automationKey as AutomationKey) ? (
            <select
              className="auto-template-select"
              value={slot.performanceTemplateId}
              onChange={(e) => onChange({ performanceTemplateId: e.target.value })}
            >
              <option value="">{DEFAULT_BUILTIN_TEMPLATE.name} (padrão)</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : null}

          {slot.automationKey === "relatorio_conversao" ? (
            <label className="auto-field">
              <span>Métricas que a automação lê do comentário</span>
              <TagChipsInput
                value={slot.collectMetricKeys.length ? slot.collectMetricKeys : CONVERSION_METRICS_DEFAULT}
                onChange={(next) => onChange({ collectMetricKeys: next })}
                suggestions={KNOWN_METRIC_TAGS}
                placeholder="vendas, agendamentos, seguidores, receita…"
              />
            </label>
          ) : null}

          {slot.automationKey === "diaria_recorrente" ? (
            <div className="auto-daily">
              {!dailyOptions.workflowReady ? <p className="admin-warn">Publique o workflow de Criativo com Roteiro e Captação.</p> : null}
              {slot.dailyConfig ? <>
                <p><b>Plano:</b> {slot.targetTask?.title ?? "Selecione um Plano recorrente"}</p>
                <p><b>Roteiro e Captação:</b> compartilhados por gravação</p>
                <label>Execução existente para aproveitar
                  <select value={slot.dailyConfig.adoptedPlanTaskId ?? ""} onChange={(event) => onChange({ dailyConfig: { ...slot.dailyConfig!, adoptedPlanTaskId: event.target.value || null } })}>
                    <option value="">Nenhuma</option>
                    {tasks.filter((task) => task.kind === "plano_acao" && !task.recurrence_cadence && task.client_id === slot.dailyConfig?.clientId)
                      .map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                  </select>
                </label>
                {slot.dailyConfig.adoptedPlanTaskId ? <AdoptedDailySummary planId={slot.dailyConfig.adoptedPlanTaskId} /> : null}
                {(() => {
                  const folders = dailyOptions.folders.find((item) => item.client_id === slot.dailyConfig?.clientId);
                  return <p><b>Drive:</b> {folders?.raw_folder_id ? <a href={`https://drive.google.com/drive/folders/${folders.raw_folder_id}`} target="_blank" rel="noreferrer">Raw</a> : "Raw pendente"} · {folders?.uploads_folder_id ? <a href={`https://drive.google.com/drive/folders/${folders.uploads_folder_id}`} target="_blank" rel="noreferrer">Edição</a> : "Edição pendente"}</p>;
                })()}
                <strong>Peças ({slot.dailyConfig.pieces.length})</strong>
                {slot.dailyConfig.pieces.map((piece, index) => <div className="auto-daily-piece" key={piece.key}>
                  <input aria-label={`Nome da peça ${index + 1}`} value={piece.name} onChange={(event) => onChange({ dailyConfig: { ...slot.dailyConfig!, pieces: slot.dailyConfig!.pieces.map((item) => item.key === piece.key ? { ...item, name: event.target.value } : item) } })} />
                  <input aria-label={`Formato da peça ${index + 1}`} value={piece.format} onChange={(event) => onChange({ dailyConfig: { ...slot.dailyConfig!, pieces: slot.dailyConfig!.pieces.map((item) => item.key === piece.key ? { ...item, format: event.target.value } : item) } })} />
                  <label>Prazo após gravação <input type="number" min="-30" max="180" value={piece.offsetDays} onChange={(event) => onChange({ dailyConfig: { ...slot.dailyConfig!, pieces: slot.dailyConfig!.pieces.map((item) => item.key === piece.key ? { ...item, offsetDays: Number(event.target.value) } : item) } })} /> dias</label>
                  <button type="button" disabled={slot.dailyConfig!.pieces.length === 1} onClick={() => onChange({ dailyConfig: { ...slot.dailyConfig!, pieces: slot.dailyConfig!.pieces.filter((item) => item.key !== piece.key) } })}>Remover</button>
                </div>)}
                <button type="button" className="auto-linklike" onClick={() => onChange({ dailyConfig: { ...slot.dailyConfig!, pieces: [...slot.dailyConfig!.pieces, { key: crypto.randomUUID(), name: `Peça ${slot.dailyConfig!.pieces.length + 1}`, format: "Reels", offsetDays: 3 }] } })}>+ Peça</button>
                {slot.id ? <ManualDailyCycle configId={slot.id} config={slot.dailyConfig} /> : null}
              </> : null}
            </div>
          ) : null}

          <div className="auto-actions">
            {msg ? <span className="auto-msg">{msg}</span> : <span />}
            <button className="admin-btn primary" onClick={() => void save()} disabled={busy || !canSave}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>

          {slot.automationKey === "provisionar_card_metricas" && slot.id ? (
            <div className="auto-actions">
              {provisionMsg ? <span className="auto-msg">{provisionMsg}</span> : <span />}
              <button className="admin-btn ghost" onClick={() => void provisionNow()} disabled={provisioning}>
                {provisioning ? "Provisionando…" : "Provisionar agora"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ManualDailyCycle({ configId, config }: { configId: string; config: DailyConfig }) {
  const [date, setDate] = useState(agencyToday());
  const [pieces, setPieces] = useState(config.pieces);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <details className="auto-daily-manual">
    <summary>Criar gravação manualmente</summary>
    <label>Data da gravação <input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
    <p>Ajustes abaixo valem somente para esta gravação.</p>
    {pieces.map((piece, index) => <div className="auto-daily-piece" key={piece.key}>
      <input aria-label={`Nome da peça do ciclo ${index + 1}`} value={piece.name} onChange={(event) => setPieces((current) => current.map((item) => item.key === piece.key ? { ...item, name: event.target.value } : item))} />
      <input aria-label={`Formato da peça do ciclo ${index + 1}`} value={piece.format} onChange={(event) => setPieces((current) => current.map((item) => item.key === piece.key ? { ...item, format: event.target.value } : item))} />
      <input aria-label={`Dias após gravação da peça ${index + 1}`} type="number" min="-30" max="180" value={piece.offsetDays} onChange={(event) => setPieces((current) => current.map((item) => item.key === piece.key ? { ...item, offsetDays: Number(event.target.value) } : item))} />
      <button type="button" disabled={pieces.length === 1} onClick={() => setPieces((current) => current.filter((item) => item.key !== piece.key))}>Remover</button>
    </div>)}
    <button type="button" onClick={() => setPieces((current) => [...current, { key: crypto.randomUUID(), name: `Peça ${current.length + 1}`, format: "Reels", offsetDays: 3 }])}>+ Peça neste ciclo</button>
    <button type="button" className="admin-btn primary" disabled={busy || !date || pieces.some((piece) => !piece.name.trim() || !piece.format.trim())} onClick={async () => {
      setBusy(true); setMessage("");
      try {
        const response = await fetch("/api/admin/automations/daily/cycles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ configId, date, pieces }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Falha ao criar a gravação.");
        setMessage(`Gravação criada: ${result.executionId}`);
      } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao criar a gravação."); }
      finally { setBusy(false); }
    }}>{busy ? "Criando…" : "Confirmar gravação"}</button>
    {message ? <p role="status">{message}</p> : null}
  </details>;
}

function AdoptedDailySummary({ planId }: { planId: string }) {
  const [summary, setSummary] = useState<{
    plan: { id: string; title: string };
    cards: Array<{ id: string; title: string; kind: string; subtype: string | null }>;
    captures: Array<{ daily_folder_id: string | null; script_folder_id: string | null; capture_folder_id: string | null }>;
    creatives: Array<{ creative_task_id: string; creative_folder_id: string | null; raw_folder_id: string | null }>;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/automations/daily/adoption?planId=${encodeURIComponent(planId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (active) setSummary(result); });
    return () => { active = false; };
  }, [planId]);
  if (!summary) return <p>Carregando cards existentes…</p>;
  const captures = summary.cards.filter((card) => card.subtype === "captacao");
  const scripts = summary.cards.filter((card) => card.subtype === "roteiro");
  const creatives = summary.cards.filter((card) => card.kind === "criativo");
  const cardLink = (card: { id: string; title: string }) => <a key={card.id} href={`/admin/operacao?task=${card.id}`}>{card.title}</a>;
  return <div className="auto-daily-adoption">
    <p><b>Execução adotada:</b> {cardLink(summary.plan)}</p>
    <p><b>Roteiro:</b> {scripts.length ? scripts.map(cardLink) : "sem card"}</p>
    <p><b>Captação:</b> {captures.length ? captures.map(cardLink) : "sem card"}</p>
    <p><b>Criativos ({creatives.length}):</b> {creatives.map(cardLink)}</p>
    {summary.captures.map((capture, index) => <p key={index}><b>Pastas da gravação:</b> {capture.script_folder_id ? <a href={`https://drive.google.com/drive/folders/${capture.script_folder_id}`} target="_blank" rel="noreferrer">Roteiro</a> : "Roteiro pendente"} · {capture.capture_folder_id ? <a href={`https://drive.google.com/drive/folders/${capture.capture_folder_id}`} target="_blank" rel="noreferrer">Captação</a> : "Captação pendente"}</p>)}
  </div>;
}
