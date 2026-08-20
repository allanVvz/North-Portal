"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ClientSearchBar, { clientMatchesFilters, type ClientActiveFilter } from "./ClientSearchBar";
import type { ClientStage } from "./clientPipeline";
import type { AdminClientSummary } from "@/lib/supabase";

export type ClientRow = AdminClientSummary & { checkpointsPct: number; stage: ClientStage };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

// Client version of the Kanban's "cliente/tipo/prioridade/responsável"
// composite search (see KanbanSearchBar.tsx) — attribute→value chips,
// AND-composable — this is what replaced the old Todos/Ativos/Inativos/
// Briefing pendente chip row: those are now just picks inside this same box,
// plus the new Desabilitado attribute for the soft-delete feature.
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
        method: "PATCH", headers: { "Content-Type": "application/json" },
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
        <Link href="/admin/novo" className="admin-btn primary kb-newtask-btn">+ Novo cliente</Link>
      </div>

      <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Briefing</th>
                <th>Atualizado</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className={c.disabled ? "cli-row-disabled" : ""}>
                  <td>
                    <div className="admin-cell-client">
                      <span className="admin-avatar">{initials(c.name)}</span>
                      <span className="admin-cell-name">{c.name}</span>
                    </div>
                  </td>
                  <td>
                    <code className="admin-slug">{c.slug}</code>
                  </td>
                  <td>
                    <span className={`admin-pill ${c.is_active ? "on" : "off"}`}>{c.is_active ? "Ativo" : "Inativo"}</span>
                    {c.disabled ? <span className="admin-pill off cli-disabled-badge">Desabilitado</span> : null}
                  </td>
                  <td>
                    <span className={`admin-pill ${c.briefing_submitted ? "on" : "muted"}`}>
                      {c.briefing_submitted ? "Enviado" : "Pendente"}
                    </span>
                  </td>
                  <td className="admin-cell-muted">{formatDate(c.updated_at)}</td>
                  <td>
                    <div className="admin-cell-actions">
                      <Link href={`/admin/${c.slug}`} className="admin-btn ghost">Editar</Link>
                      <Link href={`/${c.slug}`} className="admin-btn ghost" target="_blank">Portal ↗</Link>
                      {c.disabled ? (
                        <button className="admin-btn primary" disabled={busyId === c.id} onClick={() => void setDisabled(c, false)}>
                          Reabilitar
                        </button>
                      ) : (
                        <button className="admin-btn ghost danger" disabled={busyId === c.id} onClick={() => confirmRemove(c)}>
                          Remover
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="admin-cell-muted" style={{ textAlign: "center", padding: "28px" }}>
                    Nenhum cliente neste filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
      </div>
    </>
  );
}
