"use client";

import { useState } from "react";
import Link from "next/link";
import type { AdminClientSummary } from "@/lib/supabase";

type Filter = "todos" | "ativos" | "inativos" | "pendentes";

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

const FILTERS: { key: Filter; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "ativos", label: "Ativos" },
  { key: "inativos", label: "Inativos" },
  { key: "pendentes", label: "Briefing pendente" },
];

export default function ClientsTable({ clients }: { clients: AdminClientSummary[] }) {
  const [filter, setFilter] = useState<Filter>("todos");

  const rows = clients.filter((c) => {
    if (filter === "ativos") return c.is_active;
    if (filter === "inativos") return !c.is_active;
    if (filter === "pendentes") return !c.briefing_submitted;
    return true;
  });

  return (
    <>
      <div className="admin-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`admin-chip ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
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
            {rows.map((c) => (
              <tr key={c.id}>
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
                  <span className={`admin-pill ${c.is_active ? "on" : "off"}`}>
                    {c.is_active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td>
                  <span className={`admin-pill ${c.briefing_submitted ? "on" : "muted"}`}>
                    {c.briefing_submitted ? "Enviado" : "Pendente"}
                  </span>
                </td>
                <td className="admin-cell-muted">{formatDate(c.updated_at)}</td>
                <td>
                  <div className="admin-cell-actions">
                    <Link href={`/admin/${c.slug}`} className="admin-btn ghost">
                      Editar
                    </Link>
                    <Link href={`/${c.slug}`} className="admin-btn ghost" target="_blank">
                      Portal ↗
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
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
