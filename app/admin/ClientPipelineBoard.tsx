"use client";

import Link from "next/link";
import { STAGE_LABEL, STAGE_ORDER } from "./clientPipeline";
import type { ClientRow } from "./ClientsTable";
import { initialsOf as initials } from "../avatar/initials";

// Moved here from Clientes (was a Lista/Pipeline toggle in ClientsTable.tsx)
// — Onboarding is exactly the audience for a stage-by-stage view of every
// client, so it lives permanently above "Etapas por cliente" instead of
// behind a toggle only some admins would think to flip.
export default function ClientPipelineBoard({ clients }: { clients: ClientRow[] }) {
  const active = clients.filter((c) => !c.disabled);
  return (
    <div className="cli-pipeline">
      {STAGE_ORDER.map((stage) => {
        const stageClients = active.filter((c) => c.stage === stage);
        return (
          <div className="cli-pipeline-col" key={stage}>
            <div className="kb-col-head">
              <span>{STAGE_LABEL[stage]}</span>
              <em>{stageClients.length}</em>
            </div>
            <div className="cli-pipeline-body">
              {stageClients.map((c) => (
                <div className="cli-card" key={c.id}>
                  <div className="cli-card-top">
                    <span className="admin-avatar">{initials(c.name)}</span>
                    <span className="cli-card-name">{c.name}</span>
                  </div>
                  <code className="admin-slug">{c.slug}</code>
                  <div className="cli-card-meta">
                    <span className={`admin-pill ${c.briefing_submitted ? "on" : "muted"}`}>
                      {c.briefing_submitted ? "Briefing enviado" : "Briefing pendente"}
                    </span>
                    {stage !== "criacao" ? <span className="cli-card-pct">{c.checkpointsPct}%</span> : null}
                  </div>
                  <div className="cli-card-actions">
                    <Link href={`/admin/${c.slug}`} className="admin-btn ghost sm">Editar</Link>
                    <Link href={`/${c.slug}`} className="admin-btn ghost sm" target="_blank">Portal ↗</Link>
                  </div>
                </div>
              ))}
              {stageClients.length === 0 ? <p className="kb-empty">Nenhum cliente aqui</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
