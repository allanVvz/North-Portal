"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ClientSearchBar, { clientMatchesFilters, type ClientActiveFilter } from "./ClientSearchBar";
import type { ClientStage } from "./clientPipeline";
import type { AdminClientSummary } from "@/lib/supabase";
import { initialsOf as initials } from "../avatar/initials";
import { ATTENTION_LABEL, type AttentionReason } from "@/lib/adminHome";

export type ClientRow = AdminClientSummary & {
  checkpointsPct: number;
  stage: ClientStage;
  /** O que falta neste cliente. Vazio/ausente = nada pendente. Opcional porque
   *  Informações reaproveita este tipo só para o seletor de cliente e não tem
   *  motivo para carregar o overview inteiro. */
  attention?: AttentionReason[];
};


function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

// Card grid rather than a table: a client is a thing you go *into*, not a row
// you scan across. "Visualizar" is the primary action and lands on the client
// dashboard; editing is a button inside that screen, so the list stays about
// choosing a client instead of offering two competing entry points.
//
// Search/filtering is the same composite attribute→value chip box the Kanban
// uses (ClientSearchBar), including the Desabilitado attribute that reveals
// soft-deleted clients.
export default function ClientsTable({ clients }: { clients: ClientRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<ClientActiveFilter[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const wantsDisabled = filters.some((f) => f.attr === "desabilitado" && f.value === "Sim");
    return clients.filter((c) => {
      // Disabled clients only ever show up when explicitly searched for —
      // that's what makes "Remover do sistema" actually hide them.
      if (c.disabled && !wantsDisabled) return false;
      if (!clientMatchesFilters(c, filters)) return false;
      if (needle && !`${c.name} ${c.slug}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [clients, q, filters]);

  async function setDisabled(c: ClientRow, disabled: boolean) {
    setBusyId(c.id);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/client/${encodeURIComponent(c.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setMsg("Não foi possível salvar.");
    }
    setBusyId(null);
  }

  function confirmRemove(c: ClientRow) {
    const ok = window.confirm(
      `Remover "${c.name}" do sistema? Isso só oculta o cliente (de dropdowns, do Kanban e daqui) — nada é apagado, e dá pra reabilitar depois pelo filtro "Desabilitado".`,
    );
    if (ok) void setDisabled(c, true);
  }

  return (
    <>
      <div className="cli-toolbar">
        <ClientSearchBar q={q} onQChange={setQ} filters={filters} onFiltersChange={setFilters} />
        {msg ? <span className="set-msg">{msg}</span> : null}
        <div className="kb-spacer" />
        <Link href="/admin/novo" className="admin-btn primary kb-newtask-btn">
          + Novo cliente
        </Link>
      </div>

      {filtered.length === 0 ? (
        <p className="admin-empty">Nenhum cliente neste filtro.</p>
      ) : (
        <div className="cli-grid">
          {filtered.map((c) => (
            <article className={`cli-card${c.disabled ? " is-disabled" : ""}`} key={c.id}>
              <Link href={`/admin/${c.slug}/visao`} className="cli-card-main">
                <span className="cli-card-head">
                  <span className="admin-avatar">{initials(c.name)}</span>
                  <span className="cli-card-id">
                    <strong>{c.name}</strong>
                    <code className="admin-slug">/{c.slug}</code>
                  </span>
                </span>

                <span className="cli-card-pills">
                  <span className={`admin-pill ${c.is_active ? "on" : "off"}`}>{c.is_active ? "Ativo" : "Inativo"}</span>
                  <span className={`admin-pill ${c.briefing_submitted ? "on" : "muted"}`}>
                    Briefing {c.briefing_submitted ? "enviado" : "pendente"}
                  </span>
                  {c.disabled ? <span className="admin-pill off">Desabilitado</span> : null}
                </span>

                <span className="cli-card-progress">
                  <span className="cli-card-progress-top">
                    <span>Onboarding</span>
                    <strong>{c.checkpointsPct}%</strong>
                  </span>
                  <span className="visao-bar" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, Math.max(0, c.checkpointsPct))}%` }} />
                  </span>
                </span>

                {c.attention && c.attention.length > 0 ? (
                  <span className="cli-card-attention">
                    {c.attention.map((reason) => (
                      <em className="admin-chiptag" key={reason}>{ATTENTION_LABEL[reason]}</em>
                    ))}
                  </span>
                ) : null}

                <span className="cli-card-foot">Atualizado {formatDate(c.updated_at)}</span>
              </Link>

              <div className="cli-card-actions">
                <Link href={`/admin/${c.slug}/visao`} className="admin-btn primary">
                  Visualizar
                </Link>
                <Link href={`/${c.slug}`} className="admin-btn ghost" target="_blank">
                  Portal ↗
                </Link>
                <div className="kb-spacer" />
                {c.disabled ? (
                  <button className="admin-btn ghost" disabled={busyId === c.id} onClick={() => void setDisabled(c, false)}>
                    Reabilitar
                  </button>
                ) : (
                  <button className="admin-btn ghost danger" disabled={busyId === c.id} onClick={() => confirmRemove(c)}>
                    Remover
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
