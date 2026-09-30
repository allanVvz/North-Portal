"use client";

import { useEffect, useMemo, useState } from "react";
import type { TaskTypeDef } from "@/lib/taskTypes";
import type { GlobalRule } from "@/lib/automations/rules";

type Pinned = { versionId: string; ruleId: string; version: number; name: string };
type ReportConfig = { id: string; templateId: string | null; suggestedTemplateId?: string | null };
type DailyPiece = { key: string; name: string; format: string; deliveryTypeId?: string; offsetDays: number };
type DailyFormat = { deliveryTypeId: string | null; label: string; ready: boolean };

export default function TaskAutomationPicker({ taskId, type, subtype, selected, onSelected }: {
  taskId: string | null;
  type: TaskTypeDef | null;
  subtype: string | null;
  selected: string[];
  onSelected: (selected: string[]) => void;
}) {
  const [rules, setRules] = useState<GlobalRule[]>([]);
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reportConfig, setReportConfig] = useState<ReportConfig | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [dailyPieces, setDailyPieces] = useState<DailyPiece[] | null>(null);
  const [dailyFormats, setDailyFormats] = useState<DailyFormat[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [scriptPreflight, setScriptPreflight] = useState("");
  const [dailyConfigId, setDailyConfigId] = useState<string | null>(null);
  const [canConfigure, setCanConfigure] = useState(false);

  useEffect(() => {
    let mounted = true;
    const url = taskId ? `/api/admin/tasks/${taskId}/automations` : "/api/admin/automation-rules";
    fetch(url).then((response) => response.ok ? response.json() : Promise.reject(new Error("Não foi possível carregar as automações.")))
      .then((result) => {
        if (!mounted) return;
        setRules((result.rules ?? []).filter((rule: GlobalRule) => rule.active));
        if (taskId) {
          setPinned(result.pinned ?? []); onSelected(result.selected ?? []);
          setReportConfig(result.reportConfig ?? null); setTemplates(result.templates ?? []);
          setCanConfigure(Boolean(result.canConfigure));
          const pieces = result.dailyConfig?.pieces as DailyPiece[] | undefined;
          setDailyPieces(pieces ?? null);
          setDailyConfigId(result.dailyConfig?.id ?? null);
          if (pieces) {
            const counts: Record<string, number> = {};
            pieces.forEach((piece) => { if (piece.deliveryTypeId) counts[piece.deliveryTypeId] = (counts[piece.deliveryTypeId] ?? 0) + 1; });
            setQuantities(counts);
            void fetch("/api/admin/automations/daily/options").then((response) => response.json())
              .then((options) => { if (mounted) setDailyFormats(options.formats ?? []); });
          }
        }
      }).catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : "Falha ao carregar automações."); });
    return () => { mounted = false; };
    // A seleção é estado do modal; carregar uma vez por card evita sobrescrever
    // o clique local quando o Tipo/Subtipo do rascunho muda.
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const compatible = useMemo(() => rules.filter((rule) => {
    if (!type || rule.definition.sourceTypeId !== type.id) return false;
    const source = rule.definition.sourceSubtypeId;
    if (source && !type.subtypes.some((item) => item.task_type_id === source && item.key === subtype)) return false;
    // Etapas de uma cascata só podem ser adotadas pelo card já criado, pois o
    // vínculo com a versão nasce junto da Entrega.
    if (!taskId && rule.definition.workflowStepId) return false;
    return true;
  }), [rules, type, subtype, taskId]);

  async function choose(rule: GlobalRule, checked: boolean) {
    const replace = pinned.find((item) => item.ruleId === rule.id)?.versionId;
    const next = checked
      ? [...selected.filter((id) => id !== replace && id !== rule.versionId), rule.versionId]
      : selected.filter((id) => id !== rule.versionId && id !== replace);
    if (!taskId) { onSelected(next); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/tasks/${taskId}/automations`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionIds: next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Não foi possível alterar o vínculo.");
      onSelected(result.selected ?? next);
      setPinned((current) => current.filter((item) => item.ruleId !== rule.id));
      const latest = await fetch(`/api/admin/tasks/${taskId}/automations`).then((response) => response.json());
      setReportConfig(latest.reportConfig ?? null); setTemplates(latest.templates ?? []);
      setDailyPieces(latest.dailyConfig?.pieces ?? null);
      setDailyConfigId(latest.dailyConfig?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível alterar o vínculo."); }
    finally { setBusy(false); }
  }

  async function saveQuantities() {
    if (!taskId) return;
    setBusy(true); setError("");
    try {
      const dailyQuantities = dailyFormats.filter((format) => format.ready && format.deliveryTypeId)
        .map((format) => ({ deliveryTypeId: format.deliveryTypeId!, count: quantities[format.deliveryTypeId!] ?? 0 }));
      const response = await fetch(`/api/admin/tasks/${taskId}/automations`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dailyQuantities }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Não foi possível salvar as quantidades.");
      setDailyPieces(result.pieces ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a diária."); }
    finally { setBusy(false); }
  }

  async function checkScripts() {
    if (!dailyConfigId) return;
    setBusy(true); setScriptPreflight("");
    try {
      const response = await fetch(`/api/admin/automations/daily/script-preflight?configId=${encodeURIComponent(dailyConfigId)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Não foi possível conferir o Roteiro.");
      setScriptPreflight(result.ready
        ? `${result.scriptCount} roteiros correspondem aos ${result.pieceCount} Criativos na ordem do Plano.`
        : result.question ?? "A correspondência precisa de revisão.");
    } catch (cause) { setScriptPreflight(cause instanceof Error ? cause.message : "Falha ao conferir Roteiro."); }
    finally { setBusy(false); }
  }

  async function chooseTemplate(id: string) {
    if (!taskId || !id) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/tasks/${taskId}/automations`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ performanceTemplateId: id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Não foi possível trocar o template.");
      setReportConfig((current) => current ? { ...current, templateId: id } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível trocar o template."); }
    finally { setBusy(false); }
  }

  if (!compatible.length && !pinned.length && !reportConfig && !dailyPieces && !error) return null;
  return <section className="tm-box tm-automation-box">
    <p className="tm-box-label">Automações</p>
    <p className="admin-sub">O cliente e as datas vêm deste card. Cada vínculo conserva a versão escolhida.</p>
    {compatible.map((rule) => {
      const older = pinned.find((item) => item.ruleId === rule.id && item.versionId !== rule.versionId && selected.includes(item.versionId));
      return <label key={rule.id} className="tm-automation-row">
        <input type="checkbox" disabled={busy} checked={selected.includes(rule.versionId)}
          onChange={(event) => void choose(rule, event.target.checked)} />
        <span>{rule.name} <small>v{rule.version}{older ? ` · v${older.version} vinculada` : ""}</small></span>
      </label>;
    })}
    {pinned.filter((item) => !compatible.some((rule) => rule.id === item.ruleId) && selected.includes(item.versionId))
      .map((item) => <p key={item.versionId} className="admin-sub">{item.name} v{item.version} vinculada</p>)}
    {reportConfig ? <label className="tm-automation-row">Template deste relatório
      <select disabled={busy || !canConfigure} value={reportConfig.templateId ?? ""} onChange={(event) => void chooseTemplate(event.target.value)}>
        <option value="" disabled>Escolha um template</option>
        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select>
      {reportConfig.suggestedTemplateId ? <small>Sugestão pelos resultados: {templates.find((item) => item.id === reportConfig.suggestedTemplateId)?.name ?? "Por resultado"}</small> : null}
    </label> : null}
    {dailyPieces ? <div className="tm-daily-quantities">
      <strong>Criativos por Subtipo neste Plano</strong>
      <p className="admin-sub">As quantidades salvas valem para as próximas ocorrências. Os ciclos já criados conservam seus cards.</p>
      {dailyFormats.filter((format) => format.ready && format.deliveryTypeId).map((format) =>
        <label key={format.deliveryTypeId}>{format.label}
          <input type="number" min={0} max={50} disabled={busy || !canConfigure} value={quantities[format.deliveryTypeId!] ?? 0}
            onChange={(event) => setQuantities((current) => ({ ...current, [format.deliveryTypeId!]: Number(event.target.value) }))} />
        </label>)}
      <button type="button" className="admin-btn ghost" disabled={busy || !canConfigure || !dailyFormats.length} onClick={() => void saveQuantities()}>Salvar quantidades</button>
      <button type="button" className="admin-btn ghost" disabled={busy || !canConfigure || !dailyConfigId} onClick={() => void checkScripts()}>Conferir Roteiro principal</button>
      {scriptPreflight ? <p className="admin-sub" role="status">{scriptPreflight}</p> : null}
    </div> : null}
    {error ? <p className="admin-warn" role="alert">{error}</p> : null}
  </section>;
}
