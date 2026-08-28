"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  LEAD_STATUS_LABEL, LEAD_STATUS_ORDER, canTransition, investmentRank,
  leadStatusOf, type LeadStatus,
} from "@/lib/leadPipeline";
import type { LeadRecord } from "@/lib/supabase";
import type { LeadsView } from "./leadsPrefs";

// Destino dos formulários das landing pages. Até aqui os leads chegavam em
// public.leads e ninguém no admin os via — o visitante era mandado para o
// WhatsApp e o registro ficava órfão no banco.
//
// Triagem só mexe em status e notas. Os campos de identidade são o registro do
// que a pessoa enviou e ficam imutáveis de propósito: é por eles que um CRM vai
// reconciliar quando a integração existir.

function whatsappHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits.startsWith("55") ? digits : `55${digits}`}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  } catch {
    return iso.slice(0, 10);
  }
}

// A origem que importa na triagem é "de onde veio", e utm_source é mais
// específico que a página. Sem UTM (tráfego direto), a página é a resposta.
function originOf(lead: LeadRecord): string {
  return lead.utm_source || lead.source_page || "direto";
}

export default function LeadsScreen({ leads, view }: { leads: LeadRecord[]; view: LeadsView }) {
  const [rows, setRows] = useState<LeadRecord[]>(leads);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const byStatus = useMemo(() => {
    const map = new Map<LeadStatus, LeadRecord[]>(LEAD_STATUS_ORDER.map((s) => [s, []]));
    for (const lead of rows) map.get(leadStatusOf(lead.status))!.push(lead);
    return map;
  }, [rows]);

  async function patch(id: string, body: { status?: LeadStatus; notes?: string | null }) {
    setBusy(id);
    setError("");
    // Otimista: a triagem é um clique e esperar o round-trip para o card mudar
    // de coluna faz a tela parecer travada. O catch abaixo desfaz.
    const before = rows;
    setRows((current) => current.map((lead) => (lead.id === id ? { ...lead, ...body } as LeadRecord : lead)));
    try {
      const response = await fetch(`/api/admin/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível salvar.");
      setRows((current) => current.map((lead) => (lead.id === id ? payload as LeadRecord : lead)));
    } catch (err) {
      setRows(before);
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setBusy(null);
    }
  }

  function move(id: string, next: LeadStatus) {
    const lead = rows.find((row) => row.id === id);
    if (!lead) return;
    const current = leadStatusOf(lead.status);
    if (!canTransition(current, next)) {
      // "Convertido" não é concedido nem retirado pela tela: ele significa que
      // existe um cliente criado, e quem cria é o fluxo de /admin/novo.
      setError(
        current === "convertido"
          ? "Lead já convertido em cliente — o status não volta atrás por aqui."
          : "Para marcar como convertido, use o botão Converter em cliente.",
      );
      return;
    }
    void patch(id, { status: next });
  }

  if (!rows.length) {
    return (
      <p className="admin-empty">
        Nenhum lead ainda. Os formulários de <Link href="/lp#diagnostico" target="_blank">/lp</Link> caem aqui.
      </p>
    );
  }

  return (
    <>
      {error ? <p className="admin-error">{error}</p> : null}

      {view === "kanban" ? (
        <div className="cli-pipeline leads-pipeline">
          {LEAD_STATUS_ORDER.map((status) => {
            const cards = byStatus.get(status) ?? [];
            return (
              <div
                className="cli-pipeline-col"
                key={status}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) move(id, status);
                }}
              >
                <div className="kb-col-head">
                  <span>{LEAD_STATUS_LABEL[status]}</span>
                  <em>{cards.length}</em>
                </div>
                <div className="cli-pipeline-body">
                  {cards.map((lead) => (
                    <article
                      className={`cli-card lead-card${busy === lead.id ? " is-busy" : ""}`}
                      key={lead.id}
                      draggable={status !== "convertido"}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)}
                    >
                      <div className="cli-card-top">
                        <span className="cli-card-name">{lead.name}</span>
                        <span className="lead-date">{formatDate(lead.created_at)}</span>
                      </div>
                      <p className="lead-company">{lead.company}</p>
                      <div className="cli-card-meta">
                        <span className="admin-pill">{lead.investment}</span>
                        <span className="lead-origin" title={lead.source_page}>{originOf(lead)}</span>
                      </div>
                      <div className="cli-card-actions">
                        <a className="admin-btn ghost sm" href={whatsappHref(lead.phone)} target="_blank" rel="noreferrer" title={`Abrir conversa com ${lead.name}`}>WhatsApp</a>
                        <button type="button" className="admin-btn ghost sm" onClick={() => setOpen(open === lead.id ? null : lead.id)}>
                          {open === lead.id ? "Fechar" : "Detalhes"}
                        </button>
                      </div>
                      {open === lead.id ? <LeadDetail lead={lead} onNotes={(notes) => patch(lead.id, { notes })} /> : null}
                    </article>
                  ))}
                  {cards.length === 0 ? <p className="kb-empty">Nenhum lead aqui</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table leads-table">
            <thead>
              <tr>
                <th>Data</th><th>Nome</th><th>Empresa</th><th>Segmento</th>
                <th>Região</th><th>Verba</th><th>Origem</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => investmentRank(b.investment) - investmentRank(a.investment) || b.created_at.localeCompare(a.created_at))
                .map((lead) => {
                  const status = leadStatusOf(lead.status);
                  return (
                    <tr key={lead.id} className={busy === lead.id ? "is-busy" : ""}>
                      <td className="admin-cell-muted">{formatDate(lead.created_at)}</td>
                      <td>{lead.name}</td>
                      <td>{lead.company}</td>
                      <td className="admin-cell-muted">{lead.segment}</td>
                      <td className="admin-cell-muted">{lead.region}</td>
                      <td><span className="admin-pill">{lead.investment}</span></td>
                      <td className="admin-cell-muted" title={lead.source_page}>{originOf(lead)}</td>
                      <td>
                        <select
                          className="lead-status-select"
                          value={status}
                          disabled={status === "convertido" || busy === lead.id}
                          onChange={(e) => move(lead.id, e.target.value as LeadStatus)}
                          aria-label={`Status de ${lead.name}`}
                        >
                          {LEAD_STATUS_ORDER.map((s) => (
                            <option key={s} value={s} disabled={s === "convertido" && status !== "convertido"}>
                              {LEAD_STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="lead-row-actions">
                        <a className="admin-btn ghost sm lead-wa" href={whatsappHref(lead.phone)} target="_blank" rel="noreferrer"
                          title={`Abrir conversa com ${lead.name}`} aria-label={`Abrir conversa no WhatsApp com ${lead.name}`}>
                          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden focusable="false" fill="currentColor">
                            <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm5.5 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1a12 12 0 0 1-5.6-4.7c-.4-.6-.9-1.5-.9-2.4 0-.9.5-1.4.7-1.6.2-.2.4-.3.6-.3h.5c.2 0 .4 0 .6.4l.8 1.9c0 .2 0 .3-.1.4l-.3.4-.3.3c-.1.1-.2.2 0 .5.2.3.7 1.1 1.4 1.8.9.8 1.6 1 1.9 1.2.2.1.4 0 .5-.1l.7-.8c.2-.2.3-.2.5-.1l1.8.9c.3.1.4.2.5.3v.8Z"/>
                          </svg>
                        </a>
                        {status === "convertido" ? <span className="admin-pill on">Convertido</span> : (
                          <Link className="admin-btn primary sm" href={`/admin/novo?lead=${lead.id}`}>Converter</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function LeadDetail({ lead, onNotes }: { lead: LeadRecord; onNotes: (notes: string) => void }) {
  const [draft, setDraft] = useState(lead.notes ?? "");
  return (
    <div className="lead-detail">
      <dl>
        <dt>Objetivo</dt><dd>{lead.objective}</dd>
        <dt>Segmento</dt><dd>{lead.segment}</dd>
        <dt>Região</dt><dd>{lead.region}</dd>
        <dt>Telefone</dt><dd>{lead.phone}</dd>
        {lead.utm_campaign ? <><dt>Campanha</dt><dd>{lead.utm_campaign}</dd></> : null}
      </dl>
      <label className="admin-field">
        <span>Notas</span>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={2000} />
      </label>
      <div className="lead-detail-actions">
        <button type="button" className="admin-btn ghost sm" onClick={() => onNotes(draft)} disabled={draft === (lead.notes ?? "")}>
          Salvar notas
        </button>
        {leadStatusOf(lead.status) === "convertido" ? (
          <span className="admin-pill on">Convertido</span>
        ) : (
          <Link className="admin-btn primary sm" href={`/admin/novo?lead=${lead.id}`}>Converter em cliente</Link>
        )}
      </div>
    </div>
  );
}
