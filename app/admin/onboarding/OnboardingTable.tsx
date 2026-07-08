"use client";

import { useState } from "react";
import type { AdminBriefingRow } from "@/lib/supabase";
import BriefingModal from "./BriefingModal";

export default function OnboardingTable({ rows }: { rows: AdminBriefingRow[] }) {
  const [open, setOpen] = useState<AdminBriefingRow | null>(null);

  return (
    <>
      <div className="doc-table-wrap">
        <table className="doc-table">
          <thead><tr><th>Cliente</th><th>Manual do Cliente</th><th>Briefing</th><th>Onboarding (checkpoints)</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug}>
                <td><span className="doc-name">{r.name}</span></td>
                <td><span className={`set-badge ${r.manualSeen ? "publicada" : "rascunho"}`}>{r.manualSeen ? "Concluído" : "Pendente"}</span></td>
                <td><span className={`set-badge ${r.submitted ? "publicada" : "rascunho"}`}>{r.submitted ? "Enviado" : "Pendente"}</span></td>
                <td>
                  <div className="ob-progress">
                    <div className="ob-progress-track"><div className="ob-progress-fill" style={{ width: `${r.checkpointsPct}%` }} /></div>
                    <span>{r.checkpointsPct}%</span>
                  </div>
                </td>
                <td className="doc-open">
                  <button type="button" className="doc-open-btn" onClick={() => setOpen(r)}>Ver briefing</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={5} className="admin-empty" style={{ padding: 28 }}>Nenhum cliente ainda.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {open ? <BriefingModal client={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
