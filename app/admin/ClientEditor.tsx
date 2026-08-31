"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdAccountOption, AdminClientDetail, ScopeTag } from "@/lib/supabase";
import type { Insight, Metric, PlanoTier } from "@/lib/validation";
import {
  AccountLinkSection,
  CompanyInfoSection,
  PlanScopeSection,
  ResponsibleSection,
  parseValorMensal,
  type CompanyInfoState,
  type ContractState,
} from "./ClientFormSections";
import DriveFoldersSection from "./DriveFoldersSection";

type Props = {
  slug: string;
  detail: AdminClientDetail;
  scopeTags: ScopeTag[];
  adAccounts: AdAccountOption[];
  adAccountId: string;
  driveConfigured: boolean;
};

// As seções do portal do cliente que o admin edita por JSON. "documentos" saiu
// (era gravado em client_content e nunca lido — a página vem da tabela
// `documents`); "trilhas" saiu porque Trilhas North virou uma lista GLOBAL
// (tabela `north_trilhas`, gerenciada em Informações › Trilhas North), não mais
// um override por cliente. `fallback` marca seções que o portal substitui por
// dados vivos quando existem.
const CONTENT_SECTIONS: { key: string; label: string; fallback?: string }[] = [
  { key: "home", label: "Home (banner, stats, faixa)", fallback: "stats e feed vêm de checkpoints/aprovações reais" },
  { key: "pendencias", label: "Central de pendências", fallback: "status recalculado a partir do briefing/acessos" },
  { key: "central", label: "Central Comercial (contrato)", fallback: "checkpoints vêm dos cards reais" },
  { key: "acessos", label: "Acessos & Pastas" },
  { key: "time", label: "Time North" },
  { key: "agenda", label: "Agenda / Calendário", fallback: "substituída quando há cards de agendamento" },
  { key: "dashboard", label: "Dashboard", fallback: "métricas do topo vêm de Resultados quando preenchidas" },
  { key: "plano", label: "Plano de Ação", fallback: "substituído quando há cards de plano visíveis" },
];

function initialContentText(content: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key } of CONTENT_SECTIONS) {
    out[key] = content[key] !== undefined ? JSON.stringify(content[key], null, 2) : "";
  }
  return out;
}

export default function ClientEditor({ slug, detail, scopeTags, adAccounts, adAccountId: initialAdAccount, driveConfigured }: Props) {
  const router = useRouter();
  const [name, setName] = useState(detail.name);
  const [isActive, setIsActive] = useState(detail.is_active);
  const [company, setCompany] = useState<CompanyInfoState>({
    segmento: detail.companyInfo.segmento ?? "",
    cidadeUf: detail.companyInfo.cidadeUf ?? "",
    instagramOuSite: detail.companyInfo.instagramOuSite ?? "",
  });
  const [contract, setContract] = useState<ContractState>({
    planoTier: (detail.contract.planoTier as PlanoTier | null) ?? "",
    escopo: detail.contract.escopo ?? [],
    valorMensal: detail.contract.valorMensal != null ? String(detail.contract.valorMensal) : "",
    contractStart: detail.contract.contractStart ?? "",
    responsavelNome: detail.contract.responsavelNome ?? "",
    responsavelWhatsapp: detail.contract.responsavelWhatsapp ?? "",
  });
  const [tags, setTags] = useState<ScopeTag[]>(scopeTags);
  const [adAccountId, setAdAccountId] = useState(initialAdAccount);
  const [driveShareEmail, setDriveShareEmail] = useState("");
  const [brandUrl, setBrandUrl] = useState(detail.driveLinks.brandUrl ?? "");
  const [productsUrl, setProductsUrl] = useState(detail.driveLinks.productsUrl ?? "");
  const [uploadsUrl, setUploadsUrl] = useState(detail.driveLinks.uploadsUrl ?? "");
  const [reportUrl, setReportUrl] = useState(detail.results.reportUrl ?? "");
  const [feedbackUrl, setFeedbackUrl] = useState(detail.results.feedbackUrl ?? "");
  const [metrics, setMetrics] = useState<Metric[]>(detail.results.topMetrics);
  const [insights, setInsights] = useState<Insight[]>(detail.results.insights);
  const [contentText, setContentText] = useState<Record<string, string>>(() => initialContentText(detail.content));
  const [contentOpen, setContentOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function updateMetric(index: number, patch: Partial<Metric>) {
    setMetrics((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function updateInsight(index: number, patch: Partial<Insight>) {
    setInsights((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function createTag(label: string): Promise<ScopeTag | null> {
    const res = await fetch("/api/admin/scope-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível criar a tag.");
      return null;
    }
    const { tag } = (await res.json()) as { tag: ScopeTag };
    setTags((all) => (all.some((t) => t.key === tag.key) ? all : [...all, tag]));
    return tag;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaved(false);
    setBusy(true);

    const cleanMetrics = metrics
      .filter((m) => m.label.trim() && m.value.trim())
      .map((m) => ({
        label: m.label.trim(),
        value: m.value.trim(),
        variation: m.variation?.trim() || undefined,
        description: m.description?.trim() || undefined,
      }));
    const cleanInsights = insights
      .filter((i) => i.title.trim() && i.description.trim())
      .map((i) => ({
        title: i.title.trim(),
        description: i.description.trim(),
        category: i.category?.trim() || undefined,
        date: i.date?.trim() || undefined,
      }));

    // Assemble the content override from the per-section JSON editors.
    //
    // Starts from the stored object rather than {} on purpose: the PATCH
    // replaces client_content.data wholesale, so anything this editor doesn't
    // manage (a key added by a later release, for instance) would be destroyed
    // by a plain save. Clearing a textarea still removes that one section, which
    // is what "deixe vazio para usar o padrão" means.
    const content: Record<string, unknown> = { ...detail.content };
    for (const { key, label } of CONTENT_SECTIONS) {
      const raw = (contentText[key] ?? "").trim();
      if (!raw) {
        delete content[key];
        continue;
      }
      try {
        content[key] = JSON.parse(raw);
      } catch {
        setBusy(false);
        setError(`JSON inválido na seção "${label}".`);
        return;
      }
    }

    const res = await fetch(`/api/admin/client/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        is_active: isActive,
        brandUrl: brandUrl.trim() || null,
        productsUrl: productsUrl.trim() || null,
        uploadsUrl: uploadsUrl.trim() || null,
        reportUrl: reportUrl.trim() || null,
        feedbackUrl: feedbackUrl.trim() || null,
        topMetrics: cleanMetrics,
        insights: cleanInsights,
        content,
        companyInfo: {
          segmento: company.segmento.trim() || null,
          cidadeUf: company.cidadeUf.trim() || null,
          instagramOuSite: company.instagramOuSite.trim() || null,
        },
        contract: {
          planoTier: contract.planoTier || null,
          escopo: contract.escopo,
          valorMensal: parseValorMensal(contract.valorMensal),
          contractStart: contract.contractStart || null,
          responsavelNome: contract.responsavelNome.trim() || null,
          responsavelWhatsapp: contract.responsavelWhatsapp.trim() || null,
        },
        adAccountId: adAccountId || null,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      setError(data.error ?? "Não foi possível salvar.");
      return;
    }
    setBusy(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form className="admin-form" onSubmit={onSubmit}>
      <CompanyInfoSection
        name={name}
        onName={setName}
        value={company}
        onChange={(patch) => setCompany((c) => ({ ...c, ...patch }))}
        slugField={
          <label className="admin-toggle">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span className="sw" />
            <span>Cliente ativo (portal acessível)</span>
          </label>
        }
      />

      <PlanScopeSection
        value={contract}
        onChange={(patch) => setContract((c) => ({ ...c, ...patch }))}
        tags={tags}
        onCreateTag={createTag}
      />

      <ResponsibleSection value={contract} onChange={(patch) => setContract((c) => ({ ...c, ...patch }))} />

      <AccountLinkSection
        driveConfigured={driveConfigured}
        driveShareEmail={driveShareEmail}
        onDriveShareEmail={setDriveShareEmail}
        accounts={adAccounts}
        adAccountId={adAccountId}
        onAdAccountId={setAdAccountId}
      />

      <DriveFoldersSection
        folders={detail.driveFolders}
        brandUrl={brandUrl}
        productsUrl={productsUrl}
        uploadsUrl={uploadsUrl}
        onBrandUrl={setBrandUrl}
        onProductsUrl={setProductsUrl}
        onUploadsUrl={setUploadsUrl}
      />

      <fieldset className="admin-group">
        <legend>Resultados — métricas (até 4)</legend>
        {metrics.map((m, i) => (
          <div className="admin-row-editor" key={`metric-${i}`}>
            <input placeholder="Rótulo" value={m.label} onChange={(e) => updateMetric(i, { label: e.target.value })} />
            <input placeholder="Valor" value={m.value} onChange={(e) => updateMetric(i, { value: e.target.value })} />
            <input placeholder="Variação (+41%)" value={m.variation ?? ""} onChange={(e) => updateMetric(i, { variation: e.target.value })} />
            <input placeholder="Descrição" value={m.description ?? ""} onChange={(e) => updateMetric(i, { description: e.target.value })} />
            <button type="button" className="admin-btn ghost" onClick={() => setMetrics((r) => r.filter((_, x) => x !== i))} aria-label="Remover métrica">
              ✕
            </button>
          </div>
        ))}
        {metrics.length < 4 ? (
          <button type="button" className="admin-btn ghost" onClick={() => setMetrics((r) => [...r, { label: "", value: "" }])}>
            + Métrica
          </button>
        ) : null}
      </fieldset>

      <fieldset className="admin-group">
        <legend>Resultados — insights</legend>
        {insights.map((it, i) => (
          <div className="admin-row-editor col" key={`insight-${i}`}>
            <div className="admin-row-editor">
              <input placeholder="Título" value={it.title} onChange={(e) => updateInsight(i, { title: e.target.value })} />
              <input placeholder="Categoria" value={it.category ?? ""} onChange={(e) => updateInsight(i, { category: e.target.value })} />
              <input placeholder="Data (2026-06-28)" value={it.date ?? ""} onChange={(e) => updateInsight(i, { date: e.target.value })} />
              <button type="button" className="admin-btn ghost" onClick={() => setInsights((r) => r.filter((_, x) => x !== i))} aria-label="Remover insight">
                ✕
              </button>
            </div>
            <textarea placeholder="Descrição" rows={2} value={it.description} onChange={(e) => updateInsight(i, { description: e.target.value })} />
          </div>
        ))}
        <button type="button" className="admin-btn ghost" onClick={() => setInsights((r) => [...r, { title: "", description: "" }])}>
          + Insight
        </button>
      </fieldset>

      <fieldset className="admin-group">
        <legend>Relatório & feedback</legend>
        <label className="admin-field">
          <span>Link do relatório</span>
          <input value={reportUrl} onChange={(e) => setReportUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label className="admin-field">
          <span>Link de feedback</span>
          <input value={feedbackUrl} onChange={(e) => setFeedbackUrl(e.target.value)} placeholder="https://…" />
        </label>
      </fieldset>

      <fieldset className="admin-group">
        <legend>
          <button type="button" className="admin-collapse" onClick={() => setContentOpen((v) => !v)}>
            {contentOpen ? "▾" : "▸"} Conteúdo do portal (avançado)
          </button>
        </legend>
        {contentOpen ? (
          <>
            <p className="admin-hint">
              Cada seção aceita um JSON que sobrepõe o padrão mostrado ao cliente. Deixe vazio para usar o padrão da North.
              O Plano de Ação usa o Kanban quando há cards visíveis; o JSON abaixo é o fallback.
            </p>
            {CONTENT_SECTIONS.map(({ key, label }) => (
              <label className="admin-field" key={key}>
                <span>{label}</span>
                <textarea
                  className="admin-json"
                  rows={contentText[key] ? 6 : 2}
                  spellCheck={false}
                  placeholder="Padrão da North (vazio)"
                  value={contentText[key] ?? ""}
                  onChange={(e) => setContentText((c) => ({ ...c, [key]: e.target.value }))}
                />
              </label>
            ))}
          </>
        ) : null}
      </fieldset>

      {error ? <p className="admin-error">{error}</p> : null}
      {saved ? <p className="admin-ok">Alterações salvas.</p> : null}

      <div className="admin-form-actions">
        <button className="admin-btn primary" type="submit" disabled={busy}>
          {busy ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>
    </form>
  );
}
