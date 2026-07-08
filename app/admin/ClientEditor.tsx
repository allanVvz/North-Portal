"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminClientDetail } from "@/lib/supabase";
import type { Insight, Metric } from "@/lib/validation";

type Props = { slug: string; detail: AdminClientDetail };

const CONTENT_SECTIONS: { key: string; label: string }[] = [
  { key: "home", label: "Home (banner, stats, faixa)" },
  { key: "pendencias", label: "Central de pendências" },
  { key: "central", label: "Central Comercial (contrato)" },
  { key: "acessos", label: "Acessos & Pastas" },
  { key: "documentos", label: "Documentos" },
  { key: "time", label: "Time North" },
  { key: "agenda", label: "Agenda / Calendário" },
  { key: "dashboard", label: "Dashboard" },
  { key: "plano", label: "Plano de Ação (fallback do Kanban)" },
];

function initialContentText(content: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key } of CONTENT_SECTIONS) {
    out[key] = content[key] !== undefined ? JSON.stringify(content[key], null, 2) : "";
  }
  return out;
}

export default function ClientEditor({ slug, detail }: Props) {
  const router = useRouter();
  const [name, setName] = useState(detail.name);
  const [isActive, setIsActive] = useState(detail.is_active);
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
    const content: Record<string, unknown> = {};
    for (const { key, label } of CONTENT_SECTIONS) {
      const raw = (contentText[key] ?? "").trim();
      if (!raw) continue;
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
      <fieldset className="admin-group">
        <legend>Identificação</legend>
        <label className="admin-field">
          <span>Nome</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="admin-toggle">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span className="sw" />
          <span>Cliente ativo (portal acessível)</span>
        </label>
      </fieldset>

      <fieldset className="admin-group">
        <legend>Materiais (Google Drive)</legend>
        <label className="admin-field">
          <span>Pasta da marca</span>
          <input value={brandUrl} onChange={(e) => setBrandUrl(e.target.value)} placeholder="https://drive.google.com/…" />
        </label>
        <label className="admin-field">
          <span>Produtos / serviços</span>
          <input value={productsUrl} onChange={(e) => setProductsUrl(e.target.value)} placeholder="https://drive.google.com/…" />
        </label>
        <label className="admin-field">
          <span>Uploads do cliente</span>
          <input value={uploadsUrl} onChange={(e) => setUploadsUrl(e.target.value)} placeholder="https://drive.google.com/…" />
        </label>
      </fieldset>

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
