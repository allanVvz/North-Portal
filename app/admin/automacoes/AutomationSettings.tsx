"use client";

import { useEffect, useState } from "react";
import type { TaskRecord } from "@/lib/validation";
import { AUTOMATION_DEFINITIONS, AUTOMATION_KEYS, type AutomationKey } from "@/lib/automationCatalog";
import { kindIcon } from "@/lib/taskCatalog";
import { DEFAULT_BUILTIN_TEMPLATE } from "@/lib/performanceTemplates";
import { CONVERSION_METRICS_DEFAULT, KNOWN_METRIC_TAGS } from "@/lib/metricTags";
import AutomationCardPicker from "./AutomationCardPicker";
import TagChipsInput from "../TagChipsInput";
import TaskModal from "../TaskModal";

type ClientLite = { slug: string; name: string };
type Row = TaskRecord & { clientName?: string };
type PerformanceTemplateLite = { id: string; name: string; scope: string };
// Minimal shape the card actually renders — satisfied both by a freshly
// picked/created Row (in-session) and by the backend-resolved summary below.
type TargetTaskDisplay = {
  id: string;
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
  lastRunDate: string | null;
  collectMetricKeys: string[] | null;
  // Resolved server-side (lib/supabase.ts listAutomationConfigs) — never
  // cross-referenced against GET /api/admin/tasks here, because a recurring
  // target card that already advanced past its first cycle gets
  // payload.recurrence_group=true and disappears from that list
  // (visibleOnTaskBoard) — exactly the common case once an automation has
  // actually fired.
  targetTask: { id: string; title: string; kind: string; clientName: string | null; dueDate: string | null; recurrenceCadence: string | null } | null;
};

const AUTOMATION_ICON: Record<AutomationKey, string> = {
  relatorio_trafego_semanal: "▤",
  provisionar_card_metricas: "⇄",
  coleta_metrica_cliente: "✎",
  relatorio_vendas: "▧",
};

// Automações que usam um template de Performance (o mesmo seletor).
const USES_PERFORMANCE_TEMPLATE: AutomationKey[] = ["relatorio_trafego_semanal", "relatorio_vendas"];

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
};

function slotFromConfig(config: AutomationConfig): Slot {
  return {
    key: config.id,
    id: config.id,
    automationKey: config.automationKey,
    targetTask: config.targetTask ? {
      id: config.targetTask.id,
      title: config.targetTask.title,
      kind: config.targetTask.kind,
      clientName: config.targetTask.clientName,
      due_date: config.targetTask.dueDate,
      recurrence_cadence: config.targetTask.recurrenceCadence,
    } : null,
    performanceTemplateId: config.performanceTemplateId ?? "",
    active: config.active,
    collectMetricKeys: config.collectMetricKeys ?? [],
  };
}

function blankSlot(): Slot {
  return { key: crypto.randomUUID(), id: null, automationKey: "", targetTask: null, performanceTemplateId: "", active: true, collectMetricKeys: [] };
}

// Automações (promovida de uma aba de Configurações para tela própria no menu
// principal em 2026-08-21 — ver plan/AUTOMACOES-RELATORIO-TRAFEGO.md).
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

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/admin/tasks").then((r) => (r.ok ? r.json() : { tasks: [] })),
      fetch("/api/admin/assignees").then((r) => (r.ok ? r.json() : { assignees: [] })),
      fetch("/api/admin/performance/templates").then((r) => (r.ok ? r.json() : { templates: [] })),
      fetch("/api/admin/automations").then((r) => (r.ok ? r.json() : { automations: [] })),
    ]).then(([tasksRes, assigneesRes, templatesRes, automationsRes]) => {
      if (cancelled) return;
      const loadedTasks: Row[] = tasksRes.tasks ?? [];
      setTasks(loadedTasks);
      setAssignees(assigneesRes.assignees ?? []);
      setTemplates(templatesRes.templates ?? []);
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
  async function saveSlot(slot: Slot) {
    if (!slot.automationKey || !slot.targetTask) return;
    const body = {
      automationKey: slot.automationKey,
      targetTaskId: slot.targetTask.id,
      performanceTemplateId: USES_PERFORMANCE_TEMPLATE.includes(slot.automationKey as AutomationKey) ? (slot.performanceTemplateId || null) : null,
      active: slot.active,
      collectMetricKeys: slot.automationKey === "relatorio_vendas"
        ? (slot.collectMetricKeys.length ? slot.collectMetricKeys : CONVERSION_METRICS_DEFAULT)
        : slot.automationKey === "coleta_metrica_cliente"
          ? slot.collectMetricKeys
          : null,
    };
    const res = slot.id
      ? await fetch(`/api/admin/automations/${slot.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/admin/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return false;
    const saved: AutomationConfig = await res.json();
    updateSlot(slot.key, { id: saved.id });
    return true;
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
            updateSlot(creatingCardFor, { targetTask: task });
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
  onChange,
  onSave,
  onRemove,
  onCreateCard,
}: {
  slot: Slot;
  tasks: Row[];
  templates: PerformanceTemplateLite[];
  onChange: (patch: Partial<Slot>) => void;
  onSave: () => Promise<boolean | undefined>;
  onRemove: () => void;
  onCreateCard: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [provisionMsg, setProvisionMsg] = useState("");
  const [provisioning, setProvisioning] = useState(false);

  const def = slot.automationKey ? AUTOMATION_DEFINITIONS[slot.automationKey] : null;
  const canSave = Boolean(slot.automationKey && slot.targetTask);
  const showDetails = Boolean(slot.automationKey);

  async function save() {
    setBusy(true);
    setMsg("");
    const ok = await onSave();
    setMsg(ok ? "Salvo ✓" : "Erro ao salvar");
    setBusy(false);
  }

  async function toggleActive(next: boolean) {
    onChange({ active: next });
    if (slot.id) {
      await fetch(`/api/admin/automations/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      }).catch(() => {});
    }
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
              <AutomationCardPicker tasks={tasks} onPick={(task) => onChange({ targetTask: task })} />
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

          {slot.automationKey === "relatorio_vendas" ? (
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
